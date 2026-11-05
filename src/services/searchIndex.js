import { makeSearchKey } from './titleNormalizer.js';
import { requestToPromise } from '../core/idb.js';

/** One light row per entry (name + normalized keys), kept in memory: search never touches IndexedDB. */
export async function loadSearchRows(db, types) {
  const rows = [];
  for (const type of types) {
    const tx = db.transaction('entries', 'readonly');
    const all = await requestToPromise(tx.objectStore('entries').index('byTypeAdded').getAll(IDBKeyRange.bound([type, 0], [type, Number.MAX_SAFE_INTEGER])));
    for (const entry of all) {
      if (entry.groupKey) continue; // a channel in a group is found through the group
      rows.push({ key: entry.key, type, name: entry.name, year: entry.year, icon: entry.icon, rating: entry.rating, tmdbId: entry.tmdbId, defaultId: entry.defaultId, members: entry.members, categoryIds: entry.categoryIds, adult: entry.adult, keys: entry.searchKeys || [makeSearchKey(entry.name)], added: entry.added, groupKey: entry.groupKey || null });
    }
    if (type === 'live') {
      const groups = await requestToPromise(db.transaction('groups', 'readonly').objectStore('groups').getAll());
      groups.forEach((group) => rows.push({ key: group.key, type, name: group.name, year: null, icon: group.icon, rating: null, tmdbId: null, defaultId: group.defaultId, members: group.members, categoryIds: group.categoryIds, adult: group.adult, keys: group.searchKeys, added: group.added, isGroup: !group.isNetwork, group: !group.isNetwork, isNetwork: Boolean(group.isNetwork), memberKeys: group.memberKeys }));
    }
  }
  return rows;
}

/**
 * Every query word must appear in one of the entry's keys. Ranking: whole-title match, then title
 * starting with the query, then word-start matches, then the rest; newer first inside a rank.
 */
export function searchRows(rows, query, { limit = 40, types = null } = {}) {
  const normalized = makeSearchKey(query);
  if (normalized.length < 2) return [];
  const words = normalized.split(' ');
  const scored = [];
  for (const row of rows) {
    if (types && !types.includes(row.type)) continue;
    let best = -1;
    for (const key of row.keys) {
      if (!words.every((word) => key.includes(word))) continue;
      let rank = 1;
      if (key === normalized) rank = 4;
      else if (key.startsWith(normalized)) rank = 3;
      else if (words.every((word) => key.startsWith(word) || key.includes(` ${word}`))) rank = 2;
      if (rank > best) best = rank;
    }
    if (best > 0) scored.push({ row, rank: best });
  }
  scored.sort((a, b) => b.rank - a.rank || b.row.added - a.row.added);
  return scored.slice(0, limit).map((s) => s.row);
}

/**
 * Search service. With `createWorker` the index is built and queried in a worker (nothing heavy on the UI thread); without it (tests,
 * browsers without workers, a worker that fails) the same code runs in the page. `warm()` loads the index of the active provider ahead
 * of the first search; `invalidate()` drops it (after a catalog sync) and the next `warm()` / `search()` loads it again.
 */
export function createSearchService({ active, types = ['movie', 'series', 'live'], createWorker = null }) {
  let cache = null; // in-page index: { providerId, rows: Promise }
  let worker = null;
  let workerOff = !createWorker;
  let loaded = null; // { providerId, ready: Promise } the worker has (or is loading)
  let nextId = 0;
  let token = 0;
  const waiting = new Map(); // search id → resolve
  const loads = new Map(); // load token → { resolve, reject }

  function failWorker() {
    workerOff = true;
    loaded = null;
    if (worker) worker.terminate();
    worker = null;
    waiting.forEach((resolve) => resolve(null)); // those searches run again in the page
    waiting.clear();
    loads.forEach((load) => load.reject(new Error('Search worker failed')));
    loads.clear();
  }

  function getWorker() {
    if (workerOff) return null;
    if (!worker) {
      try {
        worker = createWorker();
      } catch {
        failWorker();
        return null;
      }
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.event === 'result' && waiting.has(message.id)) {
          waiting.get(message.id)(message.rows);
          waiting.delete(message.id);
        } else if (message.event === 'ready' && loads.has(message.token)) {
          loads.get(message.token).resolve();
          loads.delete(message.token);
        } else if (message.event === 'error' && loads.has(message.token)) {
          loads.get(message.token).reject(new Error(message.message || 'Search index failed'));
          loads.delete(message.token);
        }
      };
      worker.onerror = failWorker;
    }
    return worker;
  }

  /** Has the worker load the index of the active provider (once; again after `invalidate()`). */
  function ensureLoaded(current) {
    const w = getWorker();
    if (!w) return null;
    if (!loaded || loaded.providerId !== current.provider.id) {
      token += 1;
      const mine = token;
      const ready = new Promise((resolve, reject) => loads.set(mine, { resolve, reject }));
      w.postMessage({ op: 'load', providerId: current.provider.id, types, token: mine });
      loaded = { providerId: current.provider.id, ready };
      ready.catch(() => {
        if (loaded && loaded.ready === ready) loaded = null;
      });
    }
    return loaded.ready;
  }

  function inPage(current, query, options) {
    if (!cache || cache.providerId !== current.provider.id) cache = { providerId: current.provider.id, rows: loadSearchRows(current.db, types) };
    return cache.rows.then((rows) => searchRows(rows, query, options));
  }

  return {
    invalidate() {
      cache = null;
      loaded = null;
    },
    /** Loads the index in the background (at start, after a sync): the first search finds it ready. */
    async warm() {
      const current = await active.get();
      if (!current) return;
      const ready = ensureLoaded(current);
      if (ready) await ready.catch(() => undefined);
      else await (cache && cache.providerId === current.provider.id ? cache.rows : (cache = { providerId: current.provider.id, rows: loadSearchRows(current.db, types) }).rows);
    },
    async search(query, options) {
      const current = await active.get();
      if (!current) return [];
      const ready = ensureLoaded(current);
      if (ready) {
        try {
          await ready;
          const w = getWorker();
          if (w) {
            nextId += 1;
            const id = nextId;
            const found = await new Promise((resolve) => {
              waiting.set(id, resolve);
              w.postMessage({ op: 'search', id, query, options });
            });
            if (found) return found;
          }
        } catch {
          failWorker();
        }
      }
      return inPage(current, query, options);
    },
  };
}
