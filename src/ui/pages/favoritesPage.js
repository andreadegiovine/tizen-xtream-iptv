import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { createTypedRows } from '../components/typedRows.js';
import { getEntry, listCategories } from '../../services/catalogQuery.js';
import { openFilter, favoriteFilterEntries } from '../../services/favoriteFilters.js';
import { collectionEntry, isCollectionKey } from '../../services/collections.js';
import { log } from '../../core/logger.js';

/** Titles, categories and genres the user marked with the heart, one carousel per type (categories and genres first). */
export function createFavoritesPage(ctx) {
  const status = h('p', { class: 'muted search-status', text: t('player.loading') });
  const rows = createTypedRows(ctx, {
    hideFavorite: true, // everything here is a favourite: the heart would say nothing
    prefix: 'favorites',
    onOpen: (entry) => {
      if (entry.collectionId) ctx.router.push('collection', { id: entry.collectionId, section: 'favorites' });
      else if (entry.filterKind) openFilter(ctx, entry, { push: true });
      else ctx.openEntry(entry, { section: 'favorites' });
    },
  });
  let destroyed = false;

  async function load() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    const saved = await ctx.favorites.list(current.provider.id);
    const guideGenres = async () => (ctx.epg && ctx.epg.genreRows ? new Set((await ctx.epg.genreRows()).genres.map((g) => g.key)) : new Set());
    const entries = await favoriteFilterEntries(saved, (type) => listCategories(current.db, type), guideGenres);
    for (const item of saved) {
      if (item.kind) continue;
      if (isCollectionKey(item.entryKey)) {
        const collection = await ctx.collections.get(item.entryKey.slice('collection:'.length), current.provider.id);
        if (collection) entries.push(await collectionEntry(current.db, collection, getEntry, (count) => t('collections.items', { count })));
        continue;
      }
      const entry = await getEntry(current.db, item.entryKey);
      if (entry) entries.push(entry); // gone from the catalog after a sync: skipped, not deleted
    }
    if (destroyed) return;
    rows.set(entries);
    status.textContent = entries.length ? '' : t('common.empty');
    rows.focusFirst();
  }

  return {
    el: h('section', { class: 'page favorites' }, status, rows.el),
    mount() {
      load().catch((err) => log.warn('Favorites failed', err && err.message));
    },
    destroy() {
      destroyed = true;
      rows.destroy();
    },
  };
}
