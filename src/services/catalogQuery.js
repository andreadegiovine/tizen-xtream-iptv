import { requestToPromise } from '../core/idb.js';
import { isCompositeKey, NETWORK_PREFIX, LIVE_ALL } from './liveGrouping.js';
import { loadSearchRows, searchRows } from './searchIndex.js';

export { LIVE_ALL };

/** Grouped live channels are in their own store; every other entry is in `entries`. */
const storeOf = (key) => (isCompositeKey(key) ? 'groups' : 'entries');

const MAX_ADDED = Number.MAX_SAFE_INTEGER;

/** Categories of one type, alphabetical (locale-aware). */
export async function listCategories(db, type) {
  const tx = db.transaction('categories', 'readonly');
  const all = await requestToPromise(tx.objectStore('categories').getAll(IDBKeyRange.bound(`${type}:`, `${type}:￿`)));
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * One page of grid entries, newest first.
 * - without `categoryId`: walks `entries` by (type, added);
 * - with `categoryId`: walks `entry_cat` by (type, category, added) and joins the entries.
 * Reads `limit + 1` rows to know whether another page exists, without counting anything.
 */
export function pageEntries(db, { type, categoryId = null, offset = 0, limit = 21 }) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'entry_cat'], 'readonly');
    const useCategory = categoryId !== null && categoryId !== undefined;
    const source = useCategory
      ? tx.objectStore('entry_cat').index('byCatAdded')
      : tx.objectStore('entries').index('byTypeAdded');
    const range = useCategory
      ? IDBKeyRange.bound([type, String(categoryId), 0], [type, String(categoryId), MAX_ADDED])
      : IDBKeyRange.bound([type, 0], [type, MAX_ADDED]);
    const rows = [];
    let skipped = offset === 0;
    const request = source.openCursor(range, 'prev');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!skipped) {
        skipped = true;
        cursor.advance(offset);
        return;
      }
      rows.push(cursor.value);
      if (rows.length <= limit) cursor.continue();
    };
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = async () => {
      try {
        const hasMore = rows.length > limit;
        const wanted = rows.slice(0, limit);
        if (!useCategory) {
          resolve({ entries: wanted, hasMore });
          return;
        }
        const readTx = db.transaction(['entries', 'groups'], 'readonly');
        const entries = await Promise.all(wanted.map((row) => requestToPromise(readTx.objectStore(storeOf(row.entryKey)).get(row.entryKey))));
        resolve({ entries: entries.filter(Boolean), hasMore });
      } catch (err) {
        reject(err);
      }
    };
  });
}

/** The networks of Live TV, alphabetical: [{ key, name, icon, memberKeys, manualKeys, channelCount }]. */
export async function listNetworks(db) {
  const all = await requestToPromise(db.transaction('groups', 'readonly').objectStore('groups').getAll(IDBKeyRange.bound(NETWORK_PREFIX, `${NETWORK_PREFIX}\uffff`)));
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** One grid entry by key (`movie:t603`, `series:i12`...). */
export async function getEntry(db, key) {
  const store = storeOf(key);
  return requestToPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
}

/**
 * Channels to merge with: the groups first (flagged `group`), then the channels that are in none.
 * `skipId` is the channel being merged. Returns [{ key, name, icon, group, memberId, count }].
 */
export function createMergeSearch(db, skipId) {
  let cache = null;
  const load = () => {
    if (!cache) {
      cache = loadSearchRows(db, ['live']).then((rows) => ({ rows: rows.filter((r) => !r.isNetwork && r.defaultId !== skipId) }));
    }
    return cache;
  };
  return async (query, limit = 30) => {
    const { rows } = await load();
    const groups = searchRows(rows.filter((r) => r.group), query, { limit });
    const singles = searchRows(rows.filter((r) => !r.group && !r.isNetwork), query, { limit });
    return groups.concat(singles).slice(0, limit).map((row) => ({ key: row.key, name: row.name, icon: row.icon, group: Boolean(row.group), memberId: row.defaultId, count: row.group ? row.members.length : 1 }));
  };
}

const GENRE_STORES = ['entry_genre', 'entry_genre_tmdb'];

/** Distinct genres of one type present in the catalog (provider and TMDB spellings already merged): [{ key, name }]. */
export function listGenres(db, type) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GENRE_STORES, 'readonly');
    const found = new Map();
    GENRE_STORES.forEach((storeName) => {
      const request = tx.objectStore(storeName).index('byGenreAdded').openCursor(IDBKeyRange.bound([type], [type, []]));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const row = cursor.value;
        if (row.genreKey && !found.has(row.genreKey)) found.set(row.genreKey, { key: row.genreKey, name: row.name });
        cursor.continue([type, `${row.genreKey}\u0000`]); // jump to the next genre
      };
    });
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve(Array.from(found.values()));
  });
}

/** Genres of one entry (provider and TMDB sources merged): [{ key, name }]. */
export async function entryGenres(db, entryKey) {
  const range = IDBKeyRange.bound(`${entryKey}|`, `${entryKey}|\uffff`);
  const lists = await Promise.all(GENRE_STORES.map((name) => requestToPromise(db.transaction(name, 'readonly').objectStore(name).getAll(range))));
  const out = new Map();
  lists.forEach((rows) => rows.forEach((row) => row.genreKey && !out.has(row.genreKey) && out.set(row.genreKey, { key: row.genreKey, name: row.name })));
  return Array.from(out.values());
}

/** Entry keys of a genre, newest first, from both sources without duplicates. */
export async function genreEntryKeys(db, type, genreKey) {
  const range = IDBKeyRange.bound([type, genreKey, 0], [type, genreKey, MAX_ADDED]);
  const lists = await Promise.all(
    GENRE_STORES.map((name) => requestToPromise(db.transaction(name, 'readonly').objectStore(name).index('byGenreAdded').getAll(range))),
  );
  const byKey = new Map();
  lists.forEach((rows) => rows.forEach((row) => byKey.set(row.entryKey, row.added)));
  return Array.from(byKey.keys()).sort((a, b) => byKey.get(b) - byKey.get(a) || (a < b ? -1 : 1));
}

/** Titles per genre key of one type (both sources, no duplicates): Map(genreKey → count). */
export async function genreCounts(db, type) {
  const range = IDBKeyRange.bound([type], [type, []]);
  const lists = await Promise.all(GENRE_STORES.map((name) => requestToPromise(db.transaction(name, 'readonly').objectStore(name).index('byGenreAdded').getAll(range))));
  const sets = new Map();
  lists.forEach((rows) =>
    rows.forEach((row) => {
      if (!row.genreKey) return;
      if (!sets.has(row.genreKey)) sets.set(row.genreKey, new Set());
      sets.get(row.genreKey).add(row.entryKey);
    }),
  );
  return new Map(Array.from(sets, ([key, set]) => [key, set.size]));
}

/** How many entries a browse view holds (for "page X of Y"): all of a type, or one category. */
export function countEntries(db, { type, categoryId = null }) {
  const useCategory = categoryId !== null && categoryId !== undefined;
  const store = useCategory ? 'entry_cat' : 'entries';
  const index = db.transaction(store, 'readonly').objectStore(store).index(useCategory ? 'byCatAdded' : 'byTypeAdded');
  const range = useCategory ? IDBKeyRange.bound([type, String(categoryId), 0], [type, String(categoryId), MAX_ADDED]) : IDBKeyRange.bound([type, 0], [type, MAX_ADDED]);
  return requestToPromise(index.count(range));
}
