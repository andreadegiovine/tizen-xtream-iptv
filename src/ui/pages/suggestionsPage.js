import { h } from '../dom.js';
import { focusOnBar } from '../rowFocus.js';
import { createHint } from '../atoms/hint.js';
import { t } from '../../i18n/index.js';
import { createTypedRows } from '../components/typedRows.js';
import { log } from '../../core/logger.js';

/** Suggested titles available in the provider catalog (TMDB recommendations from the watch history). */
export function createSuggestionsPage(ctx) {
  const status = createHint({ text: t('suggestions.loading'), className: 'search-status' });
  const rows = createTypedRows(ctx, { prefix: 'suggestions', onOpen: (entry) => ctx.openEntry(entry, { section: 'suggestions' }) });
  let destroyed = false;
  let restored = null; // the card to land on again (a title opened from here, then Back)
  let onBar = false;

  async function load() {
    const result = await ctx.suggestions.build({ limit: 500 });
    if (destroyed) return;
    rows.set(result.entries);
    if (!result.entries.length) status.textContent = t('common.empty');
    else status.textContent = result.source === 'history' ? t('suggestions.fromHistory') : t('suggestions.trending');
    if (onBar) onBar = false;
    else if (restored) rows.focusSaved(restored);
    else rows.focusFirst();
    restored = null;
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
    saveState: () => ({ focus: rows.savedFocus(), onBar: focusOnBar(ctx.focus) }),
    restoreState(state) {
      restored = (state && state.focus) || null;
      onBar = Boolean(state && state.onBar); // left from the bar (the search): it keeps the focus
    },
  };
}
