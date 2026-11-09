import { continueWatching } from '../../services/continueWatching.js';
import { h } from '../dom.js';
import { createCard, createSkeletonCard } from '../components/card.js';
import { derivedVersion, readDerivedAny, writeDerived } from '../../services/derivedStore.js';
import { t, i18n } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel, ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { isFilterEntry, filterCardMeta } from '../components/typedRows.js';
import { favoriteFilterEntries, openFilter } from '../../services/favoriteFilters.js';
import { ensureVisible } from '../scroll.js';
import { listCategories, listNetworks, pageEntries, getEntry, countEntries, LIVE_ALL } from '../../services/catalogQuery.js';
import { readGuideIndex } from '../../services/guideIndex.js';
import { genreKey } from '../../services/epgChannels.js';
import { icon } from '../icons.js';
import { formatNumber } from '../../core/format.js';
import { log } from '../../core/logger.js';
import { createEpgGuide, floorHalfHour, nextProgramme, PAST_MS, SPAN_MS } from '../components/epgGuide.js';
import { applyGuideLayout, moveInLayout, hideInLayout } from '../../services/guideLayout.js';
import { foldName } from '../../services/shareKeys.js';

const CATS_ZONE = 'browseCategories';
/** Icon before the label of the fixed sidebar entries (genres and categories get an empty slot to stay aligned). */
export const SIDEBAR_ICON = { guide: 'clock', scheduled: 'scheduled', all: 'all', continue: 'continue', favorites: 'heart', suggestions: 'suggestions', genresToggle: 'genres', epgGenresToggle: 'genres', toggle: 'categories', networksToggle: 'network' };
/** Placeholder rows shown while the genres load: enough that the "Categories" entry stays below the screen. */
export const GENRE_SKELETONS = 12;
const GRID_ZONE = 'browseGrid';
const GUIDE_ZONE = 'browseGuide';
const HEAD_ZONE = 'browseHead';
/** Views that are loaded as one in-memory list and paged locally. */
const LIST_KINDS = ['continue', 'favorites', 'suggestions', 'genre', 'network'];
/** Sidebar entries shown as a programme guide instead of a grid: the guide, the scheduled programmes, a genre of the guide. */
const isGuideKind = (kind) => kind === 'guide' || kind === 'scheduled' || kind === 'epgGenre';
/** Views read from the catalog only (so their first page can be cached); continue, favourites and suggestions come from the user. */
const CACHED_KINDS = ['all', 'category', 'genre', 'network'];
/** Every media type uses the same 6-column grid of equally sized cards (channels included). */
export const columnsFor = () => 6;

/** Rows loaded beyond the bottom of the screen (the grid grows as the focus goes down; no pages). */
export const PREFETCH_ROWS = 3;
/** Rows on screen before they can be measured. */
const DEFAULT_SCREEN_ROWS = 3;
/** Cards loaded at least each time the grid grows. */
const BATCH_ROWS = 4;

/**
 * Rows of the grid that keep their pictures for the focus on `index`: from PREFETCH_ROWS rows above the screen down (the rows further
 * up free theirs and show the skeleton again until they are near the screen). `screenRows`: rows on screen. Returns the first such row.
 */
export function firstKeptRow(index, columns, screenRows = DEFAULT_SCREEN_ROWS, margin = PREFETCH_ROWS) {
  const row = Math.floor(Math.max(0, index) / columns);
  return Math.max(0, row - Math.max(1, screenRows) + 1 - margin); // the focused row can be the last one on screen
}

/** How many cards must be loaded for the focus on `index`: up to its row, the rows on screen below it and PREFETCH_ROWS more. */
export function wantedCount(index, columns, screenRows = DEFAULT_SCREEN_ROWS, ahead = PREFETCH_ROWS) {
  const row = Math.floor(Math.max(0, index) / columns);
  return (row + Math.max(1, screenRows) + ahead) * columns;
}

/**
 * Grid navigation of a grid that grows while scrolling: a plain GridModel, but Down from the last loaded row waits for the next cards
 * (`more()` is asked for them) instead of leaving the grid when the view has more.
 */
export function createGrowingGridModel({ columns, getCount, hasMore, more }) {
  const grid = new GridModel({ columns, getCount });
  return {
    getCount,
    navigate(dir, index) {
      const result = grid.navigate(dir, index);
      if (result.type === 'exit' && result.dir === 'down' && hasMore()) {
        more();
        return { type: 'move', index };
      }
      return result;
    },
  };
}

/**
 * Sidebar entries. Movies and series: show all, continue watching, favourites, suggestions, a "Genres"
 * entry (open by default) with the genres, then a "Categories" entry that expands into the provider categories. Channels: show all, favourites, pinned categories,
 * the "Genres" entry of the guide's categories (open, only when the guide has them), the "Networks" entry (open, closed when the guide genres
 * are there) and the categories (closed).
 */
export function sidebarItems({ type, genres = [], epgGenres = [], epgGenresExpanded = true, categories = [], pinned = [], networks = [], networksExpanded = true, expanded = false, genresExpanded = true, genresLoading = false, scheduled = false, labels }) {
  // Live TV opens on the programme guide; "show all" follows it.
  // "Scheduled" (programmes whose viewing is scheduled) follows the guide when there are any.
  const items = type === 'live' ? [{ kind: 'guide', name: labels.guide }].concat(scheduled ? [{ kind: 'scheduled', name: labels.scheduled }] : [], [{ kind: 'all', name: labels.all }]) : [{ kind: 'all', name: labels.all }];
  if (type === 'live') {
    items.push({ kind: 'favorites', name: labels.favorites });
    pinned.forEach((p) => items.push({ kind: p.kind, id: String(p.id), name: p.name, pinned: true }));
    if (epgGenres.length) {
      items.push({ kind: 'epgGenresToggle', name: labels.genres, expanded: epgGenresExpanded });
      if (epgGenresExpanded) epgGenres.forEach((g) => items.push({ kind: 'epgGenre', id: g.key, name: g.name, depth: 1 }));
    }
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
  let networksExpanded = true; // networks group: open by default, closed when the guide genres are listed
  let epgGenres = []; // Live TV: genres of the guide [{ key, name }], with at least one channel
  let epgGenreKeys = new Map(); // genre key → the keys of its rows (groups and channels in no group)
  let epgGenresExpanded = true; // guide genres group: open by default
  let genresExpanded = true; // genres group: open by default
  let genresLoading = type !== 'live';
  let countsLoading = true;
  let items = []; // sidebar entries
  let catNodes = [];
  let selected = 0; // index into `items` currently shown in the grid
  let list = null; // fully loaded entries for continue / favourites / genre views (read in memory as the grid grows)
  let hasMore = false;
  let total = 0; // titles of the view (the number in the head)
  let moreJob = null; // the next cards being read
  let entries = [];
  let cardNodes = [];
  let cards = [];
  let loadToken = 0;
  const counts = new Map(); // sidebar numbers: 'kind:id' → how many titles

  const labels = () => ({ guide: t('epg.guide'), scheduled: t('epg.scheduled'), all: t('browse.all'), continue: t('home.continue'), favorites: t('nav.favorites'), suggestions: t('nav.suggestions'), genres: t('detail.genres'), categories: t('detail.categories'), networks: t('networks.title') });

  function renderCategories() {
    while (catList.firstChild) catList.removeChild(catList.firstChild);
    catNodes = items.map((item, i) => {
      const node = h('div', { class: `browse-cat${i === selected ? ' current' : ''}${item.depth ? ' sub' : ''}` });
      // Only entries with an icon get the icon slot: the others start at the left edge.
      const iconName = item.pinned ? 'pin' : SIDEBAR_ICON[item.kind];
      if (iconName) node.appendChild(h('span', { class: 'browse-cat-icon' }, icon(iconName)));
      node.appendChild(h('span', { class: 'browse-cat-name', text: item.name }));
      const text = countText(item);
      node.appendChild(h('span', { class: `browse-cat-count${countPending(item, text) ? ' skeleton-line' : ''}`, text }));
      if (item.kind === 'toggle' || item.kind === 'genresToggle' || item.kind === 'networksToggle' || item.kind === 'epgGenresToggle') node.appendChild(icon('chevron', item.expanded ? 'open' : ''));
      catList.appendChild(node);
      // While the genres are being found, grey placeholders hold their place under the "Genres" entry.
      if (item.kind === 'genresToggle' && genresLoading && genresExpanded) {
        for (let n = 0; n < GENRE_SKELETONS; n += 1) {
          catList.appendChild(h('div', { class: 'browse-cat sub skeleton-cat' }, h('span', { class: 'browse-cat-name skeleton-line' }), h('span', { class: 'browse-cat-count skeleton-line' })));
        }
      }
      return node;
    });
    revealCurrent();
  }

  /**
   * While the focus is elsewhere (the grid, coming back from a title) the sidebar shows the entry of the grid on screen, in its middle,
   * and Left from the grid lands on it.
   */
  function revealCurrent() {
    if (ctx.focus.activeId === CATS_ZONE) return;
    catsZone.index = Math.max(0, selected);
    const node = catNodes[selected];
    if (!node || !catList.clientHeight) return;
    catList.scrollTop = Math.max(0, node.offsetTop - (catList.clientHeight - node.offsetHeight) / 2);
  }

  /** Shows the grid of a sidebar entry; the focus goes to the grid (or the guide) unless `stayInSidebar`. */
  function selectItem(i, stayInSidebar = true) {
    selected = i;
    catNodes.forEach((node, n) => node.classList.toggle('current', n === i));
    syncFavorite();
    if (stayInSidebar) ctx.focus.focus(CATS_ZONE, i);
    else revealCurrent();
    (stayInSidebar ? loadView() : loadView(0)).catch((err) => log.warn('Browse load failed', err && err.message));
  }

  const countKey = (item) => `${item.kind}:${item.id === undefined ? '' : item.id}`;
  const countText = (item) => {
    const n = item.kind === 'toggle' ? categories.length : item.kind === 'networksToggle' ? networks.length : item.kind === 'epgGenresToggle' ? epgGenres.length : item.kind === 'genresToggle' ? (genresLoading ? undefined : genres.length) : counts.get(countKey(item));
    return n === undefined ? '' : formatNumber(n, i18n.getLocale());
  };
  const countPending = (item, text) => text === '' && countsLoading && item.kind !== 'guide' && item.kind !== 'scheduled'; // counted apart
  function showCounts() {
    items.forEach((item, i) => {
      const slot = catNodes[i] && catNodes[i].querySelector('.browse-cat-count');
      if (!slot) return;
      const text = countText(item);
      slot.textContent = text;
      slot.classList.toggle('skeleton-line', countPending(item, text));
    });
  }

  const setCount = (key, n) => {
    counts.set(key, n);
    if (!destroyed) showCounts();
  };
  const safe = (job) => job().catch(() => undefined);

  /** Favourites of this type that this provider can show (shared ones it does not carry are not counted). */
  async function favoriteCount() {
    const saved = (await ctx.favorites.list(providerId)).filter((f) => f.type === type);
    const filters = await favoriteFilterEntries(saved, () => Promise.resolve(categories), epgGenreSet);
    const titles = await byKeys(saved.filter((f) => !f.kind).map((f) => f.entryKey));
    return filters.length + titles.length;
  }

  /** The numbers that depend on the user (continue watching, favourites, suggestions): read every time, never cached. */
  async function loadUserCounts() {
    if (type === 'live') {
      await safe(async () => setCount('guide:', (await guideList()).length));
      setCount('scheduled:', scheduledCount);
    }
    if (type !== 'live') await safe(async () => setCount('continue:', (await continueWatching(ctx, { providerId, limit: 200 })).filter((r) => r.type === type).length));
    await safe(async () => setCount('favorites:', await favoriteCount()));
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
  function storeSidebar(withCounts = true) {
    if (!providerId) return;
    const catalogCounts = withCounts ? Array.from(counts.entries()).filter(([key]) => !/^(continue|favorites|suggestions):/.test(key)) : null;
    const stored = { categories, networks, genres, counts: catalogCounts };
    if (ctx.pageCache && withCounts) ctx.pageCache.set(sidebarKey(), stored);
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

  /**
   * The pins as sidebar entries for this provider. Pins are shared by all providers: a category is pinned by its folded name and found here by it;
   * a hidden category, a genre or a network this provider does not have is not shown (the pin stays saved for the providers that have it).
   */
  function pinnedView() {
    return pinned
      .map((p) => {
        if (p.kind === 'category') {
          const found = categories.find((c) => foldName(c.name) === p.id);
          return found ? { ...p, id: String(found.id), name: found.name } : null;
        }
        if (p.kind === 'network') return networks.some((n) => n.key === p.id) ? p : null;
        // A genre of the guide: shown while the current guide has it (it comes back with a later guide that has it again).
        if (p.kind === 'epgGenre') {
          const found = epgGenres.find((g) => g.key === p.id);
          return found ? { ...p, name: found.name } : null;
        }
        if (p.kind === 'genre' && !genresLoading && type !== 'live') return genres.some((g) => g.key === p.id) ? p : null;
        return p;
      })
      .filter(Boolean);
  }

  /** Rebuilds the sidebar keeping the same entry selected (genres arrive late, categories expand). */
  function rebuildSidebar(focusKey) {
    const keep = items[selected];
    items = sidebarItems({ type, genres, epgGenres, epgGenresExpanded, categories, pinned: pinnedView(), networks, networksExpanded, expanded, genresExpanded, genresLoading, scheduled: scheduledCount > 0, labels: labels() });
    const same = keep ? items.findIndex((item) => item.kind === keep.kind && String(item.id) === String(keep.id)) : -1;
    selected = same >= 0 ? same : 0;
    renderCategories();
    syncFavorite();
    if (focusKey !== undefined && ctx.focus.activeId === CATS_ZONE) {
      const at = items.findIndex((item) => item.kind === focusKey);
      if (at >= 0) ctx.focus.focus(CATS_ZONE, at);
    }
  }

  /** Cards for entries added at the end of the grid (the placeholders of the next row go). */
  function appendCards(added) {
    gridEl.querySelectorAll('.skeleton-more').forEach((node) => node.remove());
    const made = added.map((entry) => {
      const card = createCard(entry, type, { ...(isFilterEntry(entry) ? filterCardMeta(entry) : {}), square: type === 'live' });
      gridEl.appendChild(card.el);
      return card;
    });
    cards = cards.concat(made);
    cardNodes = cards.map((card) => card.el);
    // In the Favourites grid every card is a favourite: no heart.
    if (ctx.enrich && made.length) ctx.enrich(added, made, type, false, { hideFavorite: items[selected] && items[selected].kind === 'favorites' });
  }

  function renderGrid() {
    while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
    cards = [];
    cardNodes = [];
    appendCards(entries);
    const name = items[selected] ? items[selected].name : '';
    titleEl.textContent = name;
    count.textContent = entries.length ? formatNumber(Math.max(total, entries.length), i18n.getLocale()) : '';
    renderHead();
    empty.style.display = entries.length ? 'none' : '';
  }

  /** The heart in the top bar follows the open category / genre: it adds or removes it from the favourites. */
  async function syncFavorite() {
    if (destroyed || !providerId) return;
    const item = items[selected];
    if (!item || (item.kind !== 'category' && item.kind !== 'genre' && item.kind !== 'network' && item.kind !== 'epgGenre')) {
      favState = null;
      renderHead();
      return;
    }
    // A network is a title of its own (the same record as the heart on its page); categories and genres are favourite filters.
    const isNetwork = item.kind === 'network';
    const active = await (isNetwork ? ctx.favorites.has(providerId, item.id) : ctx.favorites.hasFilter(providerId, item.kind, type, item.id)).catch(() => false);
    const pinActive = await ctx.pins.has(providerId, item.kind, type, item.id, item.name).catch(() => false);
    if (destroyed || items[selected] !== item) return;
    const target = { kind: item.kind, type, id: item.id, name: item.name };
    favState = {
      active,
      pinActive,
      onToggle: async () => {
        const now = await (isNetwork ? ctx.favorites.toggle(providerId, item.id, type) : ctx.favorites.toggleFilter(providerId, target));
        counts.set('favorites:', await favoriteCount());
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
      const filters = await favoriteFilterEntries(saved, () => Promise.resolve(categories), epgGenreSet);
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

  /** Rows of cards the screen shows (measured once there are two rows). */
  function screenRows() {
    const scroller = gridEl.closest('.page');
    const first = cardNodes[0];
    const below = cardNodes[columns];
    const rowHeight = first && below ? below.offsetTop - first.offsetTop : 0;
    return scroller && rowHeight > 0 ? Math.ceil(scroller.clientHeight / rowHeight) : DEFAULT_SCREEN_ROWS;
  }

  /** The next `count` entries of the view (from the in-memory list or the catalog). */
  async function readEntries(item, offset, count) {
    if (LIST_KINDS.includes(item.kind)) {
      if (!list) list = await loadList(item).catch(() => []); // read once per view, on the first cards that need it
      return { entries: list.slice(offset, offset + count), hasMore: list.length > offset + count };
    }
    return pageEntries(db, { type, categoryId: viewCategory(item), offset, limit: count });
  }

  /** Adds the next cards at the end of the grid (one read at a time; a new view drops what was still arriving for the old one). */
  function loadMore(count) {
    if (moreJob || !hasMore) return moreJob || Promise.resolve();
    const token = loadToken;
    const item = items[selected] || items[0];
    for (let i = 0; i < columns; i += 1) {
      const placeholder = createSkeletonCard();
      placeholder.classList.add('skeleton-more');
      gridEl.appendChild(placeholder);
    }
    moreJob = readEntries(item, entries.length, Math.max(count, columns * BATCH_ROWS))
      .then((result) => {
        if (destroyed || token !== loadToken) return;
        hasMore = result.hasMore;
        entries = entries.concat(result.entries);
        appendCards(result.entries);
      })
      .catch((err) => {
        if (token === loadToken) hasMore = false; // no endless retries: the grid stops where it is
        log.warn('Browse load failed', err && err.message);
      })
      .finally(() => {
        if (token === loadToken) moreJob = null;
        if (!hasMore) gridEl.querySelectorAll('.skeleton-more').forEach((node) => node.remove());
      });
    return moreJob;
  }

  /** The pictures of the rows more than PREFETCH_ROWS above the screen are freed; the ones near it again are loaded back. */
  function syncImages(index) {
    const keepFrom = firstKeptRow(index, columns, screenRows()) * columns;
    cards.forEach((card, i) => {
      if (i < keepFrom) card.release();
      else card.restore();
    });
  }

  /** The focus is on `index`: the cards down to PREFETCH_ROWS rows below the screen are loaded (in the background). */
  function ensureLoaded(index) {
    const need = wantedCount(index, columns, screenRows());
    if (entries.length < need && hasMore) loadMore(need - entries.length).then(() => ensureLoaded(index));
  }

  /** Loads until the card at `index` exists (coming back to a title far down the grid). */
  async function loadUntil(index) {
    const token = loadToken;
    while (!destroyed && token === loadToken && entries.length <= index && hasMore) await loadMore(index + 1 - entries.length);
  }

  /** Shows the grid of the selected sidebar entry from its first cards; the focus goes to `focusIndex` when given. */
  async function loadView(focusIndex) {
    const token = (loadToken += 1);
    moreJob = null;
    const item = items[selected] || items[0];
    if (isGuideKind(item.kind)) {
      await showGuide(typeof focusIndex === 'number');
      handOff();
      return;
    }
    hideGuide();
    if (!entries.length) {
      // Nothing on screen yet: pulsing placeholders instead of an empty page.
      while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
      for (let i = 0; i < columns * 2; i += 1) gridEl.appendChild(createSkeletonCard());
    }
    // The first cards of a catalog view (all, a category, a genre, a network) are cached; the views the user fills are not.
    const firstCount = wantedCount(0, columns);
    const cacheKey = ctx.pageCache && CACHED_KINDS.includes(item.kind) ? `view:${providerId}:${type}:${item.kind}:${item.id === undefined ? '' : item.id}:${firstCount}` : null;
    const hit = cacheKey ? ctx.pageCache.get(cacheKey) : null;
    list = null; // the list views read their list again (on the first cards they need past the cached ones)
    const result = hit ? { entries: hit.entries, hasMore: hit.hasMore } : await readEntries(item, 0, firstCount);
    if (destroyed || token !== loadToken) return;
    let count = hit ? hit.total : list ? list.length : await countEntries(db, { type, categoryId: viewCategory(item) }).catch(() => 0);
    if (destroyed || token !== loadToken) return;
    count = Math.max(count, result.entries.length);
    if (cacheKey && !hit) ctx.pageCache.set(cacheKey, { entries: result.entries, hasMore: result.hasMore, total: count });
    total = count;
    hasMore = result.hasMore;
    entries = result.entries;
    renderGrid();
    if (typeof focusIndex !== 'number') handOff();
    if (typeof focusIndex === 'number') ctx.focus.focus(GRID_ZONE, Math.min(focusIndex, entries.length - 1));
  }

  // Programme guide (Live TV): shown instead of the grid while its sidebar entry ("guide" or "scheduled") is selected.
  const guideHost = h('div', { class: 'epg-host' });
  guideHost.style.display = 'none';
  let guide = null;
  let guideKind = null; // 'guide' | 'scheduled' | 'epgGenre:<key>': what the guide on screen shows
  let guideState = null; // where the focus was in the guide, to come back to it
  let guideRowsJob = null;
  let stopGuideUpdates = null;
  let stopScheduleUpdates = null;
  let scheduledCount = 0;

  /**
   * The rows of the guide: groups and channels with at least one programme in the hours shown (the others are left out), as the user
   * arranged them (removed ones out, order kept). Read once, again when the guide is downloaded or the arrangement changes.
   */
  const guideList = () =>
    guideRowsJob ||
    (guideRowsJob = (async () => {
      const t0 = Date.now();
      const from = floorHalfHour(t0) - PAST_MS;
      const withGuide = ctx.epg && ctx.epg.channelsWithGuide ? await ctx.epg.channelsWithGuide(from, from + PAST_MS + SPAN_MS) : new Set();
      // The row list is a small record written with the catalog: only the entries of the rows on screen are read (see loadRows).
      const rows = (await readGuideIndex(db)).filter((row) => withGuide.has(row.epgChannelId));
      return applyGuideLayout(rows, await ctx.guideLayout.read(providerId, db));
    })());

  /** The keys of the guide genres listed now (favourite guide genres the guide no longer has are hidden). */
  const epgGenreSet = async () => new Set(epgGenres.map((g) => g.key));

  /**
   * The genres of the guide (XMLTV categories) and their rows: a channel counts once, as its group when it has one. Nothing when the guide
   * has no categories or expired.
   */
  async function loadEpgGenres() {
    if (type !== 'live' || !ctx.epg || !ctx.epg.genreRows) return;
    const found = await ctx.epg.genreRows();
    epgGenres = found.genres;
    epgGenreKeys = found.rows;
    epgGenres.forEach((g) => counts.set(`epgGenre:${g.key}`, found.rows.get(g.key).length));
  }

  /** The scheduled programmes of this provider, and the rows of their channels (the "scheduled" view). */
  async function scheduledRows() {
    const list = ctx.schedules ? await ctx.schedules.list(providerId) : [];
    const keys = Array.from(new Set(list.map((s) => s.entryKey)));
    const rows = [];
    for (const key of keys) {
      const entry = await getEntry(db, key);
      if (entry) rows.push(entry);
    }
    return { list, rows };
  }

  async function onGuideRowAction(id, entry) {
    const list = await guideList();
    const layout = await ctx.guideLayout.read(providerId, db);
    if (id === 'remove') {
      await ctx.guideLayout.save(providerId, hideInLayout(layout, entry.key));
      guideRowsJob = null;
      await guide.reload({ row: list.findIndex((r) => r.key === entry.key) });
      setCount('guide:', (await guideList()).length);
      return;
    }
    const moved = moveInLayout(list, layout, entry.key, id === 'up' ? -1 : 1);
    if (!moved) return;
    await ctx.guideLayout.save(providerId, moved.layout);
    guideRowsJob = null;
    await guide.reload({ row: moved.row, keepRowMode: true });
  }

  /**
   * A genre of the guide: the rows (groups and channels in no group) with at least one programme of that category in the hours shown, and
   * those programmes only (the category belongs to the programme, not to the channel). Read once per view.
   */
  let genreGuideJob = null;
  function genreGuide(key) {
    if (genreGuideJob && genreGuideJob.key === key) return genreGuideJob.promise;
    const promise = (async () => {
      const from = floorHalfHour(Date.now()) - PAST_MS;
      const to = from + PAST_MS + SPAN_MS;
      const keys = new Set(epgGenreKeys.get(key) || []);
      const candidates = (await readGuideIndex(db)).filter((row) => keys.has(row.key));
      const ids = Array.from(new Set(candidates.map((row) => row.epgChannelId)));
      const all = ctx.epg && ctx.epg.programmesBetween ? await ctx.epg.programmesBetween(ids, from, to) : new Map();
      const programmes = new Map();
      all.forEach((list, id) => {
        const mine = list.filter((p) => (p.categories || []).some((name) => genreKey(name) === key));
        if (mine.length) programmes.set(id, mine);
      });
      const rows = applyGuideLayout(candidates.filter((row) => programmes.has(row.epgChannelId)), await ctx.guideLayout.read(providerId, db));
      return { rows, programmes };
    })();
    genreGuideJob = { key, promise };
    return promise;
  }

  function makeGuide(kind) {
    const common = {
      // The channel page opens with the focus on the programme the guide was on.
      onOpen: (entry, row, programme) => ctx.openEntry(entry, programme ? { section: params.section, programme: programme.start } : { section: params.section }),
      getTimeFormat: () => timeFormat,
      enrich: ctx.enrich ? (list, guideCards) => ctx.enrich(list, guideCards, type) : null,
    };
    if (kind.indexOf('epgGenre:') === 0) {
      // Only the programmes of that category, on the rows that have some; the focus moves only between them, across and down.
      const key = kind.slice('epgGenre:'.length);
      return createEpgGuide({
        ...common,
        emptyText: '',
        pickSegment: nextProgramme, // the programme of the category closest to now
        programmesOnly: true,
        loadRows: async (offset, limit) => ({ entries: await byKeys((await genreGuide(key)).rows.slice(offset, offset + limit).map((row) => row.key)) }),
        countRows: async () => (await genreGuide(key)).rows.length,
        programmes: async (ids) => {
          const { programmes } = await genreGuide(key);
          return new Map(ids.map((id) => [id, programmes.get(id) || []]));
        },
      });
    }
    if (kind === 'scheduled') {
      // Only the scheduled programmes, on the rows of their channels; the rest of the axis stays empty.
      return createEpgGuide({
        ...common,
        emptyText: '',
        pickSegment: nextProgramme, // the scheduled programme closest to now
        programmesOnly: true, // the focus moves only between scheduled programmes
        loadRows: async (offset, limit) => ({ entries: (await scheduledRows()).rows.slice(offset, offset + limit) }),
        countRows: async () => (await scheduledRows()).rows.length,
        programmes: async (ids) => {
          const { list } = await scheduledRows();
          return new Map(ids.map((id) => [id, list.filter((s) => s.channelId === id).map((s) => ({ start: s.start, stop: s.stop, title: s.title }))]));
        },
      });
    }
    return createEpgGuide({
      ...common,
      loadRows: async (offset, limit) => ({ entries: await byKeys((await guideList()).slice(offset, offset + limit).map((row) => row.key)) }),
      countRows: async () => (await guideList()).length,
      programmes: (ids, from, to) => (ctx.epg && ctx.epg.programmesBetween ? ctx.epg.programmesBetween(ids, from, to) : Promise.resolve(new Map())),
      // OK held on a row: from the right, remove it, move it up, move it down (saved in the provider database).
      rowActions: [
        { id: 'down', icon: 'moveDown', label: t('epg.moveDown') },
        { id: 'up', icon: 'moveUp', label: t('epg.moveUp') },
        { id: 'remove', icon: 'remove', label: t('epg.removeRow') },
      ],
      defaultRowAction: 1,
      onRowAction: (id, entry) => onGuideRowAction(id, entry).catch((err) => log.warn('Guide row action failed', err && err.message)),
    });
  }

  async function showGuide(focusIt) {
    const item = items[selected];
    const kind = item ? (item.kind === 'epgGenre' ? `epgGenre:${item.id}` : item.kind) : 'guide';
    entries = [];
    cards = [];
    cardNodes = [];
    while (gridEl.firstChild) gridEl.removeChild(gridEl.firstChild);
    gridEl.style.display = 'none';
    empty.style.display = 'none';
    titleEl.textContent = items[selected] ? items[selected].name : '';
    count.textContent = '';
    renderHead();
    guideHost.style.display = '';
    ctx.focus.link(CATS_ZONE, 'right', GUIDE_ZONE);
    ctx.focus.link(HEAD_ZONE, 'down', GUIDE_ZONE);
    if (guide && guideKind !== kind) {
      guide.destroy();
      guide.el.remove();
      guide = null;
    }
    if (!guide) {
      guideKind = kind;
      guide = makeGuide(kind);
      guideHost.appendChild(guide.el);
      await guide.start();
      if (destroyed) return;
      if (guideState && kind === 'guide') guide.restore(guideState);
    }
    if (focusIt && guide.count) ctx.focus.focus(GUIDE_ZONE, 0);
  }

  function hideGuide() {
    gridEl.style.display = '';
    guideHost.style.display = 'none';
    ctx.focus.link(CATS_ZONE, 'right', GRID_ZONE);
    ctx.focus.link(HEAD_ZONE, 'down', GRID_ZONE);
  }

  const guideZone = new FocusZone({
    id: GUIDE_ZONE,
    model: {
      getCount: () => (guide && guideHost.style.display !== 'none' ? guide.model.getCount() : 0),
      navigate: (dir, index) => guide.model.navigate(dir, index),
    },
    onFocus: () => guide && guide.onFocus(),
    onBlur: () => guide && guide.onBlur(),
    onActivate: () => guide && guide.activate(),
    onLongActivate: () => guide && guide.longActivate(),
  });

  const catsZone = new FocusZone({
    id: CATS_ZONE,
    model: new ListModel({ orientation: 'vertical', getCount: () => items.length }),
    onFocus: (i) => {
      if (i !== selected) autoSidebar = false; // the user moved in the sidebar: the focus is theirs
      if (!catNodes[i]) return;
      catNodes[i].classList.add('focused');
      catNodes[i].scrollIntoView({ block: 'nearest' });
    },
    onBlur: (i) => catNodes[i] && catNodes[i].classList.remove('focused'),
    onActivate: (i) => {
      autoSidebar = false;
      const item = items[i];
      if (item.kind === 'toggle' || item.kind === 'genresToggle' || item.kind === 'networksToggle' || item.kind === 'epgGenresToggle') {
        if (item.kind === 'toggle') expanded = !expanded;
        else if (item.kind === 'networksToggle') networksExpanded = !networksExpanded;
        else if (item.kind === 'epgGenresToggle') epgGenresExpanded = !epgGenresExpanded;
        else genresExpanded = !genresExpanded;
        selected = Math.min(selected, items.length - 1);
        rebuildSidebar(item.kind);
        return;
      }
      selected = i;
      catNodes.forEach((node, n) => node.classList.toggle('current', n === i));
      syncFavorite();
      loadView(0).catch((err) => log.warn('Browse load failed', err && err.message));
    },
  });

  /**
   * The page opened with nothing to show yet (the guide of Live TV before its first download) and put the focus on the sidebar entry:
   * when the content arrives the focus goes to it, unless the user has moved since.
   */
  let autoSidebar = false;
  function handOff() {
    if (!autoSidebar || destroyed || ctx.focus.activeId !== CATS_ZONE || catsZone.index !== selected) return;
    const item = items[selected];
    const ok = item && isGuideKind(item.kind) ? ctx.focus.focus(GUIDE_ZONE, 0) : entries.length > 0 && ctx.focus.focus(GRID_ZONE, 0);
    if (ok) autoSidebar = false;
  }

  /** The main grid of the page: the guide for Live TV, "show all" for the others. */
  const mainIndex = () => items.findIndex((item) => item.kind === (type === 'live' ? 'guide' : 'all'));

  const gridZone = new FocusZone({
    id: GRID_ZONE,
    model: createGrowingGridModel({
      columns,
      getCount: () => entries.length,
      hasMore: () => hasMore,
      more: () => loadMore(columns * BATCH_ROWS),
    }),
    onFocus: (i) => {
      if (!cardNodes[i]) return;
      cardNodes[i].classList.add('focused');
      ensureVisible(cardNodes[i], { first: i < columns });
      ensureLoaded(i);
      syncImages(i);
    },
    onBlur: (i) => cardNodes[i] && cardNodes[i].classList.remove('focused'),
    onActivate: (i) => {
      if (!entries[i]) return;
      if (entries[i].filterKind) {
        openFilter(ctx, entries[i], { push: true });
        return;
      }
      const item = items[selected];
      ctx.openEntry(entries[i], { section: params.section, live: { categoryId: item && item.kind === 'all' ? allCategory() : item && item.kind === 'category' ? item.id : null, offset: i } });
    },
  });

  let restored = null; // state saved when the page was left (set right after mount, read by init)
  let timeFormat = 'auto';

  async function init() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    db = current.db; // shared handle: never closed here
    providerId = current.provider.id;
    const prefs = await ctx.settings.get();
    timeFormat = prefs.timeFormat || 'auto';
    const excluded = await ctx.settings.getExcluded(providerId, type);
    pinned = await ctx.pins.list(providerId, type).catch(() => []);
    // Seen before (and the catalog has not changed since): categories, genres, networks and their numbers come from the cache.
    if (type === 'live' && ctx.schedules) scheduledCount = (await ctx.schedules.list(providerId).catch(() => [])).length;
    sidebarVersion = await derivedVersion(db, { genres: true, locale: i18n.getLocale() }).catch(() => null);
    let cachedSidebar = ctx.pageCache ? ctx.pageCache.get(sidebarKey()) : null;
    let stale = false; // the saved copy is from before a sync / genre job: shown at once, worked out again behind it
    if (!cachedSidebar && sidebarVersion) {
      const saved = await readDerivedAny(db, sidebarKey(), sidebarVersion).catch(() => null);
      if (saved) {
        cachedSidebar = saved.value;
        stale = !saved.fresh;
        if (!stale && ctx.pageCache && cachedSidebar.counts) ctx.pageCache.set(sidebarKey(), cachedSidebar);
      }
    }
    const haveCounts = Boolean(cachedSidebar && cachedSidebar.counts);
    const fresh = Boolean(cachedSidebar) && !stale;
    if (cachedSidebar) {
      categories = cachedSidebar.categories;
      genres = cachedSidebar.genres;
      genresLoading = false;
      if (haveCounts) {
        cachedSidebar.counts.forEach(([key, n]) => counts.set(key, n));
        countsLoading = false;
      }
    } else categories = (await listCategories(db, type)).filter((c) => !excluded.has(String(c.id))).map((c) => ({ id: c.id, name: c.name }));
    // Coming back from a title: the same sidebar entry, page and focus as when the page was left.
    const back = restored;
    if (back) {
      expanded = back.expanded;
      networksExpanded = back.networksExpanded;
      genresExpanded = back.genresExpanded;
      if (back.epgGenresExpanded !== undefined) epgGenresExpanded = back.epgGenresExpanded;
    }
    const filter = back ? back.item : params.filter || null;
    const wantsGenre = filter && filter.kind === 'genre';
    const loadGenres = async () => {
      if (type === 'live' || fresh) return;
      const found = await ctx.genres.list(type).catch(() => []);
      genres = found.map((g) => ({ key: g.key, name: g.name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      storeSidebar(false); // the lists are kept at once (the numbers follow): the next visit does not wait for them
    };
    if (wantsGenre) {
      await loadGenres();
      genresLoading = false;
    }
    expanded = Boolean(filter && filter.kind === 'category');
    networks = cachedSidebar ? cachedSidebar.networks : type === 'live' ? await listNetworks(db).catch(() => []) : [];
    await loadEpgGenres().catch((err) => log.warn('Guide genres failed', err && err.message));
    // With the guide genres in the sidebar, Networks starts closed (open when a network is what the page opens on).
    if (!back) networksExpanded = !epgGenres.length || Boolean(filter && filter.kind === 'network');
    if (stale) listCategories(db, type).then((found) => { if (!destroyed) { categories = found.filter((c) => !excluded.has(String(c.id))).map((c) => ({ id: c.id, name: c.name })); rebuildSidebar(); } }).catch(() => undefined);
    if (stale && type === 'live') listNetworks(db).then((found) => { if (!destroyed) { networks = found; rebuildSidebar(); } }).catch(() => undefined);
    items = sidebarItems({ type, genres, epgGenres, epgGenresExpanded, categories, pinned: pinnedView(), networks, networksExpanded, expanded, genresExpanded, genresLoading, scheduled: scheduledCount > 0, labels: labels() });
    selected = indexOfFilter(items, filter);
    renderCategories();
    syncFavorite();
    await loadView();
    if (!destroyed && back && back.zone === GRID_ZONE && back.index > 0) await loadUntil(back.index);
    if (destroyed) return;
    // Land in the grid when there is something to browse, otherwise on the sidebar (a section that became empty, like Continue
    // watching after its last title was marked as seen).
    if (back && back.guide) guideState = back.guide;
    if (back && back.zone === CATS_ZONE) ctx.focus.focus(CATS_ZONE, selected);
    else if (items[selected] && isGuideKind(items[selected].kind)) {
      if (guide && guideState) guide.restore(guideState);
      if (!ctx.focus.focus(GUIDE_ZONE, 0)) {
        ctx.focus.focus(CATS_ZONE, selected);
        autoSidebar = true; // no rows yet (guide still downloading): the focus goes to them when they arrive
      }
    } else if (entries.length) ctx.focus.focus(GRID_ZONE, back && back.zone === GRID_ZONE ? Math.min(back.index, entries.length - 1) : 0);
    else {
      ctx.focus.focus(CATS_ZONE, Math.max(0, selected));
      autoSidebar = true;
    }
    if (!wantsGenre && type !== 'live') {
      await loadGenres();
      genresLoading = false;
      if (!destroyed) rebuildSidebar();
    }
    loadUserCounts().catch((err) => log.warn('Sidebar counts failed', err && err.message));
    if (fresh && haveCounts) return;
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
    el: h('section', { class: 'page browse' }, h('div', { class: 'browse-body' }, catList, h('div', { class: 'browse-main' }, head, gridEl, guideHost, empty))),
    /** Back while a row of the guide is selected: the selection goes, the page stays. */
    onBack() {
      if (guide && guide.cancelRowMode()) return true;
      // On another grid (a category, a genre, a network...) Back first goes to the main one, the page is left from there.
      const main = mainIndex();
      if (main < 0 || selected === main || !catNodes.length) return false;
      selectItem(main, ctx.focus.activeId === CATS_ZONE);
      return true;
    },
    mount() {
      ctx.focus.register(catsZone);
      ctx.focus.register(gridZone);
      ctx.focus.register(guideZone);
      ctx.focus.register(headZone);
      ctx.focus.link(HEAD_ZONE, 'up', TOPBAR_ZONE);
      ctx.focus.link(HEAD_ZONE, 'down', GRID_ZONE);
      ctx.focus.link(HEAD_ZONE, 'left', CATS_ZONE);
      ctx.focus.link(CATS_ZONE, 'up', TOPBAR_ZONE);
      ctx.focus.link(CATS_ZONE, 'right', GRID_ZONE);
      ctx.focus.link(GRID_ZONE, 'left', CATS_ZONE);
      ctx.focus.link(GRID_ZONE, 'up', HEAD_ZONE);
      ctx.focus.link(GUIDE_ZONE, 'left', CATS_ZONE);
      if (type === 'live') {
        // A new guide download: the rows (channels with programmes) and their programmes are read again.
        if (ctx.epg && ctx.epg.onUpdated)
          stopGuideUpdates = ctx.epg.onUpdated(() => {
            guideRowsJob = null;
            genreGuideJob = null; // the genre views read their programmes again
            loadEpgGenres()
              .then(() => !destroyed && rebuildSidebar())
              .catch(() => undefined);
            if (guide && (guideKind === 'guide' || String(guideKind).indexOf('epgGenre:') === 0)) guide.reload().then(handOff);
            safe(async () => setCount('guide:', (await guideList()).length));
          });
        // Scheduled programmes added or removed (here or from a channel page): the "scheduled" entry and its view follow.
        if (ctx.schedules)
          stopScheduleUpdates = ctx.schedules.onChange(async () => {
            const n = (await ctx.schedules.list(providerId).catch(() => [])).length;
            if (destroyed) return;
            const had = scheduledCount > 0;
            scheduledCount = n;
            setCount('scheduled:', n);
            const wasScheduled = items[selected] && items[selected].kind === 'scheduled';
            if (had !== n > 0) rebuildSidebar();
            if (wasScheduled && !n) loadView();
            else if (guide && guideKind === 'scheduled') guide.reload();
          });
      }
      ctx.focus.link(GUIDE_ZONE, 'up', HEAD_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', HEAD_ZONE);
      init().catch((err) => log.warn('Browse init failed', err && err.message));
    },
    destroy() {
      destroyed = true;
      if (guide) guide.destroy();
      if (stopGuideUpdates) stopGuideUpdates();
      if (stopScheduleUpdates) stopScheduleUpdates();
      ctx.focus.unregister(GUIDE_ZONE);
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
        epgGenresExpanded,
        zone,
        index: ctx.focus.active && ctx.focus.activeId === zone ? ctx.focus.active.index : 0,
        guide: guide ? guide.state() : null,
      };
    },
    restoreState(state) {
      restored = state;
    },
  };
}
