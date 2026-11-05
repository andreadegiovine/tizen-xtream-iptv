/**
 * In-memory cache of what the browse pages read from the catalog: the sidebar (genres, categories, networks and their counts) and the
 * first page of the grids. It lives until the app closes or until the catalog changes (a sync, the genre / TMDB downloads, a rebuild
 * of the entries): `clear()`. While one of those jobs runs the cache is suspended (nothing read, nothing stored), because the data
 * is changing under it. Lists filled by the user (favourites, continue watching, suggestions) are never put here.
 */
export const PAGE_CACHE_LIMIT = 200;

/** `limit`: entries kept; past it the least recently used goes (a long session through many categories does not grow memory for ever). */
export function createPageCache({ limit = PAGE_CACHE_LIMIT } = {}) {
  const store = new Map();
  let suspended = false;
  return {
    get(key) {
      if (suspended || !store.has(key)) return null;
      const value = store.get(key);
      store.delete(key); // most recently used last
      store.set(key, value);
      return value;
    },
    set(key, value) {
      if (suspended) return;
      store.delete(key);
      store.set(key, value);
      while (store.size > limit) store.delete(store.keys().next().value);
    },
    clear: () => store.clear(),
    /** True while the catalog is being changed: the cache is bypassed; it is emptied when the job ends. */
    suspend(value) {
      suspended = Boolean(value);
      if (suspended) store.clear();
    },
    size: () => store.size,
  };
}
