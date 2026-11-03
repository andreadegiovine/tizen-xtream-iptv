import { dbGetAllKeys, dbPut, transactionDone } from '../core/idb.js';
import { openProviderDb } from '../db/providerDb.js';
import { XtreamClient } from './xtreamClient.js';
import { createTmdbClient } from './tmdbClient.js';
import { mergeGenres } from './genres.js';
import { openAppDb } from '../db/appDb.js';
import { normalizeMeta, gridMeta, metaKey, META_TTL_MS, NOT_FOUND_TTL_MS } from './tmdbService.js';

const STORE = 'entry_genre_tmdb';
export const GENRE_BATCH = 60;
export const MAX_PER_RUN = 3000;

/** Replaces the genres one source gave for an entry (`source` = tmdb | info | none: a "nothing found" marker). */
export async function writeGenres(db, entry, genreNames, source) {
  const genres = source === 'none' ? [{ key: '', name: '' }] : mergeGenres(genreNames);
  const prefix = `${entry.key}|`;
  const suffix = `|${source}`;
  const existing = (await dbGetAllKeys(db, STORE, { range: IDBKeyRange.bound(prefix, `${prefix}￿`) })).filter((key) => key.endsWith(suffix));
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  existing.forEach((key) => store.delete(key));
  genres.forEach((g) => store.put({ key: `${prefix}${g.key}${suffix}`, entryKey: entry.key, type: entry.type, genreKey: g.key, name: g.name, added: entry.added || 0 }));
  await transactionDone(tx);
}

/** Entries without any genre (none from the provider list, none learned yet, not already tried), newest first. */
async function missing(db, type, limit, tried) {
  const known = new Set((await dbGetAllKeys(db, STORE)).map((key) => key.slice(0, key.indexOf('|'))));
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction('entries', 'readonly');
    const request = tx.objectStore('entries').index('byTypeAdded').openCursor(IDBKeyRange.bound([type, 0], [type, Number.MAX_SAFE_INTEGER]), 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value;
      if (!(entry.genres && entry.genres.length) && !known.has(entry.key) && !tried.has(entry.key)) out.push(entry);
      if (out.length < limit) cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve(out);
  });
}

/**
 * Finds the genres of titles whose list row had none: TMDB first (when it is configured and the title has a
 * tmdb id), otherwise the provider's own detail call. Runs in a worker, a few titles at a time, newest first;
 * `gate()` lets the caller pause it (playback, catalog sync).
 */
export async function runGenreBackfill({ db, xtream, tmdb, language, signal, gate = () => Promise.resolve(), emit = () => {}, limit = MAX_PER_RUN, concurrency = 3 }) {
  let total = 0;
  const aborted = () => Boolean(signal && signal.aborted);

  async function genresFor(entry) {
    if (tmdb && tmdb.enabled && entry.tmdbId) {
      try {
        const data = await tmdb.details(entry.type, entry.tmdbId, language);
        const names = ((data && data.genres) || []).map((g) => g.name);
        if (names.length) return { names, source: 'tmdb' };
      } catch {
        /* try the provider */
      }
    }
    if (xtream) {
      try {
        const raw = entry.type === 'series' ? await xtream.getSeriesInfo(entry.defaultId) : await xtream.getVodInfo(entry.defaultId);
        const text = raw && raw.info && raw.info.genre;
        if (text) return { names: text, source: 'info' };
      } catch {
        /* the next run tries again only if nothing was recorded */
        return { retry: true };
      }
    }
    return null;
  }

  for (const type of ['movie', 'series']) {
    const tried = new Set();
    let list = await missing(db, type, GENRE_BATCH, tried);
    while (list.length && total < limit && !aborted()) {
      await gate();
      for (let i = 0; i < list.length; i += concurrency) {
        await Promise.all(
          list.slice(i, i + concurrency).map(async (entry) => {
            const found = await genresFor(entry);
            if (found && found.retry) return;
            await writeGenres(db, entry, found ? found.names : null, found ? found.source : 'none');
          }),
        );
      }
      total += list.length;
      list.forEach((entry) => tried.add(entry.key));
      emit({ event: 'progress', done: total });
      list = await missing(db, type, GENRE_BATCH, tried);
    }
  }
  return total;
}

/** Distinct titles of the provider that carry a tmdb id, newest first: [{ type, tmdbId, entries: [entry] }]. */
export function collectTmdbTitles(db) {
  return new Promise((resolve, reject) => {
    const byId = new Map();
    const tx = db.transaction('entries', 'readonly');
    const request = tx.objectStore('entries').index('byTypeAdded').openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value;
      if ((entry.type === 'movie' || entry.type === 'series') && entry.tmdbId) {
        const id = `${entry.type}:${entry.tmdbId}`;
        const hit = byId.get(id);
        const slim = { key: entry.key, type: entry.type, added: entry.added || 0 };
        if (hit) hit.entries.push(slim);
        else byId.set(id, { type: entry.type, tmdbId: entry.tmdbId, entries: [slim] });
      }
      cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve(Array.from(byId.values()).sort((a, b) => b.entries[0].added - a.entries[0].added));
  });
}

/**
 * Downloads TMDB metadata for every title with a tmdb id (not only those without genres) into the app
 * database, keyed by tmdb id and language. Fresh records are skipped (unless `force`), expired ones are
 * downloaded again. The genres TMDB gives are written for every entry of the title.
 */
export async function runTmdbDownload({ db, appDb, tmdb, language, signal, gate = () => Promise.resolve(), emit = () => {}, force = false, concurrency = 3, now = Date.now }) {
  const titles = await collectTmdbTitles(db);
  const fresh = force
    ? new Set()
    : new Set(await dbGetAllKeys(appDb, 'tmdb', { index: 'byExpires', range: IDBKeyRange.lowerBound(now(), true) }));
  const due = titles.filter((title) => !fresh.has(metaKey(title.type, title.tmdbId, language)));
  const aborted = () => Boolean(signal && signal.aborted);
  let done = 0;
  emit({ event: 'progress', done, total: due.length });

  async function download(title) {
    let value = null;
    try {
      value = gridMeta(normalizeMeta(title.type, await tmdb.details(title.type, title.tmdbId, language, { full: false }), language));
    } catch (err) {
      if (!(err && err.details && err.details.status === 404)) return; // network / quota: the next run tries again
    }
    const stamp = now();
    await dbPut(appDb, 'tmdb', { key: metaKey(title.type, title.tmdbId, language), value, fetchedAt: stamp, expiresAt: stamp + (value ? META_TTL_MS : NOT_FOUND_TTL_MS) });
    if (value && value.genreList.length) {
      const names = value.genreList.map((g) => g.name);
      for (const entry of title.entries) await writeGenres(db, entry, names, 'tmdb');
    }
  }

  for (let i = 0; i < due.length && !aborted(); i += concurrency) {
    await gate();
    if (aborted()) break;
    await Promise.all(due.slice(i, i + concurrency).map(download));
    done = Math.min(due.length, i + concurrency);
    if (done % 30 < concurrency || done === due.length) emit({ event: 'progress', done, total: due.length });
  }
  return done;
}

/**
 * Shared by the worker and the main-thread fallback. `phase`: "tmdb" downloads the metadata, "genres" asks the
 * provider for the genres of titles still without any.
 */
export async function runGenreBackfillForProvider({ provider, tmdbKey, language, signal, gate, emit = () => {}, limit, phase = 'genres', force = false }) {
  let db = null;
  let appDb = null;
  let done = 0;
  try {
    db = await openProviderDb(provider.id);
    const tmdb = createTmdbClient({ getApiKey: () => tmdbKey });
    if (phase === 'tmdb') {
      if (tmdb.enabled) {
        appDb = await openAppDb();
        done = await runTmdbDownload({ db, appDb, tmdb, language, signal, gate, emit, force });
      }
    } else {
      const xtream = new XtreamClient({ baseUrl: provider.baseUrl, username: provider.username, password: provider.password });
      await xtream.authenticate().catch(() => undefined);
      done = await runGenreBackfill({ db, xtream, tmdb: null, language, signal, gate, emit, limit });
    }
  } finally {
    if (db) db.close();
    if (appDb) appDb.close();
  }
  emit({ event: 'done', done });
  return done;
}
