import './styles/main.scss';
import { i18n, t, detectLocale } from './i18n/index.js';
import { openAppDb } from './db/appDb.js';
import { InputService, Action, isTextEditing } from './core/input.js';
import { createPointer } from './ui/pointer.js';
import { log } from './core/logger.js';
import { providerHiddenSections } from './services/providerTypes.js';
import { visibleFavorites } from './services/favoriteEntries.js';
import { checkForUpdate, installUpdate, forgetUpdate, runningVersions } from './services/updates.js';
import { APP_VERSION, IS_DEV } from './core/env.js';
import { FocusManager } from './ui/focus/FocusManager.js';
import { Router } from './ui/router.js';
import { createBackgroundQueue, Priority } from './services/backgroundQueue.js';
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
import { startRebuild } from './services/catalogRebuild.js';
import { createJobQueue } from './services/jobQueue.js';
import { createScheduledViewing } from './services/scheduledViewing.js';
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
import { platform } from './platform/index.js';
import { createSyncLog } from './services/syncLog.js';
import { createOperations } from './services/operations.js';
import { countEntries, getEntry } from './services/catalogQuery.js';
import { continueWatching } from './services/continueWatching.js';
import { isEmptySeries, markUnavailable } from './services/unavailable.js';
import { createGenreIndex } from './services/genreIndex.js';
import { createGenreWorker } from './services/createGenreWorker.js';
import { createSuggestionsService } from './services/suggestions.js';
import { createSuggestionsPage } from './ui/pages/suggestionsPage.js';
import { createFavoritesPage } from './ui/pages/favoritesPage.js';
import { createFavoritesService } from './services/favorites.js';
import { createCollectionsService } from './services/collections.js';
import { createNavCounts } from './services/navCounts.js';
import { createCollectionsPage } from './ui/pages/collectionsPage.js';
import { createCollectionPage } from './ui/pages/collectionPage.js';
import { createNetworkPage } from './ui/pages/networkPage.js';
import { createPinsService } from './services/pins.js';
import { createCreditsStore } from './services/creditsStore.js';
import { createGuideLayoutStore } from './services/guideLayout.js';
import { portableKeyFor } from './services/shareKeys.js';
import { createSearchPage } from './ui/pages/searchPage.js';
import { createBrowsePage } from './ui/pages/browsePage.js';
import { createProvidersPage } from './ui/pages/providersPage.js';
import { createProviderSetupPage } from './ui/pages/providerSetupPage.js';
import { createCategoriesPage } from './ui/pages/categoriesPage.js';
import { createTraktClient } from './services/traktClient.js';
import { createOpenSubtitles } from './services/openSubtitles.js';
import { createTraktService, createWatchState } from './services/traktService.js';
import { createScreensaver } from './ui/screensaver.js';
import { createLazyPage, preloadPages } from './ui/lazyPage.js';

// Pages read the first time they open (and in the idle time after the start): the start reads and compiles less code.
const LAZY_PAGES = {
  detail: () => import(/* webpackChunkName: "page-detail" */ './ui/pages/detailPage.js').then((m) => m.createDetailPage),
  player: () => import(/* webpackChunkName: "page-player" */ './ui/pages/playerPage.js').then((m) => m.createPlayerPage),
  settings: () => import(/* webpackChunkName: "page-settings" */ './ui/pages/settingsPage.js').then((m) => m.createSettingsPage),
  diagnostics: () => import(/* webpackChunkName: "page-diagnostics" */ './ui/pages/diagnosticsPage.js').then((m) => m.createDiagnosticsPage),
};
import { applyTextSize } from './core/textSize.js';

// Last line of defence: log (credentials are masked by the logger) instead of dying silently.
window.addEventListener('unhandledrejection', (event) => log.error('Unhandled rejection', event.reason && event.reason.message));
window.addEventListener('error', (event) => log.error('Uncaught error', event.message));


/**
 * Checks version.json in the background, once the app is up (the start never waits for the network). A newer build this package can run
 * is downloaded and used from the next start (the loader in index.html picks it), and `askRestart(version)` offers to restart now;
 * a newer version that needs a new package: a notice.
 */
async function updateInBackground(notices, askRestart) {
  const versions = runningVersions();
  log.info(`App ${versions.bundle || APP_VERSION} (package ${versions.shell || APP_VERSION})`);
  // Only the "_autoupdate" packages (Tizen, webOS) update themselves, each from the online build of the same variant.
  if (IS_DEV || !versions.shell || typeof __AUTOUPDATE__ === 'undefined' || !__AUTOUPDATE__) return;
  let update = null;
  try {
    update = await checkForUpdate({ platform: __UPDATE_CHANNEL__, running: versions.bundle || APP_VERSION, shell: versions.shell, timeoutMs: 20000 });
  } catch (err) {
    log.warn('Update check failed', err && err.message);
    return;
  }
  if (!update) return;
  if (update.needsPackage) {
    log.info(`Version ${update.version} needs a new package`);
    notices.show({ type: 'info', message: t('update.needsPackage', { version: update.version }), permanent: true, key: 'update' });
    return;
  }
  try {
    await installUpdate(update);
    log.info(`Update ${update.version} downloaded: used from the next start`);
  } catch (err) {
    log.warn('Update failed', err && err.message);
    return;
  }
  if (askRestart) await askRestart(update.version);
  else notices.show({ type: 'info', message: t('update.ready', { version: update.version }), key: 'update' });
}

/**
 * The dialog of a downloaded update: "Restart now" reloads the app (the loader starts the new build), "Stay" keeps this one until the next
 * start (with the usual notice). It waits until no other dialog or search is open (one dialog at a time).
 */
function restartDialog({ dialogs, isBusy, notices }) {
  return async (version) => {
    while (isBusy()) await new Promise((resolve) => setTimeout(resolve, 2000));
    const now = await dialogs.confirm({
      title: t('update.dialogTitle'),
      message: t('update.dialogMessage', { version }),
      confirmLabel: t('update.restartNow'),
      cancelLabel: t('update.stay'),
    });
    if (now) window.location.reload();
    else notices.show({ type: 'info', message: t('update.ready', { version }), key: 'update' });
  };
}

async function boot() {
  const db = await openAppDb();
  const settings = new SettingsService(db);
  const providers = new ProviderStore(db);

  const prefs = await settings.get();
  applyTextSize(prefs.textSize);
  i18n.setLocale(prefs.language === 'auto' ? detectLocale(navigator.language) : prefs.language);
  document.documentElement.lang = i18n.getLocale(); // the page says which language it speaks (voices, hyphenation)
  const notices = createNoticeService();

  const focus = new FocusManager();
  const liveGrouping = createLiveGroupingService({ db, settings });
  const catalog = new CatalogSyncService({ providers, settings, createWorker: createCatalogWorker, getCleanTitles: async () => (await settings.get()).cleanTitles, getGrouping: (providerId) => liveGrouping.config(providerId) });
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
    createEngine: () => platform.createEngine(),
    createTrailerEngine: () => (platform.createTrailerEngine ? platform.createTrailerEngine() : null),
    // Trailers: in the app's player (Tizen) or opened outside it (webOS: the YouTube app); none when the platform has neither.
    trailers: {
      inApp: Boolean(platform.createTrailerEngine),
      available: Boolean(platform.createTrailerEngine || platform.openTrailer),
      open: (videoId) => (platform.openTrailer ? platform.openTrailer(videoId) : false),
    },
    openEntry: null,
    enrich: null,
    meta: null,
  };
  ctx.favorites = createFavoritesService({ db });
  ctx.collections = createCollectionsService({ db });
  // The last known numbers of the entries shown only when they have something (top bar, sidebars): read before the first page.
  ctx.navCounts = createNavCounts({ db });
  const navCountsReady = ctx.navCounts.load();
  ctx.pins = createPinsService({ db });
  ctx.credits = createCreditsStore({ db });
  ctx.guideLayout = createGuideLayoutStore({ db });
  // Favourites and collections are shared by all providers under keys that mean the same everywhere (the TMDB id). A title saved under its
  // provider's own key moves to the shared one as soon as the catalog gives it a TMDB id (after a sync, or at start).
  ctx.shareKeys = async () => {
    const current = await active.get();
    if (!current) return;
    const resolve = (key) => portableKeyFor(current.db, key);
    const moved = (await ctx.favorites.upgrade(current.provider.id, resolve)) + (await ctx.collections.upgrade(current.provider.id, resolve));
    if (moved) log.info(`Saved titles now shared between providers (TMDB id): ${moved}`);
  };
  ctx.searchHistory = createSearchHistory({ db });
  ctx.pageCache = createPageCache();
  // Start-up and background work in order of importance (see backgroundQueue.js): a catalog sync holds all of it, the search index is last.
  const queue = createBackgroundQueue({
    onError: (name, err) => log.warn(`Background task ${name} failed`, err && err.message),
    onTask: ({ name, ms, error }) => { if (!error) log.info(`Task ${name} done in ${ms} ms`); },
  });
  ctx.queue = queue;
  const queueSearchWarm = () => queue.add({ name: 'search', priority: Priority.SEARCH, run: () => ctx.search.warm().catch(() => undefined) });
  // Everything read from the catalog is out of date (a rebuild, a sync, hidden categories): caches emptied, the search index rebuilt.
  ctx.catalogChanged = () => {
    ctx.pageCache.clear();
    if (ctx.suggestions && ctx.suggestions.invalidate) ctx.suggestions.invalidate(); // the titles to suggest are found in the catalog
    ctx.search.invalidate();
    queueSearchWarm();
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
  ctx.openSubtitles = createOpenSubtitles({ getKey: () => ctx.apiKeys.get().openSubtitlesKey });
  const tmdb = createTmdbService({ db, client: createTmdbClient({ getApiKey: () => ctx.apiKeys.get().tmdbKey }), getLanguage: () => i18n.getLocale(), onActivity: (count) => ctx.genres && ctx.genres.hold('ui', count > 0) });
  ctx.tmdb = tmdb;
  ctx.operations = createOperations();
  ctx.syncLog = createSyncLog({ db, operations: ctx.operations });
  // Scheduled viewing: a notice NOTICE_MS before, then the channel starts LEAD_MS before the programme (while the app is open); the
  // programme leaves the list when it ends.
  ctx.schedules = createScheduledViewing({ db });
  const runSchedules = async () => {
    await ctx.schedules.prune(); // ended programmes leave "Scheduled"
    const due = await ctx.schedules.due();
    for (const s of due.notice) {
      await ctx.schedules.markNoticed(s);
      ctx.notices.info(t('schedule.startingSoon', { title: s.title, channel: s.entryName }), { key: 'schedule' });
    }
    for (const s of due.start) {
      await ctx.schedules.markStarted(s); // stays in "Scheduled" until the programme ends
      const current = await active.get();
      if (!current || current.provider.id !== s.providerId) continue;
      const entry = await getEntry(current.db, s.entryKey);
      if (!entry) continue;
      log.info(`Scheduled viewing: ${s.title} on ${entry.name}`);
      ctx.router.push('player', { type: 'live', entryKey: entry.key, title: entry.name, icon: entry.icon, playlist: [{ id: entry.defaultId, ext: '', title: '' }], index: 0, epgChannelId: entry.epgChannelId, section: 'live' });
      break; // one channel at a time
    }
  };
  // A timer to the next thing due (none while nothing is scheduled); at most a minute, so a TV that slept or a clock that moved is caught up.
  let scheduleTimer = null;
  let scheduleRunning = false;
  const planSchedules = async () => {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
    const at = await ctx.schedules.nextAt().catch(() => null);
    if (at === null || scheduleRunning) return;
    scheduleTimer = setTimeout(async () => {
      scheduleRunning = true;
      try {
        await runSchedules();
      } catch (err) {
        log.warn('Scheduled viewing failed', err && err.message);
      } finally {
        scheduleRunning = false;
        planSchedules();
      }
    }, Math.min(60000, Math.max(1000, at - Date.now() + 50)));
  };
  ctx.schedules.onChange(() => planSchedules());
  planSchedules();
  // What Settings asks (updates, rebuilds) runs one job at a time, after any catalog / genre / TMDB work already running.
  const EXCLUSIVE = ['catalog', 'tmdb', 'genres', 'rebuild'];
  ctx.jobs = createJobQueue({
    operations: ctx.operations,
    isBusy: () => Boolean(catalog.getState().running) || ctx.operations.list().some((op) => !op.queued && EXCLUSIVE.includes(op.id)),
    onError: (key, err) => log.warn(`Job ${key} failed`, err && err.message),
  });
  /**
   * Works out the entries of some media types again from the stored lists (hidden categories, title cleaning, Live grouping or links
   * changed, "update" / "empty" of the derived data). It runs in a catalog worker: on a TV rebuilding 30 000 titles on the UI thread
   * blocked it for seconds. Listed among the operations in progress (it can be stopped); resolves with { type: entries } or null.
   */
  ctx.rebuildCatalog = async (types, { providerId = null } = {}) => {
    const current = await active.get();
    const id = providerId || (current && current.provider.id);
    if (!id) return null;
    const excluded = {};
    for (const type of types) excluded[type] = Array.from(await settings.getExcluded(id, type));
    const payload = { providerId: id, types, excluded, cleanTitles: Boolean(await catalog.getCleanTitles()), grouping: types.includes('live') ? await liveGrouping.config(id) : undefined };
    const started = Date.now();
    const handle = startRebuild(payload, { createWorker: createCatalogWorker });
    const end = ctx.operations.start('rebuild', { cancel: () => handle.cancel() });
    try {
      const counts = await handle.promise;
      if (counts) log.info(`Rebuild ${types.join(', ')}: ${Object.values(counts).reduce((a, b) => a + b, 0)} entries in ${Date.now() - started} ms`);
      return counts;
    } catch (err) {
      log.warn('Rebuild failed', err && err.message);
      return null;
    } finally {
      end();
      ctx.catalogChanged();
    }
  };
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
  const epg = createEpgService({ active, providers, createWorker: createEpgWorker, operations: ctx.operations, customUrl: () => ctx.settings.get().then((s) => s.customEpgUrl),
    // The programme titles are read and searched in the search worker.
    programmeSearch: { warm: () => ctx.search.warmProgrammes(), search: (query, options) => ctx.search.searchProgrammes(query, options), invalidate: () => ctx.search.invalidateProgrammes() },
  });
  ctx.epg = epg;
  // The guide is the last start-up task (after the catalog, metadata, Trakt and the search index), at most once a day: `maybeSync`
  // downloads only when the last download is a day old. While the app stays open it is checked again every hour.
  // The task only starts the download (in its worker): tasks added meanwhile (Trakt every 15 minutes, genres) do not wait for it.
  const queueEpg = () =>
    queue.add({
      name: 'epg',
      priority: Priority.EPG,
      run: () => {
        epg.maybeSync().catch(() => undefined);
      },
    });
  // Favourite categories and genres show how many titles they hold; a grey sweep stands in until it is known.
  const filterTotals = (type) => (filterTotals.cache[type] = filterTotals.cache[type] || ctx.genres.counts(type).catch(() => new Map()));
  filterTotals.cache = {};
  const fillFilterCounts = (entries, cards) => {
    entries.forEach((entry, i) => {
      if (!entry.filterKind || !cards[i]) return;
      cards[i].update({ countLoading: true });
      let job;
      if (entry.filterKind === 'genre') job = filterTotals(entry.type).then((map) => map.get(String(entry.filterId)) || 0);
      else if (entry.filterKind === 'epgGenre') job = epg.genreRows({ shown: true }).then((found) => (found.rows.get(String(entry.filterId)) || []).length);
      else job = active.get().then((current) => (current ? countEntries(current.db, { type: entry.type, categoryId: entry.filterId }) : 0));
      job.then((n) => cards[i].update({ count: n })).catch(() => cards[i].update({ count: null }));
    });
    filterTotals.cache = {}; // fresh numbers at the next page
  };
  ctx.enrich = (entries, cards, type, keepQueue = false, { hideFavorite = false } = {}) => {
    fillFilterCounts(entries, cards);
    const totals = new Map();
    let summaries = null;
    const paint = (i) => {
      if (!summaries || !cards[i]) return;
      const entry = entries[i];
      const providerId = summaries.providerId;
      const summary = summaries.map.get(watchKey(providerId, entry.key));
      // The badge, and the progress bar of a title started and not finished (on every card: grids, carousels, search).
      cards[i].update({ status: watchStatus(type, summary, totals.get(entry.key)), ...(summary && summary.progress > 0 ? { progress: summary.progress } : {}) });
    };
    tmdb.enrich(entries, cards, type, (entry, i, meta) => {
      if (meta.episodes) totals.set(entry.key, meta.episodes);
      paint(i);
    }, keepQueue);
    // A heart under the rating for the titles that are favourites.
    if (!hideFavorite) {
      active.get()
        .then((current) => (current ? ctx.favorites.listTitles(current.provider.id) : []))
        .then((titles) => {
          const keys = new Set(titles.map((f) => f.entryKey));
          entries.forEach((entry, i) => cards[i] && cards[i].update({ favorite: keys.has(entry.key) }));
        })
        .catch(() => undefined);
    }
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
    onBack: () => handleAction(Action.BACK), // the pointer's Back button
    onOpen: () => {
      // The search icon shows the search page at once, with the last searches, and loads the index now instead of last.
      ctx.search.warm().catch(() => undefined);
      epg.warmSearch().catch(() => undefined); // the programme titles too
      if (!(router.current && router.current.name === 'search')) router.push('search', { query: '', section: 'search' });
    },
    onCleared: () => {
      if (router.current && router.current.name === 'search' && router.page && router.page.showRecent) router.page.showRecent();
    },
    onTyping: (text) => {
      // First keystroke: open the results page right away, with placeholders instead of an empty screen.
      if (router.current && router.current.name === 'search') {
        if (router.page && router.page.showSkeleton) router.page.showSkeleton(text);
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
      detail: (params) => createLazyPage(LAZY_PAGES.detail, (create) => create(ctx, params), { errorText: t('error.UNKNOWN') }),
      player: (params) => createLazyPage(LAZY_PAGES.player, (create) => create(ctx, params), { errorText: t('error.UNKNOWN') }),
      browse: (params) => createBrowsePage(ctx, params),
      providers: (params) => createProvidersPage(ctx, params),
      providerSetup: (params) => createProviderSetupPage(ctx, params),
      settings: () => createLazyPage(LAZY_PAGES.settings, (create) => create(ctx), { errorText: t('error.UNKNOWN') }),
      categories: () => createCategoriesPage(ctx),
      diagnostics: () => createLazyPage(LAZY_PAGES.diagnostics, (create) => create(ctx), { errorText: t('error.UNKNOWN') }),
    },
    onChange: (entry, page) => {
      const section = sectionForEntry(entry);
      // The search bar belongs to the results page: leaving it closes the bar, coming back reopens it.
      if (entry.name === 'search' && !topbar.isSearching()) topbar.openSearch({ query: (page && page.getQuery && page.getQuery()) || '', silent: true });
      else if (entry.name !== 'search' && topbar.isSearching()) topbar.closeSearch({ notify: false });
      topbar.syncSearchLinks();
      topbar.setSkeleton(entry.name === 'providerSetup' && Boolean(entry.params.firstRun));
      topbar.setVisible(entry.name !== 'player');
      topbar.setCanGoBack(router.depth > 1);
      if (ctx.notices) ctx.notices.setPlayback(entry.name === 'player');
      if (ctx.screensaver) ctx.screensaver.setSuspended(entry.name === 'player'); // never over a video
      topbar.setCurrentSection(section);
      ctx.refreshTopbar().catch(() => undefined);
      // Pages with their own zone take focus in mount(). When the user switched section from the bar,
      // or the page has no zone, the focus stays on (or returns to) the bar, on the current section.
      if (entry.params.focusTopbar || !focus.active) focus.focus(TOPBAR_ZONE, topbar.indexOfSection(section));
    },
  });
  ctx.router = router;

  /**
   * Suggestions come from TMDB / Trakt (several requests): the last list is kept for SUGGESTIONS_TTL_MS and shared by Home, the Movies /
   * Series sidebars and the Suggestions page; worked out again sooner when what it depends on changed (provider, source, keys, catalog).
   */
  const SUGGESTIONS_TTL_MS = 10 * 60 * 1000;
  let suggestionsMemo = null; // { signature, startedAt, limit, promise }
  const buildSuggestions = ctx.suggestions.build.bind(ctx.suggestions);
  const suggestionsSignature = async () => {
    const current = await active.get().catch(() => null);
    const keys = ctx.apiKeys.get();
    return [current ? current.provider.id : '', (await settings.get()).suggestionSource, keys.tmdbKey ? 1 : 0, keys.traktId ? 1 : 0, ctx.trakt && ctx.trakt.enabled ? 1 : 0].join('|');
  };
  ctx.suggestions.invalidate = () => {
    suggestionsMemo = null;
  };
  ctx.suggestions.build = async (options = {}) => {
    const limit = options.limit || 36;
    const signature = await suggestionsSignature();
    const memo = suggestionsMemo;
    if (!(memo && memo.signature === signature && memo.limit >= limit && Date.now() - memo.startedAt < SUGGESTIONS_TTL_MS)) {
      const promise = buildSuggestions({ ...options, limit });
      suggestionsMemo = { signature, startedAt: Date.now(), limit, promise };
      promise.catch(() => {
        if (suggestionsMemo && suggestionsMemo.promise === promise) suggestionsMemo = null; // a failure is not kept
      });
    }
    const result = await suggestionsMemo.promise;
    const entries = result && result.entries ? result.entries : [];
    noteSuggestions(signature.split('|')[0], entries.length);
    return { ...result, entries: entries.slice(0, limit) };
  };

  /**
   * Favorites, Collections and Suggestions are in the top bar only when they have something to show. The numbers last known (kept in the
   * database, ctx.navCounts) place them at once; the ones worked out now (at every page change, and when suggestions are worked out)
   * correct them.
   */
  let suggestionsCount = null; // the last suggestion list of this session (null: none yet, the remembered number counts)
  function noteSuggestions(providerId, count) {
    ctx.navCounts.set(providerId, 'top:suggestions', count);
    if (count !== suggestionsCount) {
      suggestionsCount = count;
      ctx.refreshTopbar();
    }
  }
  const applyTopbar = (current, { favorites, collections, suggestions }) => {
    const hide = [];
    if (!favorites) hide.push('favorites');
    if (!collections) hide.push('collections');
    if (!suggestions || !ctx.suggestions.enabled) hide.push('suggestions');
    topbar.setHidden(hide.concat(providerHiddenSections(current && current.provider)));
  };
  ctx.refreshTopbar = async () => {
    const current = await active.get().catch(() => null);
    const id = current && current.provider.id;
    const remembered = (key) => ctx.navCounts.get(id, key) || 0;
    const suggestions = suggestionsCount === null ? remembered('top:suggestions') : suggestionsCount;
    // At once with the numbers last known, then with the ones read now.
    applyTopbar(current, { favorites: remembered('top:favorites'), collections: remembered('top:collections'), suggestions });
    // Favorites: only what the provider can show (favourites of another provider, or titles gone from the catalog, do not count).
    const [favorites, collections] = await Promise.all([
      current ? visibleFavorites(ctx, current).then((list) => list.length, () => 0) : 0,
      id ? ctx.collections.list(id).then((list) => list.length, () => 0) : 0,
    ]);
    ctx.navCounts.set(id, 'top:favorites', favorites);
    ctx.navCounts.set(id, 'top:collections', collections);
    applyTopbar(current, { favorites, collections, suggestions: suggestionsCount === null ? remembered('top:suggestions') : suggestionsCount });
  };

  let wasSyncing = false;
  let endCatalogOp = () => undefined;
  catalog.onChange((state) => {
    if (state.running && !wasSyncing) {
      queue.block();
      log.info('Catalog sync started');
    }
    if (!state.running && wasSyncing) {
      queue.unblock();
      log.info(`Catalog sync ${state.cancelled ? 'cancelled' : state.error ? 'failed' : 'finished'}`);
    }
    if (state.running && !wasSyncing) endCatalogOp = ctx.operations.start('catalog', { startedAt: state.startedAt, cancel: () => catalog.cancel() });
    if (!state.running) endCatalogOp();
    if (wasSyncing && !state.running && !state.cancelled) {
      ctx.catalogChanged(); // caches emptied and the new search index ready before the next search
      ctx.refreshAdult();
      queue.add({ name: 'share-keys', priority: Priority.METADATA, run: () => ctx.shareKeys().catch(() => undefined) });
      queue.add({ name: 'genres', priority: Priority.METADATA, run: () => ctx.genres.backfill().catch(() => undefined) }); // the genre worker finds genres the lists did not carry
      queueEpg(); // a provider added or changed: its guide after the rest
    }
    wasSyncing = state.running;
  });

  // The page cache is bypassed while the catalog is being changed (sync, genre or TMDB downloads) and emptied when the job ends.
  const CATALOG_JOBS = new Set(['catalog', 'genres', 'tmdb', 'rebuild']);
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
    document.documentElement.lang = i18n.getLocale();
    ctx.pageCache.clear(); // titles and genres change with the language
    topbar.render();
    router.reload();
    queue.add({ name: 'genres', priority: Priority.METADATA, run: () => ctx.genres.backfill().catch(() => undefined) }); // metadata and genres in the new language
  });

  const dialogs = createDialogService({ focus });
  ctx.dialogs = dialogs;
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
    requestExit: () => platform.exit(),
    texts: () => ({
      title: t('exit.title'),
      message: t('exit.message'),
      confirmLabel: t('exit.confirm'),
      cancelLabel: t('exit.cancel'),
    }),
  });

  const input = new InputService(document, { holdsEnter: () => Boolean(focus.active && focus.active.onLongActivate) });
  input.registerPlatformKeys();
  const handleAction = (action) => {
    if (action === Action.BACK) {
      // An open dialog or search closes first; then the page may use Back for itself (a grid that is not the main one, the player's controls).
      const overlay = dialogs.isOpen() || topbar.isSearching();
      if (!overlay && router.page && router.page.onBack && router.page.onBack()) return;
      onBack();
      return;
    }
    // A page may own some keys (the player owns every key except Back).
    if (router.page && router.page.onAction && router.page.onAction(action)) return;
    focus.handle(action);
  };
  input.onAction(handleAction);
  input.start();
  // Mouse, touch, Magic Remote: the same focus as the keys (the element under the pointer), a click is OK, Back from a mouse button or
  // a click outside a dialog.
  createPointer({ focus, onBack: () => handleAction(Action.BACK), isTextEditing: () => isTextEditing(document) });

  log.info('Xtream IPTV started');
  // History and progress that could not be sent last time, then what was watched only here.
  queue.add({ name: 'share-keys', priority: Priority.METADATA, run: () => ctx.shareKeys().catch(() => undefined) });
  queue.add({ name: 'trakt', priority: Priority.TRAKT, run: () => ctx.trakt.flush().then(() => ctx.watch.syncIfChanged()).catch(() => undefined) });
  // Trakt stays aligned while the app is open: one small check every 15 minutes, a full read only if the account changed.
  // The changes still waiting for Trakt (an error that may go through later: 429, 5xx, no network) go out at every check too.
  setInterval(() => queue.add({ name: 'trakt', priority: Priority.TRAKT, run: () => ctx.trakt.flush().then(() => ctx.watch.syncIfChanged()).catch(() => undefined) }), 15 * 60 * 1000);
  const [hasProvider] = await Promise.all([providers.getActive(), keysReady, navCountsReady]);
  if (hasProvider) await ctx.refreshAdult();
  if (hasProvider) {
    router.reset('home', { section: 'home' });
    showSubscriptionNotice(notices, hasProvider);
    // Stale-while-revalidate: the cached catalog is usable at once, lists older than 12 h refresh in background.
    catalog.start();
    queue.add({ name: 'genres', priority: Priority.METADATA, run: () => ctx.genres.backfill().catch(() => undefined) });
    // The series of "continue watching" the provider no longer serves (details without episodes) leave the catalog (details cached a day).
    queue.add({
      name: 'unavailable',
      priority: Priority.TRAKT,
      run: async () => {
        const current = await active.get();
        if (!current) return;
        let removed = 0;
        for (const rec of await continueWatching(ctx, { providerId: current.provider.id, limit: 20 })) {
          if (rec.type !== 'series') continue;
          const entry = await getEntry(current.db, rec.entryKey);
          const info = entry ? await ctx.details.series(entry.defaultId).catch(() => null) : null;
          if (!isEmptySeries(entry, info)) continue;
          await markUnavailable(current.db, entry.key);
          removed += 1;
        }
        if (!removed) return;
        log.info(`Series without episodes taken out of the catalog: ${removed}`);
        ctx.catalogChanged();
        if (router.current && router.current.name === 'home') router.reload();
      },
    });
    // The search index comes next (the search icon moves it to the front), then the programme guide.
    queueSearchWarm();
    queueEpg();
    setInterval(queueEpg, 60 * 60 * 1000);
  } else {
    router.reset('providerSetup', { firstRun: true });
  }
  // The code of the other pages is read once the start-up work is done (the first opening is then as quick as the others).
  // A build loaded online reads them sooner (the network may drop later).
  setTimeout(() => preloadPages([LAZY_PAGES.detail, LAZY_PAGES.player, LAZY_PAGES.settings, LAZY_PAGES.diagnostics]), window.__XI_BASE__ ? 2000 : 15000);
  // A newer build is looked for once the first page is up (a few seconds later: the start-up work goes first).
  setTimeout(() => updateInBackground(notices, restartDialog({ dialogs, notices, isBusy: () => dialogs.isOpen() || topbar.isSearching() })).catch((err) => log.warn('Update failed', err && err.message)), 3000);
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
  // A build installed online that does not start: back to the package's copy at the next start.
  if (runningVersions().bundle) forgetUpdate();
  document.getElementById('content').textContent = 'Startup failed. Please restart the app.';
});
