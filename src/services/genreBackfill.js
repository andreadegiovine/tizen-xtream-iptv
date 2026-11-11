import { dbGet, dbGetAllKeys, dbPut, dbClear, dbDeleteMany, transactionDone } from '../core/idb.js';
import { openProviderDb } from '../db/providerDb.js';
import { XtreamClient } from './xtreamClient.js';
import { createTmdbClient } from './tmdbClient.js';
import { mergeGenres } from './genres.js';
import { openAppDb } from '../db/appDb.js';
import { normalizeMeta, gridMeta, metaKey, META_TTL_MS, NOT_FOUND_TTL_MS } from './tmdbService.js';
import { createPacer } from './pacer.js';

const STORE = 'entry_genre_tmdb';
export const GENRE_BATCH = 60;
export const MAX_PER_RUN = 3000;

/** Replaces the genres one source gave for an entry (`source` = tmdb | info | none: a "nothing found" marker). */
export async function writeGenres(db, entry, genreNames, source) {
  const genres = source === 'none' ? [{ key: '', name: '' }] : mergeGenres(genreNames);
  const prefix = `${entry.key}|`;
  const suffix = `|${source}`;
  const existing = (await dbGetAllKeys(db, STORE, { range: IDBKeyRange.bound(prefix, `${prefix}￿`) })).filter((key) => key.endsWith(suffix));
  const replace = source === 'tmdb' && genres.length; // TMDB's genres replace the provider's for this title
  const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
  const stale = replace ? (await dbGetAllKeys(db, STORE, { range })).filter((key) => key.endsWith('|info')) : [];
  const fromList = replace ? await dbGetAllKeys(db, 'entry_genre', { range }) : [];
  const tx = db.transaction([STORE, 'entry_genre'], 'readwrite');
  const store = tx.objectStore(STORE);
  existing.concat(stale).forEach((key) => store.delete(key));
  fromList.forEach((key) => tx.objectStore('entry_genre').delete(key));
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
 * The provider is asked at an adaptive pace (pacer.js): a few details at a time, more while it answers well, fewer with a pause as soon
 * as it fails or slows down, as fast as it takes it (it used to be one a second and 500 a day, which took days on a big catalog).
 * After this many failures in a row it is not asked any more in this run.
 */
export const PROVIDER_MAX_FAILURES = 8;
export const PROVIDER_CONCURRENCY = 6;
export async function runGenreBackfill({ db, xtream, tmdb, language, signal, gate = () => Promise.resolve(), emit = () => {}, limit = MAX_PER_RUN, pace = createPacer({ max: PROVIDER_CONCURRENCY, start: 2 }), concurrency = PROVIDER_CONCURRENCY }) {
  if (await dbGet(db, 'meta', GENRES_SOURCE_KEY)) return 0; // TMDB's genres are the only ones: the provider is not asked
  let total = 0;
  let failures = 0;
  let stopped = false;
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
      if (stopped) return { retry: true };
      try {
        const raw = await pace.run(() => (entry.type === 'series' ? xtream.getSeriesInfo(entry.defaultId) : xtream.getVodInfo(entry.defaultId)));
        failures = 0;
        const text = raw && raw.info && raw.info.genre;
        if (text) return { names: text, source: 'info' };
      } catch (err) {
        failures += 1;
        if (failures >= PROVIDER_MAX_FAILURES && !stopped) {
          stopped = true; // the next run tries again
          emit({ event: 'info', level: 'warn', message: `Genres: the provider failed ${failures} times in a row (${(err && err.message) || err}), the search goes on at the next run` });
        }
        return { retry: true }; // nothing recorded: tried again next time
      }
    }
    return null;
  }

  for (const type of ['movie', 'series']) {
    const tried = new Set();
    let list = await missing(db, type, GENRE_BATCH, tried);
    while (list.length && total < limit && !stopped && !aborted()) {
      await gate();
      let next = 0;
      const worker = async () => {
        while (next < list.length && total < limit && !stopped && !aborted()) {
          const entry = list[next];
          next += 1;
          await gate();
          const found = await genresFor(entry);
          tried.add(entry.key);
          if (found && found.retry) continue;
          await writeGenres(db, entry, found ? found.names : null, found ? found.source : 'none');
          total += 1;
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
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
  const aborted = () => Boolean(signal && signal.aborted);
  const due = titles.filter((title) => !fresh.has(metaKey(title.type, title.tmdbId, language)));
  let done = 0;
  let failures = 0;
  let firstFailure = '';
  emit({ event: 'info', message: titles.length ? `TMDB: ${titles.length} titles with a TMDB id, ${due.length} to download` : 'TMDB: no title of the catalog carries a TMDB id (the provider does not send it): nothing to download' });
  emit({ event: 'progress', done, total: due.length });

  const restored = await restoreTmdbGenres({ db, appDb, titles, fresh, language, signal, gate, emit });
  done += restored;

  async function download(title) {
    let value = null;
    try {
      value = gridMeta(normalizeMeta(title.type, await tmdb.details(title.type, title.tmdbId, language, { full: false }), language));
    } catch (err) {
      if (!(err && err.details && err.details.status === 404)) {
        failures += 1; // network / quota / invalid key: the next run tries again
        if (!firstFailure) firstFailure = `${(err && err.code) || ''} ${(err && err.details && err.details.status) || ''} ${(err && err.message) || ''}`.trim();
        return;
      }
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
    done = restored + Math.min(due.length, i + concurrency);
    if (done % 30 < concurrency || done === restored + due.length) emit({ event: 'progress', done, total: restored + due.length });
  }
  if (failures) emit({ event: 'info', level: 'warn', message: `TMDB: ${failures} requests failed (first: ${firstFailure})` });
  else if (!aborted()) await markTmdbComplete(db, emit);
  return done;
}

/** Marker in the provider database: every title has been through TMDB, whose genres are now the only ones. */
export const GENRES_SOURCE_KEY = 'genres:source';

/**
 * TMDB's genres replace all the provider's: once every title has been through TMDB the provider's genres (the sync list and the ones
 * read from details) are removed, and a marker keeps them from being written or searched again until the next catalog sync.
 */
export async function markTmdbComplete(db, emit = () => {}) {
  await dbClear(db, 'entry_genre');
  const stale = (await dbGetAllKeys(db, STORE)).filter((key) => key.endsWith('|info'));
  await dbDeleteMany(db, STORE, stale);
  await dbPut(db, 'meta', { key: GENRES_SOURCE_KEY, source: 'tmdb' });
  emit({ event: 'info', message: 'TMDB: its genres now replace the provider\'s' });
}

/**
 * Writes again, from the metadata already saved in the app database (no request), the TMDB genres that are not in the provider database
 * (emptied, or lost). Resolves with how many titles were written. With no title left to download the TMDB genres become the only ones.
 */
export async function restoreTmdbGenres({ db, appDb, titles = null, fresh = null, language, signal, gate = () => Promise.resolve(), emit = () => {}, now = Date.now }) {
  const all = titles || (await collectTmdbTitles(db));
  const live = fresh || new Set(await dbGetAllKeys(appDb, 'tmdb', { index: 'byExpires', range: IDBKeyRange.lowerBound(now(), true) }));
  const withGenres = new Set((await dbGetAllKeys(db, STORE)).filter((key) => key.endsWith('|tmdb')).map((key) => key.slice(0, key.indexOf('|'))));
  const aborted = () => Boolean(signal && signal.aborted);
  let restored = 0;
  for (const title of all) {
    if (aborted() || !live.has(metaKey(title.type, title.tmdbId, language)) || title.entries.some((entry) => withGenres.has(entry.key))) continue;
    const record = await dbGet(appDb, 'tmdb', metaKey(title.type, title.tmdbId, language));
    const list = record && record.value && record.value.genreList;
    if (!list || !list.length) continue;
    for (const entry of title.entries) await writeGenres(db, entry, list.map((g) => g.name), 'tmdb');
    restored += 1;
    if (restored % 50 === 0) await gate();
  }
  if (restored) emit({ event: 'info', message: `TMDB: genres written again from the saved metadata for ${restored} titles` });
  if (!titles && !aborted() && all.length && all.every((title) => live.has(metaKey(title.type, title.tmdbId, language)))) await markTmdbComplete(db, emit);
  return restored;
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
    if (phase === 'restore') {
      appDb = await openAppDb();
      done = await restoreTmdbGenres({ db, appDb, language, signal, gate, emit });
    } else if (phase === 'tmdb') {
      if (tmdb.enabled) {
        appDb = await openAppDb();
        done = await runTmdbDownload({ db, appDb, tmdb, language, signal, gate, emit, force });
      }
    } else if (provider.type !== 'm3u') {
      // The provider's genres come from its per-title details: a playlist has none.
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
