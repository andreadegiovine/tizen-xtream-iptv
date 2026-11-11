import { openProviderDb } from '../db/providerDb.js';
import { rebuildEntries } from './catalogSync.js';

/**
 * Works out the entries (and the Live groups / networks) of some media types again from the stored lists, with no download.
 * Shared by the catalog worker and the main-thread fallback: `excluded` is { type: [category ids] }.
 */
export async function runRebuild({ providerId, types, excluded = {}, cleanTitles = true, grouping, db: given = null }) {
  const db = given || (await openProviderDb(providerId));
  const counts = {};
  try {
    for (const type of types) {
      counts[type] = await rebuildEntries({ db, type, excludedCategories: new Set(excluded[type] || []), cleanTitles, grouping: type === 'live' ? grouping : undefined });
    }
  } finally {
    if (!given) db.close();
  }
  return counts;
}

export { startRebuild } from './startRebuild.js';
