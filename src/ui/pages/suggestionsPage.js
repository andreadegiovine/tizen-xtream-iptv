import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { createTypedRows } from '../components/typedRows.js';
import { log } from '../../core/logger.js';

/** Suggested titles available in the provider catalog (TMDB recommendations from the watch history). */
export function createSuggestionsPage(ctx) {
  const status = h('p', { class: 'muted search-status', text: t('suggestions.loading') });
  const rows = createTypedRows(ctx, { prefix: 'suggestions', onOpen: (entry) => ctx.openEntry(entry, { section: 'suggestions' }) });
  let destroyed = false;

  async function load() {
    const result = await ctx.suggestions.build({ limit: 60 });
    if (destroyed) return;
    rows.set(result.entries);
    if (result.source === 'disabled') status.textContent = t('suggestions.disabled');
    else if (!result.entries.length) status.textContent = t('suggestions.none');
    else status.textContent = result.source === 'history' ? t('suggestions.fromHistory') : t('suggestions.trending');
    rows.focusFirst();
  }

  return {
    el: h('section', { class: 'page suggestions' }, status, rows.el),
    mount() {
      load().catch((err) => {
        log.warn('Suggestions failed', err && err.message);
        status.textContent = t('error.NETWORK');
      });
    },
    destroy() {
      destroyed = true;
      rows.destroy();
    },
  };
}
