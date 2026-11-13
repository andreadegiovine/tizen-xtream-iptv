import { continueWatching } from '../../services/continueWatching.js';
import { focusOnBar } from '../rowFocus.js';
import { h } from '../dom.js';
import { createIconButton, setIconButtonLabel } from '../atoms/iconButton.js';
import { createHint } from '../atoms/hint.js';
import { createSidebarItem, createSidebarItemSkeleton } from '../atoms/sidebarItem.js';
import { createCard, createSkeletonCard } from '../components/card.js';
import { derivedVersion, readDerivedAny, writeDerived } from '../../services/derivedStore.js';
import { t, i18n } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel, sidebarModel } from '../focus/models.js';
import { isFilterEntry, filterCardMeta } from '../components/typedRows.js';
import { favoriteFilterEntries, openFilter } from '../../services/favoriteFilters.js';
import { ensureVisible, revealNearest } from '../scroll.js';

/** The page moves because of the pointer (wheel, finger, scrollbar), not because a key moved the focus. */
const scrollHeldByUser = () => typeof document !== 'undefined' && document.body.classList.contains('pointer-mode');
import { listCategories, listNetworks, pageEntries, getEntry, countEntries, LIVE_ALL } from '../../services/catalogQuery.js';
import { readGuideIndex } from '../../services/guideIndex.js';
import { genreKey } from '../../services/epgChannels.js';
import { formatNumber } from '../../core/format.js';
import { log } from '../../core/logger.js';
import { createEpgGuide, floorHalfHour, nextProgramme, PAST_MS, SPAN_MS } from '../components/epgGuide.js';
import { applyGuideLayout, moveInLayout, hideInLayout } from '../../services/guideLayout.js';
import { foldName } from '../../services/shareKeys.js';

const CATS_ZONE = 'browseCategories';
const GRID_ZONE = 'browseGrid';
const GUIDE_ZONE = 'browseGuide';
const HEAD_ZONE = 'browseHead';
import { SIDEBAR_ICON, GENRE_SKELETONS, LIST_KINDS, CACHED_KINDS, columnsFor, PREFETCH_ROWS, DEFAULT_SCREEN_ROWS, BATCH_ROWS, firstKeptRow, wantedCount, createGrowingGridModel, sidebarItems, indexOfFilter, isGuideKind } from './browse/model.js';

export { SIDEBAR_ICON, GENRE_SKELETONS, columnsFor, PREFETCH_ROWS, firstKeptRow, wantedCount, createGrowingGridModel, sidebarItems, indexOfFilter };

export function createBrowsePage(ctx, params = {}) {
  const type = params.type;
  const columns = columnsFor(type);
  const titleEl = h('span', { class: 'browse-title' });
  const count = h('span', { class: 'muted browse-count' });
  const sepA = h('span', { class: 'browse-sep', text: '·' });
  const pinBtn = createIconButton({ icon: 'pin', className: 'browse-fav browse-pin', tag: 'span' });
  const favBtn = createIconButton({ icon: 'heart', className: 'browse-fav', tag: 'span' });
  const head = h('div', { class: 'browse-head sticky-head' }, titleEl, sepA, count, h('span', { class: 'browse-head-actions' }, pinBtn, favBtn));
  let favState = null; // { active, onToggle, pinActive, onPin } while a category / genre is open
  function renderHead() {
    const hasCount = !!count.textContent;
    sepA.style.display = hasCount ? '' : 'none';
    favBtn.style.display = favState ? '' : 'none';
    favBtn.classList.toggle('active', !!(favState && favState.active));
    setIconButtonLabel(favBtn, favState && favState.active ? t('detail.unfavorite') : t('detail.favorite'));
    const canPin = Boolean(favState && favState.onPin);
    pinBtn.style.display = canPin ? '' : 'none';
    pinBtn.classList.toggle('active', canPin && favState.pinActive);
    setIconButtonLabel(pinBtn, canPin && favState.pinActive ? t('browse.unpin') : t('browse.pin'));
    if (!favState) favBtn.classList.remove('focused');
    if (!canPin) pinBtn.classList.remove('focused');
  }
  renderHead();
  const catList = h('div', { class: 'browse-cats' });
  const gridEl = h('div', { class: `browse-grid ${type}` });
  const empty = createHint({ text: t('common.empty'), className: 'browse-empty' });
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
  // Rows far above the screen leave the page (a long walk down a large catalog keeps the page small): the cards before `keptFrom` are
  // out of the DOM, with their pictures freed, and `spacer` (as tall as the rows it stands for, `rowHeights`) keeps the scroll position.
  let keptFrom = 0;
  let spacer = null;
  let rowHeights = [];
  let loadToken = 0;
  const counts = new Map(); // sidebar numbers: 'kind:id' → how many titles
  // Continue watching, favourites, suggestions: out of the sidebar until counted, and while they have nothing (except the one on screen).
  const USER_KINDS = ['continue', 'favorites', 'suggestions'];
  let userHidden = new Set(USER_KINDS); // set again in init(), keeping the entry the page opens on

  const labels = () => ({ guide: t('epg.guide'), scheduled: t('epg.scheduled'), all: t('browse.all'), continue: t('home.continue'), favorites: t('nav.favorites'), suggestions: t('nav.suggestions'), genres: t('detail.genres'), categories: t('detail.categories'), networks: t('networks.title') });

  function renderCategories() {
    while (catList.firstChild) catList.removeChild(catList.firstChild);
    catNodes = items.map((item, i) => {
      // Only entries with an icon get the icon slot: the others start at the left edge.
      const text = countText(item);
      const group = item.kind === 'toggle' || item.kind === 'genresToggle' || item.kind === 'networksToggle' || item.kind === 'epgGenresToggle';
      const node = createSidebarItem({
        name: item.name,
        icon: item.pinned ? 'pin' : SIDEBAR_ICON[item.kind] || null,
        count: text,
        countPending: countPending(item, text),
        current: i === selected,
        sub: Boolean(item.depth),
        trailingIcon: group ? 'chevron' : null,
        open: Boolean(item.expanded),
      });
      catList.appendChild(node);
      // While the genres are being found, grey placeholders hold their place under the "Genres" entry.
      if (item.kind === 'genresToggle' && genresLoading && genresExpanded) {
        for (let n = 0; n < GENRE_SKELETONS; n += 1) {
          catList.appendChild(createSidebarItemSkeleton());
        }
      }
      return node;
    });
    // Drawn again while the focus is in the sidebar (the genres or counts arrived): the focused entry stays marked.
    if (ctx.focus.activeId === CATS_ZONE && catNodes[catsZone.index]) catNodes[catsZone.index].classList.add('focused');
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

  /** The entries with nothing to show leave the sidebar, the ones that have something come back (the one on screen always stays). */
  function syncUserEntries() {
    const next = new Set(
      USER_KINDS.filter((kind) => {
        if (items[selected] && items[selected].kind === kind) return false;
        const n = counts.get(`${kind}:`);
        return n === undefined ? userHidden.has(kind) : n === 0; // not counted yet: as it is (shown when the number last known had some)
      }),
    );
    if (destroyed || (next.size === userHidden.size && Array.from(next).every((k) => userHidden.has(k)))) return;
    userHidden = next;
    rebuildSidebar();
  }

  /** A number that depends on the user: shown, remembered for the next visit (ctx.navCounts) and the entry shown or hidden at once. */
  const setUserCount = (kind, n) => {
    setCount(`${kind}:`, n);
    if (ctx.navCounts) ctx.navCounts.set(providerId, `${type}:${kind}`, n);
    syncUserEntries();
  };

  /**
   * The numbers that depend on the user (continue watching, favourites, suggestions): read every time, never cached, all at the same time;
   * each entry shows (or leaves) as soon as its own number is known. Suggestions are the slow one (TMDB / Trakt): the others never wait for it.
   */
  async function loadUserCounts() {
    const jobs = [];
    if (type === 'live') {
      jobs.push(safe(async () => setCount('guide:', (await guideList()).length)));
      setCount('scheduled:', scheduledCount);
    }
    // Counted on what the views show: titles still in the catalog, favourites this provider has.
    if (type !== 'live') jobs.push(safe(async () => setUserCount('continue', (await byKeys((await continueWatching(ctx, { providerId, limit: 200 })).filter((r) => r.type === type).map((r) => r.entryKey))).length)));
    jobs.push(safe(async () => setUserCount('favorites', await favoriteCount())));
    if (type !== 'live') jobs.push(safe(async () => setUserCount('suggestions', (await suggestionEntries()).length)));
    await Promise.all(jobs);
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
    if (!suggestionsCache || fresh) suggestionsCache = ctx.suggestions.build({ limit: 500 }).then((result) => result.entries.filter((entry) => entry.type === type));
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
    items = sidebarItems({ type, hidden: userHidden, genres, epgGenres, epgGenresExpanded, categories, pinned: pinnedView(), networks, networksExpanded, expanded, genresExpanded, genresLoading, scheduled: scheduledCount > 0, labels: labels() });
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
    resetWindow();
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
        // The number of the Favorites entry, and the entry itself shown or hidden (the first favourite, or the last one taken away);
        // the top bar's Favorites too.
        const n = await favoriteCount();
        if (!destroyed) {
          setUserCount('favorites', n);
          syncFavorite();
        } else if (ctx.navCounts) ctx.navCounts.set(providerId, `${type}:favorites`, n);
        if (ctx.refreshTopbar) ctx.refreshTopbar().catch(() => undefined);
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
    nodes: () => headButtons().map((b) => b.el),
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
    const first = cardNodes[keptFrom];
    const below = cardNodes[keptFrom + columns];
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

  /** Nothing out of the page: the grid was emptied (a new view, the guide). */
  function resetWindow() {
    keptFrom = 0;
    spacer = null;
    rowHeights = [];
  }

  /**
   * The rows more than PREFETCH_ROWS above the screen leave the page with their pictures; the ones near it again come back. Only the rows
   * that cross the line are touched (not every card at every key).
   */
  function syncImages(index) {
    const keepFrom = Math.min(firstKeptRow(index, columns, screenRows()) * columns, Math.floor(cards.length / columns) * columns);
    if (keepFrom === keptFrom) return;
    if (keepFrom > keptFrom) {
      // Rows leave: their height (measured while they are on the page) goes to the spacer.
      if (!spacer) {
        spacer = h('div', { class: 'grid-spacer' });
        gridEl.insertBefore(spacer, gridEl.firstChild);
      }
      let height = 0;
      for (let row = keptFrom / columns; row < keepFrom / columns; row += 1) {
        const top = cardNodes[row * columns];
        const next = cardNodes[(row + 1) * columns];
        rowHeights[row] = top && next ? next.offsetTop - top.offsetTop : rowHeights[row - 1] || 0;
        height += rowHeights[row];
      }
      for (let i = keptFrom; i < keepFrom; i += 1) {
        cards[i].release();
        if (cardNodes[i].parentNode) cardNodes[i].parentNode.removeChild(cardNodes[i]);
      }
      spacer.style.height = `${(parseFloat(spacer.style.height) || 0) + height}px`;
    } else {
      // Rows come back, in their order, before the first row on the page.
      const before = cardNodes[keptFrom] || null;
      let height = 0;
      for (let i = keepFrom; i < keptFrom; i += 1) {
        gridEl.insertBefore(cardNodes[i], before);
        cards[i].restore();
      }
      for (let row = keepFrom / columns; row < keptFrom / columns; row += 1) height += rowHeights[row] || 0;
      spacer.style.height = `${Math.max(0, (parseFloat(spacer.style.height) || 0) - height)}px`;
    }
    keptFrom = keepFrom;
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
      resetWindow();
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
  let scheduledKeys = new Set(); // `${channelId}|${start}` of the scheduled programmes: marked in the guide
  const scheduledKey = (channelId, start) => `${channelId}|${start}`;
  function keepScheduled(list) {
    scheduledCount = list.length;
    scheduledKeys = new Set(list.map((s) => scheduledKey(s.channelId, s.start)));
  }

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
    // Counted like the genre view: rows with a programme of the category in the hours the guide shows.
    const from = floorHalfHour(Date.now()) - PAST_MS;
    const found = await ctx.epg.genreRows({ from, to: from + PAST_MS + SPAN_MS });
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
      isScheduled: (entry, programme) => scheduledKeys.has(scheduledKey(entry.epgChannelId, programme.start)),
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
    resetWindow();
    gridEl.style.display = 'none';
    empty.style.display = 'none';
    titleEl.textContent = items[selected] ? items[selected].name : '';
    count.textContent = '';
    renderHead();
    guideHost.style.display = '';
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
    ctx.focus.link(HEAD_ZONE, 'down', GRID_ZONE);
  }

  const guideZone = new FocusZone({
    id: GUIDE_ZONE,
    locate: (target) => (guide && guideHost.style.display !== 'none' ? guide.pointAt(target) : null),
    model: {
      getCount: () => (guide && guideHost.style.display !== 'none' ? guide.model.getCount() : 0),
      navigate: (dir, index) => guide.model.navigate(dir, index),
    },
    onFocus: () => guide && guide.onFocus(),
    onBlur: () => guide && guide.onBlur(),
    onActivate: () => guide && guide.activate(),
    onLongActivate: () => guide && guide.longActivate(),
  });

  /** The focus into what is on screen: the guide, or the grid where it was (nothing when empty). */
  function enterContent() {
    if (guideHost.style.display !== 'none') return Boolean(guide && guide.count) && ctx.focus.focus(GUIDE_ZONE);
    return entries.length > 0 && ctx.focus.focus(GRID_ZONE, Math.min(gridZone.index, entries.length - 1));
  }

  const catsZone = new FocusZone({
    id: CATS_ZONE,
    nodes: () => catNodes,
    // Right: the focus into the grid (or guide) on screen, whatever sidebar entry has the focus (nothing is opened: OK does that).
    model: sidebarModel({ getCount: () => items.length, enter: () => enterContent() }),
    onFocus: (i) => {
      if (i !== selected) autoSidebar = false; // the user moved in the sidebar: the focus is theirs
      if (!catNodes[i]) return;
      catNodes[i].classList.add('focused');
      revealNearest(catNodes[i]);
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
      // OK on the entry already on screen: into its grid (or guide) as it is, without reading it again.
      if (i === selected) {
        if (isGuideKind(item.kind) && guide && guide.count && ctx.focus.focus(GUIDE_ZONE, 0)) return;
        if (!isGuideKind(item.kind) && entries.length && ctx.focus.focus(GRID_ZONE, Math.min(gridZone.index, entries.length - 1))) return;
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
  const mainIndex = () => {
    const at = items.findIndex((item) => item.kind === (type === 'live' ? 'guide' : 'all'));
    return at >= 0 ? at : items.findIndex((item) => item.kind === 'all'); // no guide: "show all"
  };

  const gridZone = new FocusZone({
    id: GRID_ZONE,
    nodes: () => cardNodes,
    model: createGrowingGridModel({
      columns,
      getCount: () => entries.length,
      hasMore: () => hasMore,
      more: () => loadMore(columns * BATCH_ROWS),
    }),
    onFocus: (i) => {
      if (!cardNodes[i]) return;
      syncImages(i); // first: a far jump (back to a title, the top) brings its rows into the page before scrolling to it
      cardNodes[i].classList.add('focused');
      ensureVisible(cardNodes[i], { first: i < columns });
      ensureLoaded(i);
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
    if (type === 'live' && ctx.schedules) keepScheduled(await ctx.schedules.list(providerId).catch(() => []));
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
    userHidden = new Set(USER_KINDS.filter((kind) => !(filter && filter.kind === kind)));
    // The entries that had something last time are there at once, with that number (corrected when it is read again).
    USER_KINDS.forEach((kind) => {
      const known = ctx.navCounts ? ctx.navCounts.get(providerId, `${type}:${kind}`) : undefined;
      if (!known) return;
      userHidden.delete(kind);
      counts.set(`${kind}:`, known);
    });
    // Live TV: the guide entry only when the guide has rows (read before the sidebar is drawn: the page opens on it when it is there).
    if (type === 'live' && !(await guideList().catch(() => [])).length) userHidden.add('guide');
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
    items = sidebarItems({ type, hidden: userHidden, genres, epgGenres, epgGenresExpanded, categories, pinned: pinnedView(), networks, networksExpanded, expanded, genresExpanded, genresLoading, scheduled: scheduledCount > 0, labels: labels() });
    selected = indexOfFilter(items, filter);
    renderCategories();
    syncFavorite();
    // The user's numbers next to the grid (not after it and the genres): the entries they show or hide come in at once.
    loadUserCounts().catch((err) => log.warn('Sidebar counts failed', err && err.message));
    await loadView();
    if (!destroyed && back && back.zone === GRID_ZONE && back.index > 0) await loadUntil(back.index);
    if (destroyed) return;
    // Land in the grid when there is something to browse, otherwise on the sidebar (a section that became empty, like Continue
    // watching after its last title was marked as seen).
    if (back && back.guide) guideState = back.guide;
    // Opened from the top bar: the focus goes to the sidebar (its entry of the page), the user then enters the grid or the guide.
    const fromBar = !back && Boolean(params.fromBar);
    if (back && back.onBar) {
      // Left from the bar (the search closed): the bar keeps the focus.
    } else if (fromBar) {
      if (items[selected] && isGuideKind(items[selected].kind) && guide && guideState) guide.restore(guideState);
      ctx.focus.focus(CATS_ZONE, Math.max(0, selected));
    } else if (back && back.zone === CATS_ZONE) ctx.focus.focus(CATS_ZONE, selected);
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
    if (destroyed || (fresh && haveCounts)) return; // (the user's numbers go on by themselves: the slow suggestions never hold these back)
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

  const pageEl = h('section', { class: 'page browse' }, h('div', { class: 'browse-body' }, catList, h('div', { class: 'browse-main' }, head, gridEl, guideHost, empty)));
  // The grid scrolled with the wheel or a finger: the next cards are read and the rows far above leave, as when the focus walks down
  // (the last row on screen stands for the focus).
  let scrollFrame = null;
  pageEl.addEventListener('scroll', () => {
    if (scrollFrame !== null || !scrollHeldByUser()) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      if (destroyed || gridEl.style.display === 'none' || !cardNodes.length) return;
      const bottom = pageEl.getBoundingClientRect().bottom;
      let last = keptFrom;
      for (let i = keptFrom; i < cardNodes.length; i += columns) {
        if (cardNodes[i].getBoundingClientRect().top >= bottom) break;
        last = i;
      }
      ensureLoaded(last);
      syncImages(last);
    });
  });

  return {
    /** The bar's entry of this page pressed again: the focus comes to the sidebar (its entry of the page), nothing is loaded again. */
    takeFocusFromBar() {
      return items.length > 0 && ctx.focus.focus(CATS_ZONE, Math.max(0, selected));
    },
    el: pageEl,
    /** Back: a selected row of the guide lets go; from the grid / guide the focus goes to the sidebar; then the main entry; then the page is left. */
    onBack() {
      if (guide && guide.cancelRowMode()) return true;
      // From the grid, the guide or the head: Back goes to the sidebar first (on the page's entry), the page is left from there.
      const inPage = ctx.focus.activeId === GRID_ZONE || ctx.focus.activeId === GUIDE_ZONE || ctx.focus.activeId === HEAD_ZONE;
      if (inPage && catNodes.length) {
        ctx.focus.focus(CATS_ZONE, Math.max(0, selected));
        return true;
      }
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
      // Each zone keeps the focus: the sidebar Up / Down (OK opens its grid), the grid between its cards (Up from the first row: the
      // buttons of its head), the top bar only with Back (grid → sidebar → bar).
      ctx.focus.link(HEAD_ZONE, 'down', GRID_ZONE);
      ctx.focus.link(GRID_ZONE, 'up', HEAD_ZONE);
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
            safe(async () => {
              const rows = (await guideList()).length;
              setCount('guide:', rows);
              // A guide that arrives (or empties) while the page is open: its entry appears (or goes).
              if (destroyed || (rows > 0) !== userHidden.has('guide')) return;
              if (rows > 0) userHidden.delete('guide');
              else if (!(items[selected] && items[selected].kind === 'guide')) userHidden.add('guide');
              rebuildSidebar();
            });
          });
        // Scheduled programmes added or removed (here or from a channel page): the "scheduled" entry and its view follow.
        if (ctx.schedules)
          stopScheduleUpdates = ctx.schedules.onChange(async () => {
            const list = await ctx.schedules.list(providerId).catch(() => []);
            if (destroyed) return;
            const n = list.length;
            const had = scheduledCount > 0;
            keepScheduled(list);
            if (guide) guide.repaintScheduled();
            setCount('scheduled:', n);
            const wasScheduled = items[selected] && items[selected].kind === 'scheduled';
            if (had !== n > 0) rebuildSidebar();
            if (wasScheduled && !n) loadView();
            else if (guide && guideKind === 'scheduled') guide.reload();
          });
      }
      ctx.focus.link(GUIDE_ZONE, 'up', HEAD_ZONE);
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
        onBar: focusOnBar(ctx.focus),
        guide: guide ? guide.state() : null,
      };
    },
    restoreState(state) {
      restored = state;
    },
  };
}
