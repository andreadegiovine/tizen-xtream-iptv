import { requestToPromise } from '../core/idb.js';

const SAMPLE = 40;

/** Approximate size in bytes of some stores: rows × the average serialized size of a sample of them (exact counts are cheap, sizes are not). */
export async function estimateStoresBytes(db, stores) {
  let total = 0;
  for (const name of stores) {
    if (!db.objectStoreNames.contains(name)) continue;
    const store = db.transaction(name, 'readonly').objectStore(name);
    const count = await requestToPromise(store.count());
    if (!count) continue;
    const sample = await requestToPromise(db.transaction(name, 'readonly').objectStore(name).getAll(null, SAMPLE));
    const bytes = sample.reduce((sum, row) => {
      try {
        return sum + JSON.stringify(row).length;
      } catch {
        return sum;
      }
    }, 0);
    total += Math.round((bytes / Math.max(1, sample.length)) * count);
  }
  return total;
}

/** Stores holding what was downloaded from the provider, and the ones worked out from it. */
export const CATALOG_STORES = ['items', 'categories', 'details'];
export const DERIVED_STORES = ['entries', 'entry_cat', 'groups', 'entry_genre', 'entry_genre_tmdb'];
