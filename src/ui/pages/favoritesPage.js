import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { createTypedRows } from '../components/typedRows.js';
import { getEntry } from '../../services/catalogQuery.js';
import { log } from '../../core/logger.js';

/** Titles the user marked with the heart, one carousel per type. */
export function createFavoritesPage(ctx) {
  const status = h('p', { class: 'muted search-status', text: t('favorites.loading') });
  const rows = createTypedRows(ctx, { prefix: 'favorites', onOpen: (entry) => ctx.openEntry(entry, { section: 'favorites' }) });
  let destroyed = false;

  async function load() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    const saved = await ctx.favorites.list(current.provider.id);
    const entries = [];
    for (const item of saved) {
      const entry = await getEntry(current.db, item.entryKey);
      if (entry) entries.push(entry); // gone from the catalog after a sync: skipped, not deleted
    }
    if (destroyed) return;
    rows.set(entries);
    status.textContent = entries.length ? '' : t('favorites.none');
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
