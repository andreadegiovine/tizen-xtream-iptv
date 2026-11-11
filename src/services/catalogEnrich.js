import { dbGetAllRange, dbPutMany } from '../core/idb.js';
import { MediaType } from './mediaType.js';
import { readTmdbId, readRating, readYear } from './itemProjector.js';
import { normalizeTitle } from './titleNormalizer.js';
import { pickMatch } from './tmdbService.js';
import { createTmdbClient } from './tmdbClient.js';
import { createPacer } from './pacer.js';

/**
 * Titles the provider lists without a TMDB id (some providers give it only in the details of a title): during the catalog scan the
 * details (get_vod_info / get_series_info) of each are read once and what the lists lack is kept (TMDB id, year, rating, poster, genre),
 * so the TMDB download, the grouping of versions, genres and suggestions work for them too. Optionally (Settings, TMDB), a title the
 * details have no id for either is looked for on TMDB by its title, with the conservative match of the title page (pickMatch).
 *
 * What was learned is kept per provider in the `enrich` store (`${type}:${id}`): the next scans apply it to the downloaded list without
 * asking again. A title whose details had no id is asked again after RECHECK_MS (the provider may add it); one the title search found
 * nothing for is searched again after RECHECK_MS too (TMDB may add it), and at once when its title or year in the list changed (a
 * title found by an old name is searched again as well).
 */
export const RECHECK_MS = 30 * 24 * 3600 * 1000;
/**
 * At most this many details asked at the same time: the adaptive pace (pacer.js) starts lower and grows while the provider answers well,
 * and slows down (fewer at a time, a pause) as soon as it fails or slows down: the titles are done as fast as the provider takes it.
 */
export const INFO_CONCURRENCY = 8;
const TMDB_CONCURRENCY = 10; // TMDB takes about 40 requests a second
/** Failures in a row after which the details are not asked any more in this scan (network down, provider limiting us). */
export const MAX_FAILURES = 8;
/** The entries are worked out again every this many titles learned (the grids improve while a long scan goes on). */
export const REBUILD_EVERY = 1000;

export const ENRICHABLE = [MediaType.MOVIE, MediaType.SERIES];
const STORE = 'enrich';
const range = (type) => IDBKeyRange.bound(`${type}:`, `${type}:￿`);

/** What the details of a title give that a list may lack: { tmdbId, year, rating, icon, genre } (missing ones null / ''). */
export function readInfo(raw) {
  const info = (raw && raw.info) || {};
  const movie = (raw && raw.movie_data) || {};
  return {
    tmdbId: readTmdbId(info) || readTmdbId(movie),
    year: readYear(info),
    rating: readRating(info),
    icon: String(info.movie_image || info.cover_big || info.cover || ''),
    genre: String(info.genre || ''),
  };
}

/**
 * The item with what was learned about it: the TMDB id of the details always, the one of a title search only while that search is on
 * (`titleSearch`); year, rating, poster and genre only where the list has none. The list's own TMDB id always wins. Returns the same
 * object when nothing changes.
 */
export function enrichItem(item, record, { titleSearch = false } = {}) {
  if (item.tmdbId && !item.tmdbFrom) return item; // from the list
  const out = { ...item };
  delete out.tmdbFrom;
  out.tmdbId = null;
  if (record && record.tmdbId && (record.source === 'info' || (record.source === 'search' && titleSearch))) {
    out.tmdbId = record.tmdbId;
    out.tmdbFrom = record.source;
  }
  if (record) {
    if (!out.year && record.year) out.year = record.year;
    if (!out.rating && record.rating) out.rating = record.rating;
    if (!out.icon && record.icon) out.icon = record.icon;
    if (!out.genre && record.genre) out.genre = record.genre;
  }
  return JSON.stringify(out) === JSON.stringify(item) ? item : out;
}

async function readRecords(db, type) {
  const map = new Map();
  (await dbGetAllRange(db, STORE, range(type))).forEach((record) => map.set(record.key, record));
  return map;
}

/** Applies what was learned to a downloaded list before it is written (in place). Resolves with how many items changed. */
export async function applyEnrichment(db, type, items, { titleSearch = false } = {}) {
  if (!ENRICHABLE.includes(type)) return 0;
  const records = await readRecords(db, type);
  let changed = 0;
  for (let i = 0; i < items.length; i += 1) {
    const next = enrichItem(items[i], records.get(items[i].key), { titleSearch });
    if (next !== items[i]) {
      items[i] = next;
      changed += 1;
    }
  }
  return changed;
}

/** What a title search looks for: the clean title and the year (the list's, otherwise the details'). */
export function searchQuery(item, record) {
  const { cleanTitle, year } = normalizeTitle(item.name);
  return { title: cleanTitle, year: item.year || (record && record.year) || year || null };
}
const queryKey = (query) => `${query.title.toLowerCase()}|${query.year || ''}`;

/** Runs `fn` on every element, `concurrency` at a time, in order; stops starting new ones when `stop()` says so. */
async function eachLimited(list, concurrency, fn, stop) {
  let next = 0;
  const worker = async () => {
    while (next < list.length && !stop()) {
      const index = next;
      next += 1;
      await fn(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
}

/**
 * The enrichment of one type of the stored catalog: the stored items get what was learned (and lose the TMDB ids of a title search that
 * was switched off), then the titles still without a TMDB id are asked: details first (when not asked yet, or asked more than RECHECK_MS
 * ago), then, with `search` ({ tmdbKey, language }), TMDB by title. `rebuild()` works the entries out again from the stored items.
 * Resolves with { asked, found, searched, matched, changed }.
 */
export async function enrichType({
  db,
  client,
  type,
  search = null,
  rebuild,
  signal,
  gate = () => Promise.resolve(),
  progress = () => {},
  log = () => {},
  now = Date.now,
  concurrency = INFO_CONCURRENCY,
  maxFailures = MAX_FAILURES,
  rebuildEvery = REBUILD_EVERY,
  makeTmdb = (key) => createTmdbClient({ getApiKey: () => key }),
  providerPace = createPacer({ max: concurrency, start: 2 }),
  tmdbPace = createPacer({ max: TMDB_CONCURRENCY, start: 4 }),
  ask = true, // false: only what is known is applied (the learned data was forgotten: the ids it gave go), nothing is asked
}) {
  const result = { asked: 0, found: 0, searched: 0, matched: 0, changed: 0 };
  if (!ENRICHABLE.includes(type)) return result;
  const titleSearch = Boolean(search && search.tmdbKey);
  const records = await readRecords(db, type);
  const items = await dbGetAllRange(db, 'items', range(type));

  // 1. What is known already (and the search switched on or off).
  const updated = [];
  items.forEach((item, i) => {
    const next = enrichItem(item, records.get(item.key), { titleSearch });
    if (next !== item) {
      items[i] = next;
      updated.push(next);
    }
  });
  let pending = 0; // items changed since the last rebuild
  const flush = async (force = false) => {
    if (updated.length) {
      await dbPutMany(db, 'items', updated.splice(0));
    }
    if (pending && (force || pending >= rebuildEvery)) {
      pending = 0;
      await rebuild();
    }
  };
  pending += updated.length;
  result.changed += updated.length;
  await flush(true);

  if (!ask) return result;
  // 2. What still has no TMDB id: the details, then the title search.
  const t = now();
  const needsInfo = (item) => {
    const record = records.get(item.key);
    return !record || !record.checkedAt || (!record.tmdbId && t - record.checkedAt > RECHECK_MS);
  };
  // Searched again: never searched; nothing found and RECHECK_MS gone by; the title or year in the list changed since (found or not).
  const searchDue = (item, record, at) => {
    if (!titleSearch) return false;
    if (!record || !record.searchedAt) return true;
    if (record.searchedFor !== undefined && record.searchedFor !== queryKey(searchQuery(item, record))) return true;
    return record.source !== 'search' && at - record.searchedAt > RECHECK_MS;
  };
  const needsSearch = (item) => searchDue(item, records.get(item.key), t);
  let infoOff = typeof client.getVodInfo !== 'function' || client.detailsInLists === true; // a playlist has no details
  const fromSearch = (item) => item.tmdbFrom === 'search';
  const todo = items.filter((item) => (!item.tmdbId && ((!infoOff && needsInfo(item)) || needsSearch(item))) || (fromSearch(item) && needsSearch(item)));
  if (!todo.length) return result;
  const aborted = () => Boolean(signal && signal.aborted);
  let failures = 0;
  let done = 0;
  const tmdb = titleSearch ? makeTmdb(search.tmdbKey) : null;
  const toSave = [];
  progress({ done, total: todo.length });

  const learn = (item, record) => {
    records.set(item.key, record);
    toSave.push(record);
    const next = enrichItem(item, record, { titleSearch });
    if (next !== item) {
      updated.push(next);
      pending += 1;
      result.changed += 1;
    }
  };

  await eachLimited(
    todo,
    concurrency,
    async (item) => {
      await gate();
      if (aborted()) return;
      let record = records.get(item.key) || { key: item.key, tmdbId: null, source: null };
      if (!infoOff && needsInfo(item)) {
        try {
          result.asked += 1;
          const raw = await providerPace.run(() => (type === MediaType.SERIES ? client.getSeriesInfo(item.id) : client.getVodInfo(item.id)));
          const info = readInfo(raw);
          failures = 0;
          record = { ...record, ...info, tmdbId: info.tmdbId || null, source: info.tmdbId ? 'info' : null, checkedAt: now() };
          if (info.tmdbId) result.found += 1;
        } catch (err) {
          failures += 1;
          if (failures >= maxFailures && !infoOff) {
            infoOff = true; // the rest waits for the next scan
            log(`Details stopped after ${failures} failures in a row: ${(err && err.message) || err}`);
          }
        }
      }
      if (tmdb && (!record.tmdbId || record.source === 'search') && searchDue(item, record, now())) {
        try {
          result.searched += 1;
          const query = searchQuery(item, record);
          const data = await tmdbPace.run(() => tmdb.search(type, query.title, query.year, search.language));
          const id = pickMatch(type, data && data.results, query.title, query.year);
          // A new answer replaces the one of an older name (found or not); the id of the details is never replaced.
          const base = record.source === 'search' ? { ...record, tmdbId: null, source: null } : record;
          record = { ...base, searchedAt: now(), searchedFor: queryKey(query), ...(id ? { tmdbId: id, source: 'search' } : {}) };
          if (id) result.matched += 1;
        } catch {
          /* TMDB unreachable: searched again at the next scan */
        }
      }
      if (record.checkedAt || record.searchedAt) learn(item, record);
      done += 1;
      if (done % 25 === 0 || done === todo.length) {
        progress({ done, total: todo.length });
        await dbPutMany(db, STORE, toSave.splice(0));
        await flush();
      }
    },
    aborted,
  );
  await dbPutMany(db, STORE, toSave.splice(0));
  await flush(true);
  return result;
}
