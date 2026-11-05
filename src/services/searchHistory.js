import { kvGet, kvSet } from '../db/kv.js';

const KEY = 'searchHistory';
export const HISTORY_MAX = 10;

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** The last searches (10 at most, newest first, kept in the app database): shown when the search page opens. */
export function createSearchHistory({ db }) {
  let cache = null;
  const load = async () => {
    if (!cache) {
      const stored = await kvGet(db, KEY, []);
      cache = Array.isArray(stored) ? stored.filter((x) => typeof x === 'string') : [];
    }
    return cache;
  };
  return {
    list: async () => (await load()).slice(),
    /** Remembers a search (text of at least 2 characters); an older identical one moves to the top. */
    async add(text) {
      const clean = String(text || '').trim();
      if (clean.length < 2) return;
      const list = await load();
      cache = [clean].concat(list.filter((x) => !same(x, clean))).slice(0, HISTORY_MAX);
      await kvSet(db, KEY, cache);
    },
    async clear() {
      cache = [];
      await kvSet(db, KEY, cache);
    },
  };
}
