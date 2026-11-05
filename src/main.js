import './styles/main.scss';
import { i18n, t, detectLocale } from './i18n/index.js';
import { openAppDb } from './db/appDb.js';
import { InputService, Action } from './core/input.js';
import { exitApp } from './core/env.js';
import { log } from './core/logger.js';
import { FocusManager } from './ui/focus/FocusManager.js';
import { Router } from './ui/router.js';
import { createTopbar, TOPBAR_ZONE, sectionForEntry, isSearchable } from './ui/components/topbar.js';
import { createDialogService } from './ui/components/dialog.js';
import { createNoticeService } from './ui/components/notice.js';
import { setAdultCheck } from './ui/components/card.js';
import { createParentalService } from './services/parental.js';
import { unlockAdult, createPin } from './ui/components/pinFlows.js';
import { subscriptionStatus } from './services/subscription.js';
import { formatDate } from './core/format.js';
import { createBackHandler } from './ui/backHandler.js';
import { ProviderStore } from './services/providerStore.js';
import { SettingsService } from './services/settings.js';
import { createLiveGroupingService } from './services/liveGrouping.js';
import { createComingSoonPage } from './ui/pages/simplePages.js';
import { createHomePage } from './ui/pages/homePage.js';
import { CatalogSyncService } from './services/catalogSyncService.js';
import { createCatalogWorker } from './services/createCatalogWorker.js';
import { createEpgService } from './services/epgService.js';
import { createEpgWorker } from './services/createEpgWorker.js';
import { createTmdbClient } from './services/tmdbClient.js';
import { createApiKeys } from './services/apiKeys.js';
import { createTmdbService } from './services/tmdbService.js';
import { createActiveProvider } from './services/activeProvider.js';
import { watchConnectivity } from './core/connectivity.js';
import { createPageCache } from './services/pageCache.js';
import { createSearchHistory } from './services/searchHistory.js';
import { createSearchWorker } from './services/createSearchWorker.js';
import { createSearchService } from './services/searchIndex.js';
import { createDetailsService } from './services/details.js';
import { WatchStore, watchKey } from './services/watchStore.js';
import { summarizeWatch, watchStatus } from './services/watchStatus.js';
import { createDefaultEngine } from './services/playerEngines.js';
import { createYouTubeEngine } from './services/youtubeEngine.js';
import { createSyncLog } from './services/syncLog.js';
import { createOperations } from './services/operations.js';
import { countEntries } from './services/catalogQuery.js';
import { createGenreIndex } from './services/genreIndex.js';
import { createGenreWorker } from './services/createGenreWorker.js';
import { createSuggestionsService } from './services/suggestions.js';
import { createSuggestionsPage } from './ui/pages/suggestionsPage.js';
import { createFavoritesPage } from './ui/pages/favoritesPage.js';
import { createFavoritesService } from './services/favorites.js';
import { createCollectionsService } from './services/collections.js';
import { createCollectionsPage } from './ui/pages/collectionsPage.js';
import { createCollectionPage } from './ui/pages/collectionPage.js';
import { createNetworkPage } from './ui/pages/networkPage.js';
import { createPinsService } from './services/pins.js';
import { createSearchPage } from './ui/pages/searchPage.js';
import { createDetailPage } from './ui/pages/detailPage.js';
import { createPlayerPage } from './ui/pages/playerPage.js';
import { createBrowsePage } from './ui/pages/browsePage.js';
import { createProvidersPage } from './ui/pages/providersPage.js';
import { createProviderSetupPage } from './ui/pages/providerSetupPage.js';
import { createCategoriesPage } from './ui/pages/categoriesPage.js';
import { createTraktClient } from './services/traktClient.js';
import { createTraktService, createWatchState } from './services/traktService.js';
import { createScreensaver } from './ui/screensaver.js';
import { applyTextSize } from './core/textSize.js';
import { createSettingsPage } from './ui/pages/settingsPage.js';
import { createDiagnosticsPage } from './ui/pages/diagnosticsPage.js';

// Last line of defence: log (credentials are masked by the logger) instead of dying silently.
window.addEventListener('unhandledrejection', (event) => log.error('Unhandled rejection', event.reason && event.reason.message));
window.addEventListener('error', (event) => log.error('Uncaught error', event.message));

const SEARCH_WARM_MS = 1500;

async function boot() {
  const db = await openAppDb();
  const settings = new SettingsService(db);
  const providers = new ProviderStore(db);

  const prefs = await settings.get();
  applyTextSize(prefs.textSize);
  i18n.setLocale(prefs.language === 'auto' ? detectLocale(navigator.language) : prefs.language);

  const focus = new FocusManager();
  const liveGrouping = createLiveGroupingService({ db, settings });
  const catalog = new CatalogSyncService({ providers, settings, createWorker: createCatalogWorker, getCleanTitles: () => Boolean(ctx.apiKeys && ctx.apiKeys.get().tmdbKey), getGrouping: (providerId) => liveGrouping.config(providerId) });
  const active = createActiveProvider({ providers });
  const ctx = {
    db,
    settings,
    providers,
    liveGrouping,
    catalog,
    focus,
    router: null,
    active,
    watch: null,
    trakt: null,
    details: createDetailsService({ active }),
    search: createSearchService({ active, createWorker: createSearchWorker }),
    createEngine: createDefaultEngine,
    createTrailerEngine: createYouTubeEngine,
    openEntry: null,
    enrich: null,
    meta: null,
  };
  ctx.favorites = createFavoritesService({ db });
  ctx.collections = createCollectionsService({ db });
  ctx.pins = createPinsService({ db });
  ctx.searchHistory = createSearchHistory({ db });
  ctx.pageCache = createPageCache();
  // Everything read from the catalog is out of date (a rebuild, a sync, hidden categories): caches emptied, the search index rebuilt.
  ctx.catalogChanged = () => {
    ctx.pageCache.clear();
    ctx.search.invalidate();
    ctx.search.warm().catch(() => undefined);
  };
  ctx.parental = createParentalService({ db });
  setAdultCheck((entry) => ctx.parental.isAdult(entry));
  ctx.refreshAdult = async () => {
    const current = await active.get();
    if (current) await ctx.parental.loadCategories(current.db).catch((err) => log.warn('Adult categories failed', err && err.message));
  };
  ctx.apiKeys = createApiKeys({ db });
  const keysReady = ctx.apiKeys.load(); // read while the rest of the start-up is set up; awaited before the first page
  keysReady.catch(() => undefined);
  ctx.trakt = createTraktService({ db, client: createTraktClient({ getCredentials: () => ({ clientId: ctx.apiKeys.get().traktId, clientSecret: ctx.apiKeys.get().traktSecret }) }) });
  ctx.watch = createWatchState({ store: new WatchStore(db), trakt: ctx.trakt });
  const tmdb = createTmdbService({ db, client: createTmdbClient({ getApiKey: () => ctx.apiKeys.get().tmdbKey }), getLanguage: () => i18n.getLocale(), onActivity: (count) => ctx.genres && ctx.genres.hold('ui', count > 0) });
  ctx.tmdb = tmdb;
  ctx.operations = createOperations();
  ctx.syncLog = createSyncLog({ db, operations: ctx.operations });
  ctx.genres = createGenreIndex({
    active,
    syncLog: ctx.syncLog,
    getTmdbKey: () => ctx.apiKeys.get().tmdbKey,
    getLanguage: () => i18n.getLocale(),
    createWorker: createGenreWorker,
    isBusy: () => Boolean(catalog.getState().running || (router.current && router.current.name === 'player')),
  });
  ctx.suggestions = createSuggestionsService({ active, watch: ctx.watch, tmdb, trakt: ctx.trakt, getSource: async () => (await settings.get()).suggestionSource });
  ctx.meta = { forEntry: (entry) => tmdb.forEntry(entry) };
  const epg = createEpgService({ active, providers, createWorker: createEpgWorker, operations: ctx.operations });
  ctx.epg = epg;
  // Favourite categories and genres show how many titles they hold; a grey sweep stands in until it is known.
  const filterTotals = (type) => (filterTotals.cache[type] = filterTotals.cache[type] || ctx.genres.counts(type).catch(() => new Map()));
  filterTotals.cache = {};
  const fillFilterCounts = (entries, cards) => {
    entries.forEach((entry, i) => {
      if (!entry.filterKind || !cards[i]) return;
      cards[i].update({ countLoading: true });
      const job = entry.filterKind === 'genre'
        ? filterTotals(entry.type).then((map) => map.get(String(entry.filterId)) || 0)
        : active.get().then((current) => (current ? countEntries(current.db, { type: entry.type, categoryId: entry.filterId }) : 0));
      job.then((n) => cards[i].update({ count: n })).catch(() => cards[i].update({ count: null }));
    });
    filterTotals.cache = {}; // fresh numbers at the next page
  };
  ctx.enrich = (entries, cards, type, keepQueue = false) => {
    fillFilterCounts(entries, cards);
    const totals = new Map();
    let summaries = null;
    const paint = (i) => {
      if (!summaries || !cards[i]) return;
      const entry = entries[i];
      const providerId = summaries.providerId;
      cards[i].update({ status: watchStatus(type, summaries.map.get(watchKey(providerId, entry.key)), totals.get(entry.key)) });
    };
    tmdb.enrich(entries, cards, type, (entry, i, meta) => {
      if (meta.episodes) totals.set(entry.key, meta.episodes);
      paint(i);
    }, keepQueue);
    if (type === 'live') epg.decorate(entries, cards);
    else {
      Promise.all([active.get(), ctx.watch.all()])
        .then(([current, records]) => {
          if (!current) return;
          summaries = { providerId: current.provider.id, map: summarizeWatch(records) };
          entries.forEach((entry, i) => paint(i));
        })
        .catch(() => undefined);
    }
  };
  let gateOpen = false; // one PIN dialog at a time (a second OK press must not stack another)
  ctx.openEntry = async (entry, extra = {}) => {
    if (entry.isNetwork) {
      ctx.router.push('network', { key: entry.key, section: extra.section || 'live' }); // a network has its own page
      return;
    }
    if (ctx.parental.isAdult(entry)) {
      if (gateOpen) return;
      gateOpen = true;
      try {
        if (!(await unlockAdult({ dialogs: ctx.dialogs, parental: ctx.parental, notices: ctx.notices }))) return;
      } finally {
        gateOpen = false;
      }
    }
    ctx.router.push('detail', { entryKey: entry.key, type: entry.type, ...extra });
  };

  const topbar = createTopbar(ctx, {
    onOpen: () => {
      // The search icon shows the search page at once, with the last searches.
      if (!(router.current && router.current.name === 'search')) router.push('search', { query: '', section: 'search' });
    },
    onCleared: () => {
      if (router.current && router.current.name === 'search' && router.page && router.page.showRecent) router.page.showRecent();
    },
    onTyping: () => {
      // First keystroke: open the results page right away, with placeholders instead of an empty screen.
      if (router.current && router.current.name === 'search') {
        if (router.page && router.page.showSkeleton) router.page.showSkeleton();
      } else {
        router.push('search', { query: '', section: 'search' });
        if (router.page && router.page.showSkeleton) router.page.showSkeleton();
      }
    },
    onQuery: (text) => {
      if (router.current && router.current.name === 'search') {
        if (router.page && router.page.setQuery) router.page.setQuery(isSearchable(text) ? text : '');
      } else if (isSearchable(text)) {
        router.push('search', { query: text, section: 'search' });
      }
    },
    onSubmit: () => {
      // Enter / Done: the search counts as made, it goes in the recent ones.
      if (router.page && router.page.getQuery && ctx.searchHistory) ctx.searchHistory.add(router.page.getQuery()).catch(() => undefined);
      if (router.page && router.page.focusResults) router.page.focusResults();
    },
    onClose: () => {
      if (router.current && router.current.name === 'search') {
        if (!router.back()) router.reset('home', { section: 'home' });
      } else focus.focus(TOPBAR_ZONE, topbar.indexOfSection('search'));
    },
  });
  document.getElementById('topbar').appendChild(topbar.el);
  ctx.syncSearchLinks = () => topbar.syncSearchLinks();
  ctx.setSearchText = (text) => topbar.setQuery(text);
  ctx.refreshClock = () => topbar.refreshClock();
  ctx.screensaver = createScreensaver({ idleMs: prefs.screensaver * 60 * 1000 });

  const router = new Router({
    container: document.getElementById('content'),
    routes: {
      home: () => createHomePage(ctx),
      comingSoon: (params) => createComingSoonPage(ctx, params),
      search: (params) => createSearchPage(ctx, params),
      suggestions: () => createSuggestionsPage(ctx),
      favorites: () => createFavoritesPage(ctx),
      collections: (params) => createCollectionsPage(ctx, params),
      collection: (params) => createCollectionPage(ctx, params),
      network: (params) => createNetworkPage(ctx, params),
      detail: (params) => createDetailPage(ctx, params),
      player: (params) => createPlayerPage(ctx, params),
      browse: (params) => createBrowsePage(ctx, params),
      providers: (params) => createProvidersPage(ctx, params),
      providerSetup: (params) => createProviderSetupPage(ctx, params),
      settings: () => createSettingsPage(ctx),
      categories: () => createCategoriesPage(ctx),
      diagnostics: () => createDiagnosticsPage(ctx),
    },
    onChange: (entry, page) => {
      const section = sectionForEntry(entry);
      // The search bar belongs to the results page: leaving it closes the bar, coming back reopens it.
      if (entry.name === 'search' && !topbar.isSearching()) topbar.openSearch({ query: (page && page.getQuery && page.getQuery()) || '', silent: true });
      else if (entry.name !== 'search' && topbar.isSearching()) topbar.closeSearch({ notify: false });
      topbar.syncSearchLinks();
      topbar.setSkeleton(entry.name === 'providerSetup' && Boolean(entry.params.firstRun));
      topbar.setVisible(entry.name !== 'player');
      if (ctx.notices) ctx.notices.setPlayback(entry.name === 'player');
      if (ctx.screensaver) ctx.screensaver.setSuspended(entry.name === 'player'); // never over a video
      topbar.setCurrentSection(section);
      // Pages with their own zone take focus in mount(). When the user switched section from the bar,
      // or the page has no zone, the focus stays on (or returns to) the bar, on the current section.
      if (entry.params.focusTopbar || !focus.active) focus.focus(TOPBAR_ZONE, topbar.indexOfSection(section));
    },
  });
  ctx.router = router;

  let wasSyncing = false;
  let endCatalogOp = () => undefined;
  catalog.onChange((state) => {
    if (state.running && !wasSyncing) endCatalogOp = ctx.operations.start('catalog', { startedAt: state.startedAt, cancel: () => catalog.cancel() });
    if (!state.running) endCatalogOp();
    if (wasSyncing && !state.running && !state.cancelled) {
      ctx.catalogChanged(); // caches emptied and the new search index ready before the next search
      ctx.refreshAdult();
      ctx.genres.backfill().catch(() => undefined); // the genre worker finds genres the lists did not carry
      // The guide only matters once the channel list is in place; at most once a day.
      if (!state.error) epg.maybeSync().catch(() => undefined);
    }
    wasSyncing = state.running;
  });

  // The page cache is bypassed while the catalog is being changed (sync, genre or TMDB downloads) and emptied when the job ends.
  const CATALOG_JOBS = new Set(['catalog', 'genres', 'tmdb']);
  let cacheBusy = false;
  const refreshCacheState = () => {
    const busy = Boolean(catalog.getState().running) || ctx.operations.list().some((op) => CATALOG_JOBS.has(op.id));
    if (busy === cacheBusy) return;
    cacheBusy = busy;
    ctx.pageCache.suspend(busy);
    if (!busy) ctx.pageCache.clear();
  };
  catalog.onChange(refreshCacheState);
  ctx.operations.onChange(refreshCacheState);

  i18n.onChange(() => {
    ctx.pageCache.clear(); // titles and genres change with the language
    topbar.render();
    router.reload();
    ctx.genres.backfill().catch(() => undefined); // metadata and genres in the new language
  });

  const dialogs = createDialogService({ focus });
  ctx.dialogs = dialogs;
  const notices = createNoticeService();
  ctx.notices = notices;
  // Offline: a notice that stays until the connection is back (it is also shown over a video: playback needs the network).
  let offlineNotice = null;
  watchConnectivity({
    onChange: (online) => {
      if (!online) {
        offlineNotice = notices.show({ type: 'warning', message: t('notice.offline'), permanent: true, key: 'offline', scope: 'playback' });
      } else if (offlineNotice !== null) {
        notices.close(offlineNotice);
        offlineNotice = null;
        notices.success(t('notice.online'), { key: 'online', scope: 'playback' });
      }
    },
  });
  // Operations tell when they start and finish (the Trakt sync reports its own result).
  ctx.operations.onEvent(({ kind, id }) => {
    if (id === 'trakt' && kind === 'end') return;
    const name = t(`operations.${id}`);
    if (kind === 'start') notices.info(t('notice.opStart', { name }), { key: `op:${id}` });
    else if (kind === 'end') notices.success(t('notice.opEnd', { name }), { key: `op:${id}` });
    else notices.warning(t('notice.opCancel', { name }), { key: `op:${id}` });
  });
  const onBack = createBackHandler({
    dialogs: {
      isOpen: () => dialogs.isOpen() || topbar.isSearching(),
      dismiss: () => (dialogs.isOpen() ? dialogs.dismiss() : topbar.closeSearch()),
      confirm: (options) => dialogs.confirm(options),
    },
    router,
    getSection: sectionForEntry,
    goHome: () => router.reset('home', { section: 'home', focusTopbar: true }),
    requestExit: exitApp,
    texts: () => ({
      title: t('exit.title'),
      message: t('exit.message'),
      confirmLabel: t('exit.confirm'),
      cancelLabel: t('exit.cancel'),
    }),
  });

  const input = new InputService(document);
  input.registerTizenKeys();
  input.onAction((action) => {
    if (action === Action.BACK) {
      if (router.page && router.page.onBack && router.page.onBack()) return;
      onBack();
      return;
    }
    // A page may own some keys (the player owns every key except Back).
    if (router.page && router.page.onAction && router.page.onAction(action)) return;
    focus.handle(action);
  });
  input.start();

  log.info('Xtream IPTV started');
  ctx.trakt.flush().catch(() => undefined); // history that could not be sent last time
  const [hasProvider] = await Promise.all([providers.getActive(), keysReady]);
  if (hasProvider) await ctx.refreshAdult();
  if (hasProvider) {
    router.reset('home', { section: 'home' });
    showSubscriptionNotice(notices, hasProvider);
    // Stale-while-revalidate: the cached catalog is usable at once, lists older than 12 h refresh in background.
    catalog.start();
    ctx.genres.backfill().catch(() => undefined);
    // The search index is built in its worker once the first screen is up, so the first search finds it ready.
    setTimeout(() => ctx.search.warm().catch(() => undefined), SEARCH_WARM_MS);
  } else {
    router.reset('providerSetup', { firstRun: true });
  }
  // The parental PIN is set the first time the app opens (asked again at the next start if it was skipped).
  setTimeout(() => {
    ctx.parental
      .hasPin()
      .then((has) => (has ? null : createPin({ dialogs: ctx.dialogs, parental: ctx.parental })))
      .catch((err) => log.warn('PIN setup failed', err && err.message));
  }, 800);
}

/** At every start: a warning when the subscription ends in less than 10 days (an error when it has ended). */
function showSubscriptionNotice(notices, provider) {
  const status = subscriptionStatus(provider);
  if (!status) return;
  const date = formatDate(status.until, i18n.getLocale());
  let key = 'notice.subscriptionLeft';
  if (status.expired) key = 'notice.subscriptionExpired';
  else if (status.days === 0) key = 'notice.subscriptionToday';
  else if (status.days === 1) key = 'notice.subscriptionOne';
  notices.show({ type: status.type, title: provider.name, message: t(key, { days: status.days, date }), permanent: true, key: 'subscription' });
}

boot().catch((err) => {
  log.error('Fatal startup error', err);
  document.getElementById('content').textContent = 'Startup failed. Please restart the app.';
});
