import { t } from '../i18n/index.js';
import { favoriteFilterEntries } from './favoriteFilters.js';
import { listCategories, getEntry } from './catalogQuery.js';
import { collectionEntry, isCollectionKey } from './collections.js';

/**
 * The favourites the active provider can show, as card entries: favourite filters (categories, genres, guide genres of the current guide),
 * collections, then titles still in the catalog. What it cannot show (another provider's titles, a title gone after a sync) is skipped,
 * not deleted. The Favorites page lists them; the top bar shows Favorites only when there is at least one.
 */
export async function visibleFavorites(ctx, current) {
  const saved = await ctx.favorites.list(current.provider.id);
  const guideGenres = async () => (ctx.epg && ctx.epg.genreRows ? new Set((await ctx.epg.genreRows({ shown: true })).genres.map((g) => g.key)) : new Set());
  const entries = await favoriteFilterEntries(saved, (type) => listCategories(current.db, type), guideGenres);
  for (const item of saved) {
    if (item.kind) continue;
    if (isCollectionKey(item.entryKey)) {
      const collection = await ctx.collections.get(item.entryKey.slice('collection:'.length), current.provider.id);
      if (collection) entries.push(await collectionEntry(current.db, collection, getEntry, (count) => t('collections.items', { count })));
      continue;
    }
    const entry = await getEntry(current.db, item.entryKey);
    if (entry) entries.push(entry);
  }
  return entries;
}
