import './styles/main.scss';
import { i18n, t, detectLocale } from './i18n/index.js';
import { openAppDb } from './db/appDb.js';
import { InputService, Action } from './core/input.js';
import { exitApp } from './core/env.js';
import { log } from './core/logger.js';
import { FocusManager } from './ui/focus/FocusManager.js';
import { Router } from './ui/router.js';
import { createTopbar, TOPBAR_ZONE, sectionForEntry } from './ui/components/topbar.js';
import { createDialogService } from './ui/components/dialog.js';
import { createBackHandler } from './ui/backHandler.js';
import { ProviderStore } from './services/providerStore.js';
import { SettingsService } from './services/settings.js';
import { createComingSoonPage } from './ui/pages/simplePages.js';
import { createHomePage } from './ui/pages/homePage.js';
import { CatalogSyncService } from './services/catalogSyncService.js';
import { createCatalogWorker } from './services/createCatalogWorker.js';
import { createBrowsePage } from './ui/pages/browsePage.js';
import { createProvidersPage } from './ui/pages/providersPage.js';
import { createProviderSetupPage } from './ui/pages/providerSetupPage.js';
import { createSettingsPage } from './ui/pages/settingsPage.js';
import { createDiagnosticsPage } from './ui/pages/diagnosticsPage.js';

async function boot() {
  const db = await openAppDb();
  const settings = new SettingsService(db);
  const providers = new ProviderStore(db);

  const prefs = await settings.get();
  i18n.setLocale(prefs.language === 'auto' ? detectLocale(navigator.language) : prefs.language);

  const focus = new FocusManager();
  const catalog = new CatalogSyncService({ providers, settings, createWorker: createCatalogWorker });
  const ctx = { db, settings, providers, catalog, focus, router: null };

  const topbar = createTopbar(ctx);
  document.getElementById('topbar').appendChild(topbar.el);

  const router = new Router({
    container: document.getElementById('content'),
    routes: {
      home: () => createHomePage(ctx),
      comingSoon: (params) => createComingSoonPage(ctx, params),
      browse: (params) => createBrowsePage(ctx, params),
      providers: (params) => createProvidersPage(ctx, params),
      providerSetup: (params) => createProviderSetupPage(ctx, params),
      settings: () => createSettingsPage(ctx),
      diagnostics: () => createDiagnosticsPage(ctx),
    },
    onChange: (entry) => {
      const section = sectionForEntry(entry);
      topbar.setVisible(!(entry.name === 'providerSetup' && entry.params.firstRun));
      topbar.setCurrentSection(section);
      // Pages with their own zone take focus in mount(). When the user switched section from the bar,
      // or the page has no zone, the focus stays on (or returns to) the bar, on the current section.
      if (entry.params.focusTopbar || !focus.active) focus.focus(TOPBAR_ZONE, topbar.indexOfSection(section));
    },
  });
  ctx.router = router;

  i18n.onChange(() => {
    topbar.render();
    router.reload();
  });

  const dialogs = createDialogService({ focus });
  ctx.dialogs = dialogs;
  const onBack = createBackHandler({
    dialogs,
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
      onBack();
      return;
    }
    focus.handle(action);
  });
  input.start();

  log.info('Xtream IPTV started');
  const active = await providers.getActive();
  if (active) {
    router.reset('home', { section: 'home' });
    // Stale-while-revalidate: the cached catalog is usable at once, lists older than 12 h refresh in background.
    catalog.start();
  } else {
    router.reset('providerSetup', { firstRun: true });
  }
}

boot().catch((err) => {
  log.error('Fatal startup error', err);
  document.getElementById('content').textContent = 'Startup failed. Please restart the app.';
});
