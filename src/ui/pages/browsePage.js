import { h, toast } from '../dom.js';
import { t, i18n } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel, ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { openProviderDb } from '../../db/providerDb.js';
import { listCategories, pageEntries } from '../../services/catalogQuery.js';
import { formatNumber } from '../../core/format.js';
import { log } from '../../core/logger.js';

const CATS_ZONE = 'browseCategories';
const GRID_ZONE = 'browseGrid';
export const GRID_COLUMNS = 7;
export const GRID_ROWS = 3;
export const PAGE_SIZE = GRID_COLUMNS * GRID_ROWS;

/** Where focus lands after changing page: same column, first row going forward, last row going back. */
export function indexAfterPageChange(direction, index, count) {
  const column = index % GRID_COLUMNS;
  const target = direction === 'next' ? column : (GRID_ROWS - 1) * GRID_COLUMNS + column;
  return Math.max(0, Math.min(target, count - 1));
}

/**
 * Grid navigation that turns "down from the last row" / "up from the first row" into page changes
 * when another page exists; otherwise behaves as a plain GridModel (and exits the zone).
 */
export function createPagedGridModel({ getCount, hasNext, hasPrevious, changePage }) {
  const grid = new GridModel({ columns: GRID_COLUMNS, getCount });
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

function createCard(entry, type) {
  const poster = h('div', { class: 'card-poster' });
  if (entry.icon) {
    const img = h('img', { src: entry.icon, alt: '', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    poster.appendChild(img);
  }
  const title = entry.year ? `${entry.name} (${entry.year})` : entry.name;
  return h('div', { class: `card ${type}` }, poster, h('div', { class: 'card-title', text: title }));
}

/** Movies / Series / Live: category panel on the left, paged grid of grouped titles on the right. */
export function createBrowsePage(ctx, params = {}) {
  const type = params.type;
  const count = h('p', { class: 'muted browse-count' });
  const catList = h('div', { class: 'browse-cats' });
  const gridEl = h('div', { class: 'browse-grid' });
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
    cardNodes = entries.map((entry) => {
      const node = createCard(entry, type);
      gridEl.appendChild(node);
      return node;
    });
    const name = categories[selected] ? categories[selected].name : '';
    count.textContent = entries.length
      ? t('browse.page', { page: formatNumber(page + 1, i18n.getLocale()), category: name })
      : '';
    empty.style.display = entries.length ? 'none' : '';
  }

  async function loadPage(nextPage, focusIndex) {
    const token = (loadToken += 1);
    const category = categories[selected];
    const result = await pageEntries(db, { type, categoryId: category ? category.id : null, offset: nextPage * PAGE_SIZE, limit: PAGE_SIZE });
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
      getCount: () => entries.length,
      hasNext: () => hasMore,
      hasPrevious: () => page > 0,
      changePage: (direction, index) => {
        const nextPage = direction === 'next' ? page + 1 : page - 1;
        // The new page has a full (or last) row count; compute the landing index from the old column.
        loadPage(nextPage, indexAfterPageChange(direction, index, PAGE_SIZE)).catch((err) => log.warn('Browse page failed', err && err.message));
      },
    }),
    onFocus: (i) => {
      if (!cardNodes[i]) return;
      cardNodes[i].classList.add('focused');
      ensureVisible(cardNodes[i], { first: i < GRID_COLUMNS });
    },
    onBlur: (i) => cardNodes[i] && cardNodes[i].classList.remove('focused'),
    onActivate: () => toast(t('common.comingSoon')),
  });

  async function init() {
    const provider = await ctx.providers.getActive();
    if (!provider || destroyed) return;
    db = await openProviderDb(provider.id);
    if (destroyed) {
      db.close();
      return;
    }
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
      if (db) db.close();
      ctx.focus.unregister(CATS_ZONE);
      ctx.focus.unregister(GRID_ZONE);
    },
  };
}
