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
import { LIVE_LAYOUT, DEFAULT_GROUPING, groupLiveItems, annotateGroupKeys, buildLiveAllRows, cleanChannelNames, compileTerms } from './liveGrouping.js';
import { buildNetworks, annotateNetworkKeys, networkCounts } from './liveNetworks.js';

export const LIST_TTL_MS = 12 * 60 * 60 * 1000;
export const BATCH_SIZE = 2000;
// Progressive order: whatever finishes first becomes usable first.
export const SYNC_ORDER = [MediaType.MOVIE, MediaType.SERIES, MediaType.LIVE];

/** Pauses (ms) before the two new attempts at a download that failed or came back empty: each one longer. Tests set it to zero. */
export const retryPolicy = { delays: [3000, 8000] };
const RETRYABLE = new Set([ErrorCode.HTTP, ErrorCode.NETWORK, ErrorCode.TIMEOUT, ErrorCode.BAD_RESPONSE]);

/** Waits `ms`, ending early (with the abort error) when the sync is cancelled. */
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new AppError(ErrorCode.ABORTED, 'Aborted'));
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new AppError(ErrorCode.ABORTED, 'Aborted'));
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    return undefined;
  });
}

/**
 * Runs `load()` and tries again, after a longer pause each time (`delays`), when the provider fails (network, timeout, HTTP error,
 * unreadable answer) or answers with nothing. After the last attempt the failure is thrown, or the empty answer is returned.
 */
async function loadWithRetries(load, { delays = retryPolicy.delays, signal, gate = () => Promise.resolve(), onRetry = () => {} } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    let failure = null;
    let result = null;
    try {
      result = await load();
    } catch (err) {
      if (!RETRYABLE.has(toAppError(err).code)) throw err;
      failure = err;
    }
    if (!failure && result.length > 0) return result;
    if (attempt >= delays.length) {
      if (failure) throw failure;
      return result;
    }
    onRetry(attempt + 1, delays.length);
    await pause(delays[attempt], signal);
    await gate();
  }
}

const metaKey = (type) => `sync:${type}`;
/** Meta row with how the Live networks were found (read by the Diagnostics page). */
export const NETWORK_REPORT_KEY = 'networkReport';

export function shouldSync(meta, now = Date.now(), ttlMs = LIST_TTL_MS) {
  return !meta || !meta.lastSync || !meta.genres || now - meta.lastSync > ttlMs; // `genres`: lists synced before genres existed are refreshed once
}

/** How many channels are in groups, how many groups there are and how many channels stand alone. */
function groupCounts(entries, groups, networks = []) {
  const grouped = groups.reduce((sum, group) => sum + group.memberIds.length, 0);
  return { groupCount: groups.length, groupedCount: grouped, singleCount: entries.length - grouped, ...networkCounts(networks) };
}

/** Groups, networks and the marks on the channels for a live list: { groups, networks }. */
function buildLiveComposites(entries, items, excludedCategories, grouping) {
  const g = grouping || DEFAULT_GROUPING;
  // The words to remove (tags included) are taken out of the channel names whenever channels are grouped or gathered in networks.
  if (g.enabled || (g.networks && g.networks.enabled)) cleanChannelNames(entries, compileTerms(g.terms));
  const groups = groupLiveItems(items, { excludedCategories, grouping });
  annotateGroupKeys(entries, groups);
  const report = {};
  const networks = buildNetworks(entries, groups, { ...(g.networks || { enabled: false, links: [] }), report }); // a config without `networks` leaves them off
  annotateNetworkKeys(entries, groups, networks);
  return { groups, networks, report };
}

/** Makes the next sync of a type download it again (a hidden category was shown again: its items were never kept). */
export async function markStale(db, type) {
  const meta = await getSyncMeta(db, type);
  if (meta) await dbPut(db, 'meta', { ...meta, lastSync: 0 });
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
  groups: (type) => ({ range: IDBKeyRange.bound(`${type}:`, `${type}:\uffff`) }),
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
export async function writeEntries(db, type, entries, { onBatch, groups = [], networks = [] } = {}) {
  await replaceRows(db, 'entries', type, entries, { onBatch });
  let categoryRows = buildEntryCategoryRows(entries);
  if (type === MediaType.LIVE) {
    // Live TV "show all": the groups plus the channels that are in none (they live in a pseudo category).
    categoryRows = categoryRows.concat(buildLiveAllRows(entries, groups, networks));
    await replaceRows(db, 'groups', type, groups.concat(networks)); // networks sit in the same store, keys `live:n…`
  }
  await replaceRows(db, 'entry_cat', type, categoryRows);
  await replaceRows(db, 'entry_genre', type, buildEntryGenreRows(entries));
  // TMDB genres follow the metadata, not the sync: only forget the ones of titles that left the catalog.
  const present = new Set(entries.map((entry) => entry.key));
  const known = await dbGetAllKeys(db, 'entry_genre_tmdb', ranges.entry_genre_tmdb(type));
  await dbDeleteMany(db, 'entry_genre_tmdb', known.filter((key) => !present.has(key.slice(0, key.indexOf('|')))));
}

/** Rebuilds the grid entries from the stored items (used when the excluded categories change). */
export async function rebuildEntries({ db, type, excludedCategories = new Set(), cleanTitles = true, grouping = DEFAULT_GROUPING, emit = () => {} }) {
  let items = await dbGetAllRange(db, 'items', IDBKeyRange.bound(`${type}:`, `${type}:\uffff`));
  if (excludedCategories.size) {
    // Hidden categories are not kept: drop what was stored for them before they were hidden.
    await dbDeleteMany(db, 'items', items.filter((item) => excludedCategories.has(item.categoryId)).map((item) => item.key));
    items = items.filter((item) => !excludedCategories.has(item.categoryId));
  }
  const entries = buildEntries(type, items, { excludedCategories, cleanTitles });
  const { groups, networks, report } = type === MediaType.LIVE ? buildLiveComposites(entries, items, excludedCategories, grouping) : { groups: [], networks: [], report: null };
  await writeEntries(db, type, entries, { groups, networks });
  if (report) await dbPut(db, 'meta', { key: NETWORK_REPORT_KEY, type, report });
  const previous = (await getSyncMeta(db, type)) || { key: metaKey(type), type };
  await dbPut(db, 'meta', { ...previous, itemCount: items.length, entryCount: entries.length, ...(type === MediaType.LIVE ? { layout: LIVE_LAYOUT, ...groupCounts(entries, groups, networks) } : {}) });
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
  cleanTitles = true,
  grouping = DEFAULT_GROUPING,
  signal,
  emit = () => {},
  gate = () => Promise.resolve(),
  now = Date.now,
  retryDelays = retryPolicy.delays,
}) {
  const progress = (phase, extra = {}) => emit({ event: 'progress', mediaType: type, phase, ...extra });
  const started = now();

  throwIfAborted(signal);
  progress('categories');
  const retry = { delays: retryDelays, signal, gate, onRetry: (attempt, attempts) => progress('retry', { attempt, attempts }) };
  const categories = categoryRows(type, await loadWithRetries(() => client.getCategories(type, { signal }), retry));

  await gate();
  throwIfAborted(signal);
  progress('download');
  const downloadStart = now();
  const raw = await loadWithRetries(() => client.getStreams(type, { signal }), retry);
  const fetchMs = now() - downloadStart;

  const byKey = new Map();
  raw.forEach((row) => {
    const item = projectItem(type, row);
    if (item) byKey.set(item.key, item);
  });
  const projected = Array.from(byKey.values());
  const rawCount = raw.length;
  raw.length = 0; // let the big raw list be collected before the heavy writes

  // Never let a glitchy empty answer wipe a catalog we already have.
  const previous = await getSyncMeta(db, type);
  if (projected.length === 0 && previous && previous.itemCount > 0) {
    throw new AppError(ErrorCode.BAD_RESPONSE, 'The provider returned an empty list', { details: { rawCount } });
  }
  // Channels / titles of the categories the user hid are not kept at all: they do not count and cost no space.
  const items = excludedCategories.size ? projected.filter((item) => !excludedCategories.has(item.categoryId)) : projected;

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
  const entries = buildEntries(type, items, { excludedCategories, cleanTitles });
  const { groups, networks, report } = type === MediaType.LIVE ? buildLiveComposites(entries, items, excludedCategories, grouping) : { groups: [], networks: [], report: null };
  const buildMs = now() - entriesStart;
  await writeEntries(db, type, entries, { groups, networks });
  if (report) await dbPut(db, 'meta', { key: NETWORK_REPORT_KEY, type, report });
  const entriesMs = now() - entriesStart;
  await replaceRows(db, 'categories', type, categories);
  const writeMs = now() - writeStart;

  const meta = {
    key: metaKey(type),
    type,
    lastSync: now(),
    genres: true,
    itemCount: items.length,
    entryCount: entries.length,
    ...(type === MediaType.LIVE ? { layout: LIVE_LAYOUT, ...groupCounts(entries, groups, networks) } : {}),
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
export async function runSync({ db, client, types = SYNC_ORDER, excluded = {}, cleanTitles = true, grouping = DEFAULT_GROUPING, force = false, signal, emit = () => {}, gate, now = Date.now, retryDelays }) {
  const results = [];
  for (const type of types) {
    try {
      throwIfAborted(signal);
      const stored = await getSyncMeta(db, type);
      const oldLayout = type === MediaType.LIVE && stored && stored.layout !== LIVE_LAYOUT; // lists of an older layout are downloaded again once
      if (!force && !oldLayout && !shouldSync(stored, now())) {
        emit({ event: 'progress', mediaType: type, phase: 'skipped' });
        results.push({ type, skipped: true });
        continue;
      }
      const meta = await syncType({ db, client, type, excludedCategories: excluded[type] || new Set(), cleanTitles, grouping, signal, emit, gate, now, retryDelays });
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
export async function runSyncForProvider({ provider, types, excluded, cleanTitles = true, grouping = DEFAULT_GROUPING, force, signal, emit = () => {}, gate, openDb = openProviderDb, makeClient }) {
  let db = null;
  let results = [];
  let failure = null;
  try {
    const client = makeClient ? makeClient(provider) : new XtreamClient(provider);
    emit({ event: 'progress', mediaType: null, phase: 'auth' });
    const auth = await client.authenticate();
    emit({ event: 'account', expiresAt: (auth && auth.user && auth.user.expiresAt) || null });
    db = await openDb(provider.id);
    results = await runSync({ db, client, types, excluded, cleanTitles, grouping, force, signal, emit, gate });
  } catch (err) {
    const error = toAppError(err);
    failure = { code: error.code, message: error.message };
    if (error.details && error.details.expiresAt) emit({ event: 'account', expiresAt: error.details.expiresAt }); // expired account: still show the date
    emit({ event: 'progress', mediaType: null, phase: 'error', code: error.code, message: error.message });
  } finally {
    if (db) db.close();
  }
  const outcome = { event: 'done', results, error: failure };
  emit(outcome);
  return outcome;
}
