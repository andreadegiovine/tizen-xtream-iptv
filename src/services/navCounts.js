import { kvGet, kvSet } from '../db/kv.js';

const KEY = 'navCounts';

/**
 * The last known numbers of the navigation entries that are shown only when they have something (top bar: favourites, collections,
 * suggestions; sidebars: continue watching, favourites, suggestions per type), per provider, kept in the app database. A page shows its
 * entries at once from them, and corrects them when the numbers worked out now arrive (they take a while: suggestions come from TMDB / Trakt).
 * Keys: 'top:favorites', 'top:collections', 'top:suggestions', '<type>:<kind>' (e.g. 'movie:continue').
 */
export function createNavCounts({ db, saveDelayMs = 500 }) {
  let data = {};
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => kvSet(db, KEY, data).catch(() => undefined), saveDelayMs);
  };
  return {
    /** Read once at start (before the first page). */
    async load() {
      const stored = await kvGet(db, KEY, {}).catch(() => ({}));
      data = stored && typeof stored === 'object' ? stored : {};
    },
    /** The last number known, or undefined. */
    get(providerId, key) {
      const found = providerId && data[providerId] ? data[providerId][key] : undefined;
      return typeof found === 'number' ? found : undefined;
    },
    set(providerId, key, n) {
      if (!providerId || typeof n !== 'number') return;
      const own = data[providerId] || (data[providerId] = {});
      if (own[key] === n) return;
      own[key] = n;
      save();
    },
  };
}
