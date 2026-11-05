import { continueWatching } from '../../services/continueWatching.js';
import { h } from '../dom.js';
import { createCard, createSkeletonCard } from '../components/card.js';
import { derivedVersion, readDerived, writeDerived } from '../../services/derivedStore.js';
import { t, i18n } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel, ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { isFilterEntry, filterCardMeta } from '../components/typedRows.js';
import { favoriteFilterEntries, openFilter } from '../../services/favoriteFilters.js';
import { ensureVisible } from '../scroll.js';
import { listCategories, listNetworks, pageEntries, getEntry, countEntries, LIVE_ALL } from '../../services/catalogQuery.js';
import { icon } from '../icons.js';
import { formatNumber } from '../../core/format.js';
import { log } from '../../core/logger.js';

const CATS_ZONE = 'browseCategories';
/** Icon before the label of the fixed sidebar entries (genres and categories get an empty slot to stay aligned). */
export const SIDEBAR_ICON = { all: 'all', continue: 'continue', favorites: 'heart', suggestions: 'suggestions', genresToggle: 'genres', toggle: 'categories', networksToggle: 'network' };
/** Placeholder rows shown while the genres load: enough that the "Categories" entry stays below the screen. */
export const GENRE_SKELETONS = 12;
const GRID_ZONE = 'browseGrid';
const HEAD_ZONE = 'browseHead';
/** Views that are loaded as one in-memory list and paged locally. */
const LIST_KINDS = ['continue', 'favorites', 'suggestions', 'genre', 'network'];
/** Views read from the catalog only (so their first page can be cached); continue, favourites and suggestions come from the user. */
const CACHED_KINDS = ['all', 'category', 'genre', 'network'];
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

/**
 * Sidebar entries. Movies and series: show all, continue watching, favourites, suggestions, a "Genres"
 * entry (open by default) with the genres, then a "Categories" entry that expands into the provider categories. Channels: show all, favourites, pinned categories, the "Networks" entry (open) and the categories (closed).
 */
export function sidebarItems({ type, genres = [], categories = [], pinned = [], networks = [], networksExpanded = true, expanded = false, genresExpanded = true, genresLoading = false, labels }) {
  const items = [{ kind: 'all', name: labels.all }];
  if (type === 'live') {
    items.push({ kind: 'favorites', name: labels.favorites });
    pinned.forEach((p) => items.push({ kind: p.kind, id: String(p.id), name: p.name, pinned: true }));
    if (networks.length) {
      items.push({ kind: 'networksToggle', name: labels.networks, expanded: networksExpanded });
      if (networksExpanded) networks.forEach((n) => items.push({ kind: 'network', id: n.key, name: n.name, depth: 1 }));
    }
    if (categories.length) {
      items.push({ kind: 'toggle', name: labels.categories, expanded });
      if (expanded) categories.forEach((c) => items.push({ kind: 'category', id: c.id, name: c.name, depth: 1 }));
    }
    return items;
  }
  items.push({ kind: 'continue', name: labels.continue }, { kind: 'favorites', name: labels.favorites }, { kind: 'suggestions', name: labels.suggestions });
  // Pinned categories and genres sit between the suggestions and the genres.
  pinned.forEach((p) => items.push({ kind: p.kind, id: String(p.id), name: p.name, pinned: true }));
  if (genres.length || genresLoading) {
    items.push({ kind: 'genresToggle', name: labels.genres, expanded: genresExpanded });
    if (genresExpanded) genres.forEach((g) => items.push({ kind: 'genre', id: String(g.key), name: g.name, depth: 1 }));
  }
  if (categories.length) {
    items.push({ kind: 'toggle', name: labels.categories, expanded });
    if (expanded) categories.forEach((c) => items.push({ kind: 'category', id: c.id, name: c.name, depth: 1 }));
  }
  return items;
}

/** Index of the entry matching a filter ({ kind, id }); 0 ("show all") when it is not there. */
export function indexOfFilter(items, filter) {
  if (!filter) return 0;
  const index = items.findIndex((item) => item.kind === filter.kind && String(item.id) === String(filter.id));
  return Math.max(0, index);
}

/** Movies / Series / Live: sidebar on the left, paged grid of grouped titles on the right. */
export function createBrowsePage(ctx, params = {}) {
  const type = params.type;
  const columns = columnsFor(type);
  let pageSize = 24;
  const titleEl = h('span', { class: 'browse-title' });
  const count = h('span', { class: 'muted browse-count' });
  const sepA = h('span', { class: 'browse-sep', text: '·' });
  const pinBtn = h('span', { class: 'icon-btn browse-fav browse-pin' }, icon('pin'));
  const favBtn = h('span', { class: 'icon-btn browse-fav' }, icon('heart'));
  const head = h('div', { class: 'browse-head sticky-head' }, titleEl, sepA, count, h('span', { class: 'browse-head-actions' }, pinBtn, favBtn));
  let favState = null; // { active, onToggle, pinActive, onPin } while a category / genre is open
  function renderHead() {
    const hasCount = !!count.textContent;
    sepA.style.display = hasCount ? '' : 'none';
    favBtn.style.display = favState ? '' : 'none';
    favBtn.classList.toggle('active', !!(favState && favState.active));
    favBtn.setAttribute('aria-label', favState && favState.active ? t('detail.unfavorite') : t('detail.favorite'));
    const canPin = Boolean(favState && favState.onPin);
    pinBtn.style.display = canPin ? '' : 'none';
    pinBtn.classList.toggle('active', canPin && favState.pinActive);
    pinBtn.setAttribute('aria-label', canPin && favState.pinActive ? t('browse.unpin') : t('browse.pin'));
    if (!favState) favBtn.classList.remove('focused');
    if (!canPin) pinBtn.classList.remove('focused');
  }
  renderHead();
  let pages = 1;
  const catList = h('div', { class: 'browse-cats' });
  const gridEl = h('div', { class: `browse-grid ${type}` });
  const empty = h('p', { class: 'muted browse-empty', text: t('common.empty') });
  let db = null;
  let providerId = null;
  let destroyed = false;
    let genres = [];
  let pinned = []; // pinned categories / genres of this media type
  let categories = []; // visible provider categories [{ id, name }]
  let expanded = false; // categories group
  let networks = []; // Live TV networks [{ key, name, memberKeys }]
  let networksExpanded = true; // networks group: open by default
  let genresExpanded = true; // genres group: open by default
  let genresLoading = type !== 'live';
  let countsLoading = true;
  let items = []; // sidebar entries
  let catNodes = [];
  let selected = 0; // index into `items` currently shown in the grid
  let list = null; // fully loaded entries for continue / favourites / genre views (paged in memory)
  let page = 0;
  let hasMore = false;
  let entries = [];
  let cardNodes = [];
  let cards = [];
  let loadToken = 0;
  const counts = new Map(); // sidebar numbers: 'kind:id' → how many titles

  const labels = () => ({ all: t('browse.all'), continue: t('home.continue'), favorites: t('nav.favorites'), suggestions: t('nav.suggestions'), genres: t('detail.genres'), categories: t('detail.categories'), networks: t('networks.title') });

  function renderCategories() {
    while (catList.firstChild) catList.removeChild(catList.firstChild);
    catNodes = items.map((item, i) => {
      const node = h('div', { class: `browse-cat${i === selected ? ' current' : ''}${item.depth ? ' sub' : ''}` });
      // Only entries with an icon get the icon slot: the others start at the left edge.
      const iconName = item.pinned ? 'pin' : SIDEBAR_ICON[item.kind];
      if (iconName) node.appendChild(h('span', { class: 'browse-cat-icon' }, icon(iconName)));
      node.appendChild(h('span', { class: 'browse-cat-name', text: item.name }));
      const text = countText(item);
      node.appendChild(h('span', { class: `browse-cat-count${text === '' && countsLoading ? ' skeleton-line' : ''}`, text }));
      if (item.kind === 'toggle' || item.kind === 'genresToggle' || item.kind === 'networksToggle') node.appendChild(icon('chevron', item.expanded ? 'open' : ''));
      catList.appendChild(node);
      // While the genres are being found, grey placeholders hold their place under the "Genres" entry.
      if (item.kind === 'genresToggle' && genresLoading && genresExpanded) {
        for (let n = 0; n < GENRE_SKELETONS; n += 1) {
          catList.appendChild(h('div', { class: 'browse-cat sub skeleton-cat' }, h('span', { class: 'browse-cat-name skeleton-line' }), h('span', { class: 'browse-cat-count skeleton-line' })));
        }
      }
      return node;
    });
  }

  const countKey = (item) => `${item.kind}:${item.id === undefined ? '' : item.id}`;
  const countText = (item) => {
    const n = item.kind === 'toggle' ? categories.length : item.kind === 'networksToggle' ? networks.length : item.kind === 'genresToggle' ? (genresLoading ? undefined : genres.length) : counts.get(countKey(item));
    return n === undefined ? '' : formatNumber(n, i18n.getLocale());
  };
  function showCounts() {
    items.forEach((item, i) => {
      const slot = catNodes[i] && catNodes[i].querySelector('.browse-cat-count');
      if (!slot) return;
      const text = countText(item);
      slot.textContent = text;
      slot.classList.toggle('skeleton-line', text === '' && countsLoading);
    });
  }

  const setCount = (key, n) => {
    counts.set(key, n);
    if (!destroyed) showCounts();
  };
  const safe = (job) => job().catch(() => undefined);

  /** The numbers that depend on the user (continue watching, favourites, suggestions): read every time, never cached. */
  async function loadUserCounts() {
    if (type !== 'live') await safe(async () => setCount('continue:', (await continueWatching(ctx, { providerId, limit: 200 })).filter((r) => r.type === type).length));
    await safe(async () => setCount('favorites:', (await ctx.favorites.list(providerId)).filter((f) => f.type === type).length));
    if (type !== 'live') await safe(async () => setCount('suggestions:', (await suggestionEntries()).length));
  }

  /** The numbers of the catalog (all, networks, genres, categories): one source at a time, none of them blocks the page. Resolves true when all were read. */
  async function loadCatalogCounts() {
    await safe(async () => setCount('all:', await countEntries(db, { type, categoryId: allCategory() })));
    if (type === 'live') networks.forEach((n) => setCount(`network:${n.key}`, n.memberKeys.length));
    else {
      const genreTotals = await safe(() => ctx.genres.counts(type));
      if (genreTotals) genreTotals.forEach((n, key) => setCount(`genre:${key}`, n));
    }
    if (type === 'live') {
      await Promise.all(categories.map((c) => safe(async () => setCount(`category:${c.id}`, await countEntries(db, { type, categoryId: c.id })))));
      return !destroyed;
    }
    for (const c of categories) {
      if (destroyed) return false;
      await safe(async () => setCount(`category:${c.id}`, await countEntries(db, { type, categoryId: c.id })));
    }
    return !destroyed;
  }

  /** Remembers the sidebar (and its numbers) until the app closes or the catalog changes. */
  function storeSidebar() {
    if (!ctx.pageCache || !providerId) return;
    const catalogCounts = Array.from(counts.entries()).filter(([key]) => !/^(continue|favorites|suggestions):/.test(key));
    const stored = { categories, networks, genres, counts: catalogCounts };
    ctx.pageCache.set(sidebarKey(), stored);
    // Also in the database: valid until the catalog or the genres change, so the next start shows it without working it out.
    if (sidebarVersion) writeDerived(db, sidebarKey(), stored, sidebarVersion).catch(() => undefined);
  }
  let sidebarVersion = null; // read before the sidebar is worked out: a sync meanwhile leaves the saved copy invalid

  const sidebarKey = () => `sidebar:${providerId}:${type}`;

  let suggestionsCache = null;
  async function suggestionEntries(fresh = false) {
    if (!suggestionsCache || fresh) suggestionsCache = ctx.suggestions.build({ limit: 120 }).then((result) => result.entries.filter((entry) => entry.type === type));
    return suggestionsCache;
  }

  /** Rebuilds the sidebar keeping the same entry selected (genres arrive late, categories expand). */
  function rebuildSidebar(focusKey) {
    const keep = items[selected];
    items = sidebarItems({ type, genres, categories, pinned, networks, networksExpanded, expanded, genresExpanded, genresLoading, labels: labels() });
    const same = keep ? items.findIndex((item) => item.kind === keep.kind && String(item.id) === String(keep.id)) : -1;
    selected = same >= 0 ? same : 0;
    renderCategories();
    syncFavorite();
    if (focusKey !== undefined && ctx.focus.activeId === CATS_ZONE) {
      const at = items.findIndex((item) => item.kind === focusKey);
      if (at >= 0) ctx.focus.focus(CATS_ZONE, at);
    }
  }

  function renderGrid() {
    while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
    cards = entries.map((entry) => {
      const card = createCard(entry, type, { ...(isFilterEntry(entry) ? filterCardMeta(entry) : {}), square: type === 'live' });
      gridEl.appendChild(card.el);
      return card;
    });
    cardNodes = cards.map((card) => card.el);
    // In the Favourites grid every card is a favourite: no heart.
    if (ctx.enrich) ctx.enrich(entries, cards, type, false, { hideFavorite: items[selected] && items[selected].kind === 'favorites' });
    const name = items[selected] ? items[selected].name : '';
    titleEl.textContent = name;
    count.textContent = entries.length ? t('browse.page', { page: formatNumber(page + 1, i18n.getLocale()), pages: formatNumber(Math.max(pages, page + 1), i18n.getLocale()) }) : '';
    renderHead();
    empty.style.display = entries.length ? 'none' : '';
  }

  /** The heart in the top bar follows the open category / genre: it adds or removes it from the favourites. */
  async function syncFavorite() {
    if (destroyed || !providerId) return;
    const item = items[selected];
    if (!item || (item.kind !== 'category' && item.kind !== 'genre' && item.kind !== 'network')) {
      favState = null;
      renderHead();
      return;
    }
    // A network is a title of its own (the same record as the heart on its page); categories and genres are favourite filters.
    const isNetwork = item.kind === 'network';
    const active = await (isNetwork ? ctx.favorites.has(providerId, item.id) : ctx.favorites.hasFilter(providerId, item.kind, type, item.id)).catch(() => false);
    const pinActive = await ctx.pins.has(providerId, item.kind, type, item.id).catch(() => false);
    if (destroyed || items[selected] !== item) return;
    const target = { kind: item.kind, type, id: item.id, name: item.name };
    favState = {
      active,
      pinActive,
      onToggle: async () => {
        const now = await (isNetwork ? ctx.favorites.toggle(providerId, item.id, type) : ctx.favorites.toggleFilter(providerId, target));
        const saved = await ctx.favorites.list(providerId);
        counts.set('favorites:', saved.filter((f) => f.type === type).length);
        if (!destroyed) {
          showCounts();
          syncFavorite();
        }
        ctx.notices.success(t(now ? 'notice.added' : 'notice.removed'), { key: 'favorite' });
      },
      onPin: async () => {
        const now = await ctx.pins.toggle(providerId, target);
        pinned = await ctx.pins.list(providerId, type);
        if (!destroyed) rebuildSidebar();
        ctx.notices.success(t(now ? 'notice.added' : 'notice.removed'), { key: 'pin' });
      },
    };
    renderHead();
  }

  /** Buttons of the head, left to right: pin and heart. */
  const headButtons = () => (favState ? (favState.onPin ? [{ el: pinBtn, run: favState.onPin }] : []).concat([{ el: favBtn, run: favState.onToggle }]) : []);

  const headZone = new FocusZone({
    id: HEAD_ZONE,
    model: new ListModel({ orientation: 'horizontal', getCount: () => headButtons().length }),
    onFocus: (i) => headButtons()[i] && headButtons()[i].el.classList.add('focused'),
    onBlur: (i) => headButtons()[i] && headButtons()[i].el.classList.remove('focused'),
    onActivate: (i) => headButtons()[i] && headButtons()[i].run(),
  });

  const byKeys = async (keys) => (await Promise.all(keys.map((key) => getEntry(db, key)))).filter(Boolean);

  /** Live TV "show all" lists the grouped channels (and the ones in no group): a pseudo category of its own. */
  const allCategory = () => (type === 'live' ? LIVE_ALL : null);
  const viewCategory = (item) => (item.kind === 'category' ? item.id : item.kind === 'all' ? allCategory() : null);

  /** Entries of the views that are not a plain catalog walk. */
  async function loadList(item) {
    if (item.kind === 'continue') {
      const recent = await continueWatching(ctx, { providerId, limit: 200 });
      return byKeys(recent.filter((r) => r.type === type).map((r) => r.entryKey));
    }
    if (item.kind === 'favorites') {
      const saved = (await ctx.favorites.list(providerId)).filter((f) => f.type === type);
      // Favourite categories and genres come first, as cards that open their own grid.
      const filters = await favoriteFilterEntries(saved, () => Promise.resolve(categories));
      return filters.concat(await byKeys(saved.filter((f) => !f.kind).map((f) => f.entryKey)));
    }
    if (item.kind === 'suggestions') {
      return suggestionEntries(true);
    }
    if (item.kind === 'genre') {
      return byKeys(await ctx.genres.entryKeys(type, item.id));
    }
    if (item.kind === 'network') {
      const network = networks.find((n) => n.key === item.id);
      return network ? byKeys(network.memberKeys) : [];
    }
    return null;
  }

  async function loadPage(nextPage, focusIndex) {
    const token = (loadToken += 1);
    const item = items[selected] || items[0];
    if (!entries.length) {
      // Nothing on screen yet: pulsing placeholders instead of an empty page.
      while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
      for (let i = 0; i < Math.min(pageSize, columns * 2); i += 1) gridEl.appendChild(createSkeletonCard());
    }
    // The first page of a catalog view (all, a category, a genre, a network) is cached; the views the user fills are not.
    const isList = LIST_KINDS.includes(item.kind);
    const cacheKey = nextPage === 0 && ctx.pageCache && CACHED_KINDS.includes(item.kind) ? `page:${providerId}:${type}:${item.kind}:${item.id === undefined ? '' : item.id}:${pageSize}` : null;
    const hit = cacheKey ? ctx.pageCache.get(cacheKey) : null;
    let result;
    if (hit) {
      list = null; // the next pages read the list on demand
      result = { entries: hit.entries, hasMore: hit.hasMore };
    } else {
      if (isList && (nextPage === 0 || !list)) list = await loadList(item).catch(() => []);
      else if (!isList) list = null;
      if (list) result = { entries: list.slice(nextPage * pageSize, (nextPage + 1) * pageSize), hasMore: list.length > (nextPage + 1) * pageSize };
      else result = await pageEntries(db, { type, categoryId: viewCategory(item), offset: nextPage * pageSize, limit: pageSize });
    }
    if (destroyed || token !== loadToken) return;
    if (nextPage === 0) {
      pages = hit ? hit.pages : Math.max(1, Math.ceil((list ? list.length : await countEntries(db, { type, categoryId: viewCategory(item) }).catch(() => 0)) / pageSize));
      if (cacheKey && !hit && !destroyed && token === loadToken) ctx.pageCache.set(cacheKey, { entries: result.entries, hasMore: result.hasMore, pages });
    }
    if (destroyed || token !== loadToken) return;
    page = nextPage;
    hasMore = result.hasMore;
    entries = result.entries;
    renderGrid();
    if (typeof focusIndex === 'number') ctx.focus.focus(GRID_ZONE, Math.min(focusIndex, entries.length - 1));
  }

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
      if (item.kind === 'toggle' || item.kind === 'genresToggle' || item.kind === 'networksToggle') {
        if (item.kind === 'toggle') expanded = !expanded;
        else if (item.kind === 'networksToggle') networksExpanded = !networksExpanded;
        else genresExpanded = !genresExpanded;
        selected = Math.min(selected, items.length - 1);
        rebuildSidebar(item.kind);
        return;
      }
      selected = i;
      catNodes.forEach((node, n) => node.classList.toggle('current', n === i));
      syncFavorite();
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
      if (entries[i].filterKind) {
        openFilter(ctx, entries[i], { push: true });
        return;
      }
      const item = items[selected];
      ctx.openEntry(entries[i], { section: params.section, live: { categoryId: item && item.kind === 'all' ? allCategory() : item && item.kind === 'category' ? item.id : null, offset: page * pageSize + i } });
    },
  });

  let restored = null; // state saved when the page was left (set right after mount, read by init)

  async function init() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    db = current.db; // shared handle: never closed here
    providerId = current.provider.id;
    pageSize = (await ctx.settings.get()).gridItems;
    const excluded = await ctx.settings.getExcluded(providerId, type);
    pinned = await ctx.pins.list(providerId, type).catch(() => []);
    // Seen before (and the catalog has not changed since): categories, genres, networks and their numbers come from the cache.
    sidebarVersion = await derivedVersion(db, { genres: true, locale: i18n.getLocale() }).catch(() => null);
    let cachedSidebar = ctx.pageCache ? ctx.pageCache.get(sidebarKey()) : null;
    if (!cachedSidebar && sidebarVersion) {
      cachedSidebar = await readDerived(db, sidebarKey(), sidebarVersion).catch(() => null);
      if (cachedSidebar && ctx.pageCache) ctx.pageCache.set(sidebarKey(), cachedSidebar);
    }
    if (cachedSidebar) {
      categories = cachedSidebar.categories;
      genres = cachedSidebar.genres;
      genresLoading = false;
      cachedSidebar.counts.forEach(([key, n]) => counts.set(key, n));
      countsLoading = false;
    } else categories = (await listCategories(db, type)).filter((c) => !excluded.has(String(c.id))).map((c) => ({ id: c.id, name: c.name }));
    // Coming back from a title: the same sidebar entry, page and focus as when the page was left.
    const back = restored;
    if (back) {
      expanded = back.expanded;
      networksExpanded = back.networksExpanded;
      genresExpanded = back.genresExpanded;
    }
    const filter = back ? back.item : params.filter || null;
    const wantsGenre = filter && filter.kind === 'genre';
    const loadGenres = async () => {
      if (type === 'live' || cachedSidebar) return;
      const found = await ctx.genres.list(type).catch(() => []);
      genres = found.map((g) => ({ key: g.key, name: g.name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    };
    if (wantsGenre) {
      await loadGenres();
      genresLoading = false;
    }
    expanded = Boolean(filter && filter.kind === 'category');
    networks = cachedSidebar ? cachedSidebar.networks : type === 'live' ? await listNetworks(db).catch(() => []) : [];
    // A hidden category or a network that no longer exists is not pinned in the sidebar.
    pinned = pinned.filter((p) => (p.kind !== 'category' || !excluded.has(String(p.id))) && (p.kind !== 'network' || networks.some((n) => n.key === p.id)));
    items = sidebarItems({ type, genres, categories, pinned, networks, networksExpanded, expanded, genresExpanded, genresLoading, labels: labels() });
    selected = indexOfFilter(items, filter);
    renderCategories();
    syncFavorite();
    await loadPage(0);
    if (!destroyed && back && back.page > 0) await loadPage(back.page);
    if (destroyed) return;
    // Land in the grid when there is something to browse, otherwise on the sidebar (a section that became empty, like Continue
    // watching after its last title was marked as seen).
    if (back && back.zone === CATS_ZONE) ctx.focus.focus(CATS_ZONE, selected);
    else if (entries.length) ctx.focus.focus(GRID_ZONE, back && back.zone === GRID_ZONE ? Math.min(back.index, entries.length - 1) : 0);
    else ctx.focus.focus(CATS_ZONE, Math.max(0, selected));
    if (!wantsGenre && type !== 'live') {
      await loadGenres();
      genresLoading = false;
      if (!destroyed) rebuildSidebar();
    }
    loadUserCounts().catch((err) => log.warn('Sidebar counts failed', err && err.message));
    if (cachedSidebar) return;
    loadCatalogCounts()
      .then((complete) => {
        if (complete && !destroyed) storeSidebar();
      })
      .catch((err) => log.warn('Sidebar counts failed', err && err.message))
      .finally(() => {
        countsLoading = false;
        if (!destroyed) showCounts();
      });
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
      init().catch((err) => log.warn('Browse init failed', err && err.message));
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(HEAD_ZONE);
      ctx.focus.unregister(CATS_ZONE);
      ctx.focus.unregister(GRID_ZONE);
    },
    /** What is needed to come back to the same place: the sidebar entry, the page and where the focus was. */
    saveState() {
      const item = items[selected];
      const zone = ctx.focus.activeId;
      return {
        item: item ? { kind: item.kind, id: item.id } : null,
        expanded,
        networksExpanded,
        genresExpanded,
        page,
        zone,
        index: ctx.focus.active && ctx.focus.activeId === zone ? ctx.focus.active.index : 0,
      };
    },
    restoreState(state) {
      restored = state;
    },
  };
}
