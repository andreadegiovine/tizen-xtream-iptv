import { h } from '../dom.js';
import { createCard } from '../components/card.js';
import { t, i18n } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel, ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { listCategories, pageEntries } from '../../services/catalogQuery.js';
import { formatNumber } from '../../core/format.js';
import { log } from '../../core/logger.js';

const CATS_ZONE = 'browseCategories';
const GRID_ZONE = 'browseGrid';
/** Every media type uses the same 6-column grid of equally sized cards (channels included). */
export const columnsFor = () => 6;

/** Where focus lands after changing page: same column, first row going forward, last row going back. */
export function indexAfterPageChange(direction, index, pageSize, columns) {
  const column = index % columns;
  const rows = Math.ceil(pageSize / columns);
  const target = direction === 'next' ? column : (rows - 1) * columns + column;
  return Math.max(0, Math.min(target, pageSize - 1));
}

/**
 * Grid navigation that turns "down from the last row" / "up from the first row" into page changes
 * when another page exists; otherwise behaves as a plain GridModel (and exits the zone).
 */
export function createPagedGridModel({ columns, getCount, hasNext, hasPrevious, changePage }) {
  const grid = new GridModel({ columns, getCount });
  return {
    getCount,
    navigate(dir, index) {
      const result = grid.navigate(dir, index);
      if (result.type === 'exit' && result.dir === 'down' && hasNext()) {
        changePage('next', index);
        return { type: 'move', index };
      }
      if (result.type === 'exit' && result.dir === 'up' && hasPrevious()) {
        changePage('previous', index);
        return { type: 'move', index };
      }
      return result;
    },
  };
}

/** Movies / Series / Live: category panel on the left, paged grid of grouped titles on the right. */
export function createBrowsePage(ctx, params = {}) {
  const type = params.type;
  const columns = columnsFor(type);
  let pageSize = 24;
  const count = h('p', { class: 'muted browse-count' });
  const catList = h('div', { class: 'browse-cats' });
  const gridEl = h('div', { class: `browse-grid ${type}` });
  const empty = h('p', { class: 'muted browse-empty', text: t('browse.empty') });
  let db = null;
  let destroyed = false;
  let categories = []; // [{ id: null, name: 'All' }, ...]
  let catNodes = [];
  let selected = 0; // index into `categories` currently shown in the grid
  let page = 0;
  let hasMore = false;
  let entries = [];
  let cardNodes = [];
  let cards = [];
  let loadToken = 0;

  function renderCategories() {
    while (catList.firstChild) catList.removeChild(catList.firstChild);
    catNodes = categories.map((category, i) => {
      const node = h('div', { class: `browse-cat${i === selected ? ' current' : ''}`, text: category.name });
      catList.appendChild(node);
      return node;
    });
  }

  function renderGrid() {
    while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
    cards = entries.map((entry) => {
      const card = createCard(entry, type);
      gridEl.appendChild(card.el);
      return card;
    });
    cardNodes = cards.map((card) => card.el);
    if (ctx.enrich) ctx.enrich(entries, cards, type);
    const name = categories[selected] ? categories[selected].name : '';
    count.textContent = entries.length
      ? t('browse.page', { page: formatNumber(page + 1, i18n.getLocale()), category: name })
      : '';
    empty.style.display = entries.length ? 'none' : '';
  }

  async function loadPage(nextPage, focusIndex) {
    const token = (loadToken += 1);
    const category = categories[selected];
    const result = await pageEntries(db, { type, categoryId: category ? category.id : null, offset: nextPage * pageSize, limit: pageSize });
    if (destroyed || token !== loadToken) return;
    page = nextPage;
    hasMore = result.hasMore;
    entries = result.entries;
    renderGrid();
    if (typeof focusIndex === 'number') ctx.focus.focus(GRID_ZONE, Math.min(focusIndex, entries.length - 1));
  }

  const catsZone = new FocusZone({
    id: CATS_ZONE,
    model: new ListModel({ orientation: 'vertical', getCount: () => categories.length }),
    onFocus: (i) => {
      if (!catNodes[i]) return;
      catNodes[i].classList.add('focused');
      catNodes[i].scrollIntoView({ block: 'nearest' });
    },
    onBlur: (i) => catNodes[i] && catNodes[i].classList.remove('focused'),
    onActivate: (i) => {
      selected = i;
      catNodes.forEach((node, n) => node.classList.toggle('current', n === i));
      loadPage(0, 0).catch((err) => log.warn('Browse load failed', err && err.message));
    },
  });

  const gridZone = new FocusZone({
    id: GRID_ZONE,
    model: createPagedGridModel({
      columns,
      getCount: () => entries.length,
      hasNext: () => hasMore,
      hasPrevious: () => page > 0,
      changePage: (direction, index) => {
        const nextPage = direction === 'next' ? page + 1 : page - 1;
        // The new page has a full (or last) row count; compute the landing index from the old column.
        loadPage(nextPage, indexAfterPageChange(direction, index, pageSize, columns)).catch((err) => log.warn('Browse page failed', err && err.message));
      },
    }),
    onFocus: (i) => {
      if (!cardNodes[i]) return;
      cardNodes[i].classList.add('focused');
      ensureVisible(cardNodes[i], { first: i < columns });
    },
    onBlur: (i) => cardNodes[i] && cardNodes[i].classList.remove('focused'),
    onActivate: (i) => {
      if (!entries[i]) return;
      const category = categories[selected];
      ctx.openEntry(entries[i], { section: params.section, live: { categoryId: category ? category.id : null, offset: page * pageSize + i } });
    },
  });

  async function init() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    db = current.db; // shared handle: never closed here
    pageSize = (await ctx.settings.get()).gridItems;
    const cats = await listCategories(db, type);
    categories = [{ id: null, name: t('browse.all') }, ...cats.map((c) => ({ id: c.id, name: c.name }))];
    renderCategories();
    await loadPage(0);
    if (destroyed) return;
    // Land in the grid when there is something to browse, otherwise leave the focus on the top bar.
    if (entries.length) ctx.focus.focus(GRID_ZONE, 0);
  }

  return {
    el: h('section', { class: 'page browse' }, h('div', { class: 'browse-body' }, catList, h('div', { class: 'browse-main' }, count, gridEl, empty))),
    mount() {
      ctx.focus.register(catsZone);
      ctx.focus.register(gridZone);
      ctx.focus.link(CATS_ZONE, 'up', TOPBAR_ZONE);
      ctx.focus.link(CATS_ZONE, 'right', GRID_ZONE);
      ctx.focus.link(GRID_ZONE, 'left', CATS_ZONE);
      ctx.focus.link(GRID_ZONE, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', GRID_ZONE);
      init().catch((err) => log.warn('Browse init failed', err && err.message));
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(CATS_ZONE);
      ctx.focus.unregister(GRID_ZONE);
    },
  };
}
