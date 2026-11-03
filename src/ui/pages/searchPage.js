import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createCard } from '../components/card.js';
import { log } from '../../core/logger.js';

const GRID_ZONE = 'searchGrid';
const COLUMNS = 7; // full-width page: 7 cards of 224 px fit between the gutters

/**
 * Search results across movies, series and channels. The text field lives in the top bar:
 * it calls setQuery() while typing and focusResults() on Enter / Down.
 */
export function createSearchPage(ctx, params = {}) {
  const status = h('p', { class: 'muted search-status' });
  const gridEl = h('div', { class: 'search-grid' });
  let query = '';
  let results = [];
  let cards = [];
  let token = 0;
  let destroyed = false;

  function renderResults(rows) {
    results = rows;
    while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
    cards = rows.map((row) => {
      const card = createCard(row, row.type, { tag: t(`search.type.${row.type}`) });
      gridEl.appendChild(card.el);
      return card;
    });
    status.textContent = query.length < 2 ? t('search.hint') : rows.length ? '' : t('search.none');
    ['movie', 'series', 'live'].forEach((type, n) => {
      const idx = rows.map((row, i) => (row.type === type ? i : -1)).filter((i) => i >= 0);
      if (idx.length && ctx.enrich) ctx.enrich(idx.map((i) => rows[i]), idx.map((i) => cards[i]), type, n > 0);
    });
  }

  async function run() {
    const mine = (token += 1);
    try {
      const rows = query.length < 2 ? [] : await ctx.search.search(query, { limit: COLUMNS * 6 });
      if (!destroyed && mine === token) renderResults(rows);
    } catch (err) {
      log.warn('Search failed', err && err.message);
    }
  }

  const gridZone = new FocusZone({
    id: GRID_ZONE,
    model: new GridModel({ columns: COLUMNS, getCount: () => results.length }),
    onFocus: (i) => {
      if (!cards[i]) return;
      cards[i].el.classList.add('focused');
      ensureVisible(cards[i].el, { first: i < COLUMNS });
    },
    onBlur: (i) => cards[i] && cards[i].el.classList.remove('focused'),
    onActivate: (i) => results[i] && ctx.openEntry(results[i], { section: 'search' }),
  });

  return {
    el: h('section', { class: 'page search' }, status, gridEl),
    mount() {
      ctx.focus.register(gridZone);
      ctx.focus.link(GRID_ZONE, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', GRID_ZONE);
      status.textContent = t('search.hint');
      query = String(params.query || '').trim();
      if (query) run();
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(GRID_ZONE);
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
    focusResults() {
      return ctx.focus.focus(GRID_ZONE, 0);
    },
    saveState: () => ({ query }),
    restoreState(state) {
      if (state && state.query) {
        query = state.query;
        run().then(() => results.length && ctx.focus.focus(GRID_ZONE, 0));
      }
    },
  };
}
