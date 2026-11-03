import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { createTypedRows } from '../components/typedRows.js';
import { log } from '../../core/logger.js';

const PER_TYPE = 20;

/**
 * Search results as one carousel per type. The text field lives in the top bar:
 * it calls setQuery() while typing and focusResults() on Enter / Down.
 */
export function createSearchPage(ctx, params = {}) {
  const status = h('p', { class: 'muted search-status' });
  const rows = createTypedRows(ctx, { prefix: 'search', limit: PER_TYPE, onOpen: (entry) => ctx.openEntry(entry, { section: 'search' }) });
  let query = '';
  let token = 0;
  let destroyed = false;

  async function run() {
    const mine = (token += 1);
    try {
      const found = query.length < 2 ? [] : await ctx.search.search(query, { limit: PER_TYPE * 6 });
      if (destroyed || mine !== token) return;
      rows.set(found);
      status.textContent = query.length < 2 ? t('search.hint') : found.length ? '' : t('search.none');
    } catch (err) {
      log.warn('Search failed', err && err.message);
    }
  }

  return {
    el: h('section', { class: 'page search' }, status, rows.el),
    mount() {
      status.textContent = t('search.hint');
      query = String(params.query || '').trim();
      if (query) run();
    },
    destroy() {
      destroyed = true;
      rows.destroy();
    },
    /** Called by the top bar while typing. */
    setQuery(text) {
      const next = String(text || '').trim();
      if (next === query) return Promise.resolve(); // same text (e.g. Enter after typing): keep the cards and the focus
      query = next;
      return run();
    },
    getQuery: () => query,
    /** Moves the focus from the search field to the first result. */
    focusResults: () => rows.focusFirst(),
    saveState: () => ({ query }),
    restoreState(state) {
      if (state && state.query) {
        query = state.query;
        run().then(() => rows.focusFirst());
      }
    },
  };
}
