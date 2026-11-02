import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel, ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createCard } from '../components/card.js';
import { log } from '../../core/logger.js';

const FIELD_ZONE = 'searchField';
const GRID_ZONE = 'searchGrid';
const COLUMNS = 6;
const IME_DONE = 65376;
const IME_CANCEL = 65385;
const DEBOUNCE_MS = 300;

/** Search across movies, series and channels. The in-memory index answers; Enter on a card opens it. */
export function createSearchPage(ctx, params = {}) {
  const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: t('search.placeholder') });
  const field = h('label', { class: 'field search-field' }, h('span', { class: 'field-label', text: t('search.label') }), input);
  const status = h('p', { class: 'muted search-status' });
  const gridEl = h('div', { class: 'search-grid' });
  let results = [];
  let cards = [];
  let timer = null;
  let token = 0;
  let destroyed = false;

  function renderResults(rows, query) {
    results = rows;
    while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
    cards = rows.map((row) => {
      const card = createCard(row, row.type, { subtitle: t(`search.type.${row.type}`) });
      gridEl.appendChild(card.el);
      return card;
    });
    status.textContent = query.trim().length < 2 ? t('search.hint') : rows.length ? '' : t('search.none');
  }

  async function run() {
    const query = input.value;
    const mine = (token += 1);
    try {
      const rows = query.trim().length < 2 ? [] : await ctx.search.search(query, { limit: COLUMNS * 6 });
      if (!destroyed && mine === token) renderResults(rows, query);
    } catch (err) {
      log.warn('Search failed', err && err.message);
    }
  }

  const fieldZone = new FocusZone({
    id: FIELD_ZONE,
    model: new ListModel({ orientation: 'vertical', getCount: () => 1 }),
    onFocus: () => {
      field.classList.add('focused');
      ensureVisible(field, { first: true });
    },
    onBlur: () => field.classList.remove('focused'),
    onActivate: () => input.focus(),
  });

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

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // the text field owns its keys
    if (event.keyCode === 13 || event.keyCode === IME_DONE) {
      event.preventDefault();
      input.blur();
      clearTimeout(timer);
      run().then(() => ctx.focus.focus(results.length ? GRID_ZONE : FIELD_ZONE, 0));
    } else if (event.keyCode === IME_CANCEL) {
      input.blur();
    }
  });

  return {
    el: h('section', { class: 'page search' }, field, status, gridEl),
    mount() {
      ctx.focus.register(fieldZone);
      ctx.focus.register(gridZone);
      ctx.focus.link(FIELD_ZONE, 'up', TOPBAR_ZONE);
      ctx.focus.link(FIELD_ZONE, 'down', GRID_ZONE);
      ctx.focus.link(GRID_ZONE, 'up', FIELD_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', FIELD_ZONE);
      status.textContent = t('search.hint');
      ctx.focus.focus(FIELD_ZONE, 0);
      if (params.query) {
        input.value = params.query;
        run();
      }
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      ctx.focus.unregister(FIELD_ZONE);
      ctx.focus.unregister(GRID_ZONE);
    },
    saveState: () => ({ query: input.value }),
    restoreState(state) {
      if (state && state.query) {
        input.value = state.query;
        run().then(() => results.length && ctx.focus.focus(GRID_ZONE, 0));
      }
    },
  };
}
