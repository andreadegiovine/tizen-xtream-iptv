import './styles/main.scss';
import { i18n, detectLocale } from './i18n/index.js';
import { openAppDb } from './db/appDb.js';
import { InputService, Action } from './core/input.js';
import { exitApp } from './core/env.js';
import { log } from './core/logger.js';
import { FocusManager } from './ui/focus/FocusManager.js';
import { Router } from './ui/router.js';
import { createTopbar, TOPBAR_ZONE } from './ui/components/topbar.js';
import { ProviderStore } from './services/providerStore.js';
import { SettingsService } from './services/settings.js';
import { createHomePage, createComingSoonPage } from './ui/pages/simplePages.js';
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
  const ctx = { db, settings, providers, focus, router: null };

  const topbar = createTopbar(ctx);
  document.getElementById('topbar').appendChild(topbar.el);

  const router = new Router({
    container: document.getElementById('content'),
    routes: {
      home: () => createHomePage(ctx),
      comingSoon: (params) => createComingSoonPage(ctx, params),
      providerSetup: (params) => createProviderSetupPage(ctx, params),
      settings: () => createSettingsPage(ctx),
      diagnostics: () => createDiagnosticsPage(ctx),
    },
    onChange: (entry) => {
      topbar.setVisible(!(entry.name === 'providerSetup' && entry.params.firstRun));
      topbar.setCurrentRoute(entry.name === 'diagnostics' ? 'settings' : entry.name);
      // Pages with their own zone take focus in mount(); otherwise fall back to the topbar.
      if (!focus.active) focus.focus(TOPBAR_ZONE, topbar.indexForRoute(entry.name));
    },
  });
  ctx.router = router;

  i18n.onChange(() => {
    topbar.render();
    router.reload();
  });

  const input = new InputService(document);
  input.registerTizenKeys();
  input.onAction((action) => {
    if (action === Action.BACK) {
      if (!router.back()) exitApp();
      return;
    }
    focus.handle(action);
  });
  input.start();

  log.info('Xtream IPTV started');
  const active = await providers.getActive();
  if (active) router.reset('home');
  else router.reset('providerSetup', { firstRun: true });
}

boot().catch((err) => {
  log.error('Fatal startup error', err);
  document.getElementById('content').textContent = 'Startup failed. Please restart the app.';
});
