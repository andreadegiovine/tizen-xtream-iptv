import {
  dbGet,
  dbPut,
  dbPutMany,
  dbGetAllKeys,
  dbGetAllRange,
  dbDeleteMany,
} from '../core/idb.js';
import { openProviderDb } from '../db/providerDb.js';
import { AppError, ErrorCode, Severity, toAppError } from '../core/errors.js';
import { MediaType } from './mediaType.js';
import { XtreamClient } from './xtreamClient.js';
import { projectItem } from './itemProjector.js';
import { buildEntries, buildEntryCategoryRows, buildEntryGenreRows } from './grouping.js';

export const LIST_TTL_MS = 12 * 60 * 60 * 1000;
export const BATCH_SIZE = 2000;
// Progressive order: whatever finishes first becomes usable first.
export const SYNC_ORDER = [MediaType.MOVIE, MediaType.SERIES, MediaType.LIVE];

const metaKey = (type) => `sync:${type}`;

export function shouldSync(meta, now = Date.now(), ttlMs = LIST_TTL_MS) {
  return !meta || !meta.lastSync || now - meta.lastSync > ttlMs;
}

export function getSyncMeta(db, type) {
  return dbGet(db, 'meta', metaKey(type));
}

export async function getSyncStatus(db) {
  const status = {};
  for (const type of SYNC_ORDER) status[type] = (await getSyncMeta(db, type)) || null;
  return status;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw new AppError(ErrorCode.ABORTED, 'Sync cancelled');
}

// Key ranges covering every row of one media type in each store.
const ranges = {
  // Keys are `${type}:${id}`, so a primary-key range selects one type without needing an index.
  items: (type) => ({ range: IDBKeyRange.bound(`${type}:`, `${type}:\uffff`) }),
  entries: (type) => ({ index: 'byTypeAdded', range: IDBKeyRange.bound([type, -Infinity], [type, Infinity]) }),
  entry_cat: (type) => ({ index: 'byCatAdded', range: IDBKeyRange.bound([type], [type, []]) }),
  entry_genre: (type) => ({ index: 'byGenreAdded', range: IDBKeyRange.bound([type], [type, []]) }),
  entry_genre_tmdb: (type) => ({ index: 'byGenreAdded', range: IDBKeyRange.bound([type], [type, []]) }),
  categories: (type) => ({ range: IDBKeyRange.bound(`${type}:`, `${type}:￿`) }),
};

/** Writes the new rows, then deletes the rows of that type that are no longer present (readers never see an empty catalog). */
async function replaceRows(db, store, type, rows, { onBatch } = {}) {
  await dbPutMany(db, store, rows, BATCH_SIZE, onBatch);
  const fresh = new Set(rows.map((row) => row.key));
  const existing = await dbGetAllKeys(db, store, ranges[store](type));
  await dbDeleteMany(db, store, existing.filter((key) => !fresh.has(key)));
}

/** Entries + their per-category rows. Shared by the sync and by "exclusions changed". */
export async function writeEntries(db, type, entries, { onBatch } = {}) {
  await replaceRows(db, 'entries', type, entries, { onBatch });
  await replaceRows(db, 'entry_cat', type, buildEntryCategoryRows(entries));
  await replaceRows(db, 'entry_genre', type, buildEntryGenreRows(entries));
  // TMDB genres follow the metadata, not the sync: only forget the ones of titles that left the catalog.
  const present = new Set(entries.map((entry) => entry.key));
  const known = await dbGetAllKeys(db, 'entry_genre_tmdb', ranges.entry_genre_tmdb(type));
  await dbDeleteMany(db, 'entry_genre_tmdb', known.filter((key) => !present.has(key.slice(0, key.lastIndexOf('|')))));
}

/** Rebuilds the grid entries from the stored items (used when the excluded categories change). */
export async function rebuildEntries({ db, type, excludedCategories = new Set(), emit = () => {} }) {
  const items = await dbGetAllRange(db, 'items', IDBKeyRange.bound(`${type}:`, `${type}:\uffff`));
  const entries = buildEntries(type, items, { excludedCategories });
  await writeEntries(db, type, entries);
  const previous = (await getSyncMeta(db, type)) || { key: metaKey(type), type };
  await dbPut(db, 'meta', { ...previous, entryCount: entries.length });
  emit({ event: 'progress', mediaType: type, phase: 'rebuilt', done: entries.length, total: entries.length });
  return entries.length;
}

function categoryRows(type, categories) {
  return categories
    .filter((c) => c && c.category_id !== undefined && c.category_id !== null)
    .map((c) => ({
      key: `${type}:${c.category_id}`,
      type,
      id: String(c.category_id),
      name: String(c.category_name ?? ''),
      parentId: c.parent_id ? String(c.parent_id) : null,
    }));
}

/** Downloads, projects and stores one media type. */
export async function syncType({
  db,
  client,
  type,
  excludedCategories = new Set(),
  signal,
  emit = () => {},
  gate = () => Promise.resolve(),
  now = Date.now,
}) {
  const progress = (phase, extra = {}) => emit({ event: 'progress', mediaType: type, phase, ...extra });
  const started = now();

  throwIfAborted(signal);
  progress('categories');
  const categories = categoryRows(type, await client.getCategories(type, { signal }));

  await gate();
  throwIfAborted(signal);
  progress('download');
  const downloadStart = now();
  const raw = await client.getStreams(type, { signal });
  const fetchMs = now() - downloadStart;

  const byKey = new Map();
  raw.forEach((row) => {
    const item = projectItem(type, row);
    if (item) byKey.set(item.key, item);
  });
  const items = Array.from(byKey.values());
  const rawCount = raw.length;
  raw.length = 0; // let the big raw list be collected before the heavy writes

  // Never let a glitchy empty answer wipe a catalog we already have.
  const previous = await getSyncMeta(db, type);
  if (items.length === 0 && previous && previous.itemCount > 0) {
    throw new AppError(ErrorCode.BAD_RESPONSE, 'The provider returned an empty list', { details: { rawCount } });
  }

  const writeStart = now();
  const onBatch = async (done, total) => {
    progress('write', { done, total });
    throwIfAborted(signal);
    await gate();
  };
  await replaceRows(db, 'items', type, items, { onBatch });
  const itemsMs = now() - writeStart;

  throwIfAborted(signal);
  progress('entries');
  const entriesStart = now();
  const entries = buildEntries(type, items, { excludedCategories });
  const buildMs = now() - entriesStart;
  await writeEntries(db, type, entries);
  const entriesMs = now() - entriesStart;
  await replaceRows(db, 'categories', type, categories);
  const writeMs = now() - writeStart;

  const meta = {
    key: metaKey(type),
    type,
    lastSync: now(),
    itemCount: items.length,
    entryCount: entries.length,
    categoryCount: categories.length,
    excludedCount: excludedCategories.size,
    fetchMs,
    writeMs,
    itemsMs,
    entriesMs,
    buildMs,
    durationMs: now() - started,
  };
  await dbPut(db, 'meta', meta);
  progress('done', { done: items.length, total: items.length, meta });
  return meta;
}

/** Syncs several media types in order. A failing type does not stop the others, except auth/abort errors. */
export async function runSync({ db, client, types = SYNC_ORDER, excluded = {}, force = false, signal, emit = () => {}, gate, now = Date.now }) {
  const results = [];
  for (const type of types) {
    try {
      throwIfAborted(signal);
      if (!force && !shouldSync(await getSyncMeta(db, type), now())) {
        emit({ event: 'progress', mediaType: type, phase: 'skipped' });
        results.push({ type, skipped: true });
        continue;
      }
      const meta = await syncType({ db, client, type, excludedCategories: excluded[type] || new Set(), signal, emit, gate, now });
      results.push({ type, meta });
    } catch (err) {
      const error = toAppError(err);
      emit({ event: 'progress', mediaType: type, phase: 'error', code: error.code, message: error.message });
      results.push({ type, error: error.code });
      if (error.code === ErrorCode.ABORTED || error.severity === Severity.BLOCKING) break;
    }
  }
  return results;
}

/**
 * Entry point shared by the Web Worker and the main-thread fallback:
 * opens the provider database, checks the account, syncs, and always ends with a `done` event.
 */
export async function runSyncForProvider({ provider, types, excluded, force, signal, emit = () => {}, gate, openDb = openProviderDb, makeClient }) {
  let db = null;
  let results = [];
  let failure = null;
  try {
    const client = makeClient ? makeClient(provider) : new XtreamClient(provider);
    emit({ event: 'progress', mediaType: null, phase: 'auth' });
    await client.authenticate();
    db = await openDb(provider.id);
    results = await runSync({ db, client, types, excluded, force, signal, emit, gate });
  } catch (err) {
    const error = toAppError(err);
    failure = { code: error.code, message: error.message };
    emit({ event: 'progress', mediaType: null, phase: 'error', code: error.code, message: error.message });
  } finally {
    if (db) db.close();
  }
  const outcome = { event: 'done', results, error: failure };
  emit(outcome);
  return outcome;
}
