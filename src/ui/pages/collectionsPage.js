import { h } from '../dom.js';
import { t, i18n } from '../../i18n/index.js';
import { icon } from '../icons.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel, ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { createCard } from '../components/card.js';
import { ensureVisible } from '../scroll.js';
import { SIDEBAR_ICON, columnsFor } from './browsePage.js';
import { getEntry, entryGenres } from '../../services/catalogQuery.js';
import { collectionGenres, collectionKey, unionGenres } from '../../services/collections.js';
import { formatNumber } from '../../core/format.js';
import { log } from '../../core/logger.js';

const CATS_ZONE = 'collectionsCategories';
const GRID_ZONE = 'collectionsGrid';
const HEAD_ZONE = 'collectionsHead';

/** Sidebar entries: show all, favourites, the pinned genres, then the "Genres" entry (open) with the genres of the collections. */
export function collectionSidebarItems({ genres = [], pinned = [], genresExpanded = true, labels }) {
  const items = [{ kind: 'all', name: labels.all }, { kind: 'favorites', name: labels.favorites }];
  pinned.forEach((p) => items.push({ kind: 'genre', id: String(p.id), name: p.name, pinned: true }));
  if (genres.length) {
    items.push({ kind: 'genresToggle', name: labels.genres, expanded: genresExpanded });
    if (genresExpanded) genres.forEach((g) => items.push({ kind: 'genre', id: String(g.key), name: g.name, depth: 1 }));
  }
  return items;
}

/** Collections that belong to a sidebar view. `genresById`: Map(collection id → [{ key }]); `favoriteIds`: Set of collection ids. */
export function collectionsOfView(collections, item, { genresById, favoriteIds }) {
  if (!item || item.kind === 'all') return collections;
  if (item.kind === 'favorites') return collections.filter((c) => favoriteIds.has(c.id));
  if (item.kind === 'genre') return collections.filter((c) => (genresById.get(c.id) || []).some((g) => g.key === String(item.id)));
  return collections;
}

/** Card entry of a collection: the poster is the first member that has one (filled in later). */
export const collectionCardEntry = (collection) => ({ key: collectionKey(collection.id), type: 'collection', name: collection.name, icon: '' });

/** The picture of a collection: the first member with a poster or logo. */
export async function collectionPoster(db, collection) {
  for (const key of collection.entryKeys.slice(0, 6)) {
    const entry = await getEntry(db, key).catch(() => null);
    if (entry && entry.icon) return entry.icon;
  }
  return '';
}

/** "Collections" page: sidebar (all, favourites, pinned genres, genres) and a grid of collection cards. */
export function createCollectionsPage(ctx, params = {}) {
  const columns = columnsFor();
  const titleEl = h('span', { class: 'browse-title' });
  const count = h('span', { class: 'muted browse-count' });
  const sepA = h('span', { class: 'browse-sep', text: '·' });
  const pinBtn = h('span', { class: 'icon-btn browse-fav browse-pin' }, icon('pin'));
  const head = h('div', { class: 'browse-head sticky-head' }, titleEl, sepA, count, h('span', { class: 'browse-head-actions' }, pinBtn));
  const catList = h('div', { class: 'browse-cats' });
  const gridEl = h('div', { class: 'browse-grid movie' });
  const empty = h('p', { class: 'muted browse-empty', text: t('collections.empty') });
  let db = null;
  let providerId = null;
  let destroyed = false;
  let collections = [];
  let genresById = new Map();
  let favoriteIds = new Set();
  let genres = [];
  let pinned = [];
  let genresExpanded = true;
  let items = [];
  let catNodes = [];
  let selected = 0;
  let shown = [];
  let cardNodes = [];
  let pinState = null; // { active, run } while a genre is open

  const labels = () => ({ all: t('browse.all'), favorites: t('nav.favorites'), genres: t('detail.genres') });
  const numberText = (n) => formatNumber(n, i18n.getLocale());
  const countOf = (item) => {
    if (item.kind === 'genresToggle') return genres.length;
    return collectionsOfView(collections, item, { genresById, favoriteIds }).length;
  };

  function renderCategories() {
    while (catList.firstChild) catList.removeChild(catList.firstChild);
    catNodes = items.map((item, i) => {
      const node = h('div', { class: `browse-cat${i === selected ? ' current' : ''}${item.depth ? ' sub' : ''}` });
      const iconName = item.pinned ? 'pin' : SIDEBAR_ICON[item.kind];
      if (iconName) node.appendChild(h('span', { class: 'browse-cat-icon' }, icon(iconName)));
      node.appendChild(h('span', { class: 'browse-cat-name', text: item.name }));
      node.appendChild(h('span', { class: 'browse-cat-count', text: numberText(countOf(item)) }));
      if (item.kind === 'genresToggle') node.appendChild(icon('chevron', item.expanded ? 'open' : ''));
      catList.appendChild(node);
      return node;
    });
  }

  function rebuildSidebar(focusKind) {
    const keep = items[selected];
    items = collectionSidebarItems({ genres, pinned, genresExpanded, labels: labels() });
    const same = keep ? items.findIndex((item) => item.kind === keep.kind && String(item.id) === String(keep.id)) : -1;
    selected = same >= 0 ? same : 0;
    renderCategories();
    syncPin();
    if (focusKind !== undefined && ctx.focus.activeId === CATS_ZONE) {
      const at = items.findIndex((item) => item.kind === focusKind);
      if (at >= 0) ctx.focus.focus(CATS_ZONE, at);
    }
  }

  function renderHead() {
    sepA.style.display = count.textContent ? '' : 'none';
    pinBtn.style.display = pinState ? '' : 'none';
    pinBtn.classList.toggle('active', Boolean(pinState && pinState.active));
    pinBtn.setAttribute('aria-label', pinState && pinState.active ? t('browse.unpin') : t('browse.pin'));
    if (!pinState) pinBtn.classList.remove('focused');
  }

  /** The pin in the head follows the open genre. */
  async function syncPin() {
    const item = items[selected];
    if (!item || item.kind !== 'genre') {
      pinState = null;
      renderHead();
      return;
    }
    const active = await ctx.pins.has(providerId, 'genre', 'collection', item.id).catch(() => false);
    if (destroyed || items[selected] !== item) return;
    pinState = {
      active,
      run: async () => {
        const now = await ctx.pins.toggle(providerId, { kind: 'genre', type: 'collection', id: item.id, name: item.name });
        pinned = await ctx.pins.list(providerId, 'collection');
        if (!destroyed) rebuildSidebar();
        ctx.notices.success(t(now ? 'notice.added' : 'notice.removed'), { key: 'pin' });
      },
    };
    renderHead();
  }

  function renderGrid() {
    while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
    const cards = shown.map((collection) => {
      const card = createCard(collectionCardEntry(collection), 'movie', { placeholder: 'folder', subtitle: t('collections.items', { count: collection.entryKeys.length }) });
      gridEl.appendChild(card.el);
      collectionPoster(db, collection).then((url) => url && !destroyed && card.update({ poster: url })).catch(() => undefined);
      return card;
    });
    cardNodes = cards.map((card) => card.el);
    titleEl.textContent = items[selected] ? items[selected].name : '';
    count.textContent = shown.length ? numberText(shown.length) : '';
    renderHead();
    empty.style.display = shown.length ? 'none' : '';
  }

  function showView() {
    shown = collectionsOfView(collections, items[selected], { genresById, favoriteIds });
    renderGrid();
  }

  const headButtons = () => (pinState ? [{ el: pinBtn, run: pinState.run }] : []);
  const headZone = new FocusZone({
    id: HEAD_ZONE,
    model: new ListModel({ orientation: 'horizontal', getCount: () => headButtons().length }),
    onFocus: (i) => headButtons()[i] && headButtons()[i].el.classList.add('focused'),
    onBlur: (i) => headButtons()[i] && headButtons()[i].el.classList.remove('focused'),
    onActivate: (i) => headButtons()[i] && headButtons()[i].run(),
  });

  const catsZone = new FocusZone({
    id: CATS_ZONE,
    model: new ListModel({ orientation: 'vertical', getCount: () => items.length }),
    onFocus: (i) => {
      if (!catNodes[i]) return;
      catNodes[i].classList.add('focused');
      catNodes[i].scrollIntoView({ block: 'nearest' });
    },
    onBlur: (i) => catNodes[i] && catNodes[i].classList.remove('focused'),
    onActivate: (i) => {
      const item = items[i];
      if (item.kind === 'genresToggle') {
        genresExpanded = !genresExpanded;
        selected = Math.min(selected, items.length - 1);
        rebuildSidebar(item.kind);
        return;
      }
      selected = i;
      catNodes.forEach((node, n) => node.classList.toggle('current', n === i));
      syncPin();
      showView();
    },
  });

  const gridZone = new FocusZone({
    id: GRID_ZONE,
    model: new GridModel({ columns, getCount: () => shown.length }),
    onFocus: (i) => {
      if (!cardNodes[i]) return;
      cardNodes[i].classList.add('focused');
      ensureVisible(cardNodes[i], { first: i < columns });
    },
    onBlur: (i) => cardNodes[i] && cardNodes[i].classList.remove('focused'),
    onActivate: (i) => shown[i] && ctx.router.push('collection', { id: shown[i].id, section: 'collections' }),
  });

  let restored = null; // state saved when the page was left (set right after mount)

  async function init() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    db = current.db;
    providerId = current.provider.id;
    collections = await ctx.collections.list(providerId);
    const fav = await ctx.favorites.list(providerId);
    favoriteIds = new Set(fav.filter((f) => f.type === 'collection').map((f) => String(f.entryKey).slice('collection:'.length)));
    genresById = new Map(await Promise.all(collections.map(async (c) => [c.id, await collectionGenres(db, c.entryKeys, entryGenres)])));
    genres = unionGenres(Array.from(genresById.values()));
    const known = new Set(genres.map((g) => g.key));
    pinned = (await ctx.pins.list(providerId, 'collection').catch(() => [])).filter((p) => known.has(String(p.id)));
    if (destroyed) return;
    // Coming back from a collection: the same sidebar entry and focus as when the page was left.
    const back = restored;
    if (back) genresExpanded = back.genresExpanded;
    items = collectionSidebarItems({ genres, pinned, genresExpanded, labels: labels() });
    const wanted = back && back.item ? items.findIndex((item) => item.kind === back.item.kind && String(item.id) === String(back.item.id)) : params.filter ? items.findIndex((item) => item.kind === 'genre' && item.id === String(params.filter.id)) : 0;
    selected = Math.max(0, wanted);
    renderCategories();
    syncPin();
    showView();
    if (back && back.zone === CATS_ZONE) ctx.focus.focus(CATS_ZONE, selected);
    else if (shown.length) ctx.focus.focus(GRID_ZONE, back && back.zone === GRID_ZONE ? Math.min(back.index, shown.length - 1) : 0);
  }

  return {
    el: h('section', { class: 'page browse' }, h('div', { class: 'browse-body' }, catList, h('div', { class: 'browse-main' }, head, gridEl, empty))),
    mount() {
      ctx.focus.register(catsZone);
      ctx.focus.register(gridZone);
      ctx.focus.register(headZone);
      ctx.focus.link(HEAD_ZONE, 'up', TOPBAR_ZONE);
      ctx.focus.link(HEAD_ZONE, 'down', GRID_ZONE);
      ctx.focus.link(HEAD_ZONE, 'left', CATS_ZONE);
      ctx.focus.link(CATS_ZONE, 'up', TOPBAR_ZONE);
      ctx.focus.link(CATS_ZONE, 'right', GRID_ZONE);
      ctx.focus.link(GRID_ZONE, 'left', CATS_ZONE);
      ctx.focus.link(GRID_ZONE, 'up', HEAD_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', HEAD_ZONE);
      init().catch((err) => log.warn('Collections init failed', err && err.message));
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(HEAD_ZONE);
      ctx.focus.unregister(CATS_ZONE);
      ctx.focus.unregister(GRID_ZONE);
    },
    saveState() {
      const item = items[selected];
      const zone = ctx.focus.activeId;
      return { item: item ? { kind: item.kind, id: item.id } : null, genresExpanded, zone, index: ctx.focus.active && ctx.focus.activeId === zone ? ctx.focus.active.index : 0 };
    },
    restoreState(state) {
      restored = state;
    },
  };
}
