/**
 * In-memory cache of what the browse pages read from the catalog: the sidebar (genres, categories, networks and their counts) and the
 * first page of the grids. It lives until the app closes or until the catalog changes (a sync, the genre / TMDB downloads, a rebuild
 * of the entries): `clear()`. While one of those jobs runs the cache is suspended (nothing read, nothing stored), because the data
 * is changing under it. Lists filled by the user (favourites, continue watching, suggestions) are never put here.
 */
export function createPageCache() {
  const store = new Map();
  let suspended = false;
  return {
    get: (key) => (suspended ? null : store.get(key) || null),
    set(key, value) {
      if (!suspended) store.set(key, value);
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
