import { h } from '../dom.js';
import { createHint } from '../atoms/hint.js';
import { visibleFavorites } from '../../services/favoriteEntries.js';
import { t } from '../../i18n/index.js';
import { createTypedRows } from '../components/typedRows.js';
import { openFilter } from '../../services/favoriteFilters.js';
import { log } from '../../core/logger.js';

/** Titles, categories and genres the user marked with the heart, one carousel per type (categories and genres first). */
export function createFavoritesPage(ctx) {
  const status = createHint({ text: t('player.loading'), className: 'search-status' });
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
  let restored = null; // the card to land on again (a title opened from here, then Back)

  async function load() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    const entries = await visibleFavorites(ctx, current);
    if (destroyed) return;
    rows.set(entries);
    status.textContent = entries.length ? '' : t('common.empty');
    if (restored) rows.focusSaved(restored);
    else rows.focusFirst();
    restored = null;
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
    saveState: () => ({ focus: rows.savedFocus() }),
    restoreState(state) {
      restored = (state && state.focus) || null;
    },
  };
}
