import { createCodePrompt } from '../components/codePrompt.js';
import { resetApp } from '../../services/resetApp.js';
import { h } from '../dom.js';
import { changePin } from '../components/pinFlows.js';
import { TIME_FORMATS, DATE_FORMATS, formatClockTime, formatClockDate } from '../../core/clock.js';
import { t, i18n, detectLocale } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { LANGUAGE_OPTIONS, GRID_OPTIONS, CAROUSEL_OPTIONS, BUFFER_OPTIONS, SUGGESTION_SOURCE_OPTIONS } from '../../services/settings.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createSyncPanel, createTmdbPanel, createTraktPanel, createDevicePanel, createOperationsPanel } from '../components/syncPanel.js';
import { log } from '../../core/logger.js';
import { rebuildEntries } from '../../services/catalogSync.js';

const ZONE_ID = 'settings';
const IME_DONE = 65376;
const IME_CANCEL = 65385;

/** A row with an editable text value (API keys). OK opens the on-screen keyboard; Done saves. */
export function textRow({ label, field, secret = false, ctx }) {
  const input = h('input', { class: 'value-input', type: secret ? 'password' : 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '—' });
  const el = h('div', { class: 'row' }, h('span', { text: label }), input);
  const show = () => {
    input.value = ctx.apiKeys.getStored(field);
  };
  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // the text field owns its keys
    if (event.keyCode === 13 || event.keyCode === IME_DONE) {
      event.preventDefault();
      input.blur();
      const before = ctx.apiKeys.getStored(field);
      const titlesChange = field === 'tmdbKey' && Boolean(before.trim()) !== Boolean(input.value.trim());
      ctx.apiKeys.set({ [field]: input.value }).then(() => (titlesChange ? rebuildTitles(ctx) : undefined)).then(() => {
        ctx.notices.success(t('settings.saved'));
        // A new TMDB key starts the first metadata run at once (genres and TMDB data of what was watched).
        if (field === 'tmdbKey' && input.value.trim() && input.value.trim() !== before && ctx.genres) {
          ctx.genres
            .forgetMisses()
            .then(() => ctx.genres.backfill())
            .catch(() => undefined);
        }
        ctx.router.reload(); // rows that depend on the keys appear or disappear
      });
    } else if (event.keyCode === IME_CANCEL) {
      input.blur();
      show();
    }
  });
  return { el, refresh: async () => show(), activate: async () => input.focus() };
}

/** Movie / series titles are cleaned only when TMDB is configured: adding or removing the key rebuilds the entries. */
async function rebuildTitles(ctx) {
  try {
    const active = await ctx.active.get();
    if (!active) return;
    const cleanTitles = Boolean(ctx.apiKeys.get().tmdbKey);
    for (const type of ['movie', 'series']) {
      const excluded = await ctx.settings.getExcluded(active.provider.id, type);
      await rebuildEntries({ db: active.db, type, excludedCategories: excluded, cleanTitles });
    }
    ctx.search.invalidate();
  } catch (err) {
    log.warn('Titles rebuild failed', err && err.message);
  }
}

/** A row that runs an action (optionally after a confirmation). */
export function actionRow({ label, run, confirm = null, ctx }) {
  return {
    el: h('div', { class: 'row' }, h('span', { text: label })),
    refresh: async () => undefined,
    async activate() {
      if (confirm) {
        const ok = await ctx.dialogs.confirm({ title: label, message: confirm, confirmLabel: t('settings.confirmRemove'), cancelLabel: t('setup.cancel') });
        if (!ok) return;
      }
      await run();
    },
  };
}

/** A setting that is picked from a fixed list: shows the current value, OK opens the list. */
export function optionRow({ labelKey, key, options, format = String, ctx }) {
  const value = h('span', { class: 'value' });
  const el = h('div', { class: 'row' }, h('span', { text: t(labelKey) }), value);
  const show = (current) => {
    value.textContent = format(current);
  };
  return {
    el,
    refresh: () => ctx.settings.get().then((s) => show(s[key])),
    async activate() {
      const current = (await ctx.settings.get())[key];
      const chosen = await ctx.dialogs.choose({ title: t(labelKey), options: options.map((o) => ({ label: format(o), value: o })), selected: current });
      if (chosen === null) return;
      await ctx.settings.update({ [key]: chosen });
      show(chosen);
      if (key === 'language') i18n.setLocale(chosen === 'auto' ? detectLocale(navigator.language) : chosen);
      if ((key === 'timeFormat' || key === 'dateFormat') && ctx.refreshClock) ctx.refreshClock();
    },
  };
}

export function createSettingsPage(ctx) {
  const language = (v) => (v === 'auto' ? t('settings.language.auto') : v);
  const seconds = (v) => `${v} s`;
  const now = new Date();
  const timeName = (v) => (v === 'auto' ? t('settings.format.auto') : `${v === '12h' ? t('settings.time.12h') : t('settings.time.24h')} (${formatClockTime(now, v)})`);
  const dateName = (v) => (v === 'auto' ? t('settings.format.auto') : `${t(`settings.date.${v}`)} (${formatClockDate(now, v)})`);

  const autoplayValue = h('span', { class: 'value' });
  const autoplay = {
    el: h('div', { class: 'row' }, h('span', { text: t('settings.autoplayNext') }), autoplayValue),
    refresh: () => ctx.settings.get().then((s) => { autoplayValue.textContent = s.autoplayNext ? t('common.on') : t('common.off'); }),
    async activate() {
      const s = await ctx.settings.get();
      const next = await ctx.settings.update({ autoplayNext: !s.autoplayNext });
      autoplayValue.textContent = next.autoplayNext ? t('common.on') : t('common.off');
    },
  };


  /** Trakt device-code login: shows the code, waits for the approval on another device, then imports the history. */
  async function connectTrakt() {
    if (!ctx.trakt.enabled) {
      ctx.notices.warning(t('trakt.needKeys'));
      return;
    }
    if (await ctx.trakt.isConnected()) {
      ctx.notices.info(t('settings.connected'));
      return;
    }
    const controller = new AbortController();
    let shown = null;
    const login = ctx.trakt.connect({ onCode: (c) => { shown = c; }, signal: controller.signal });
    // The dialog needs the code, which arrives asynchronously: wait for it a moment.
    for (let i = 0; i < 50 && !shown; i += 1) await new Promise((r) => setTimeout(r, 100));
    if (!shown) {
      controller.abort();
      return;
    }
    const dialog = ctx.dialogs.confirm({ title: 'Trakt', content: createCodePrompt({ url: shown.url, description: t('settings.traktCode'), code: shown.code }), confirmLabel: t('common.ok'), cancelLabel: t('setup.cancel') });
    login.then((done) => { if (done) ctx.dialogs.dismiss(); });
    const answer = await dialog;
    if (!answer) controller.abort();
    const connected = await login.catch(() => false);
    if (connected) ctx.syncLog.track('trakt', (signal) => ctx.watch.importFromTrakt({ signal })).catch((err) => log.warn('Trakt import failed', err && err.message));
    await traktPanel.refresh();
    if (connected) ctx.focus.focus(ZONE_ID, visibleRows().indexOf(traktSyncRow) + opsPanel.rows.length); // the connect button is gone
  }

  async function syncTrakt() {
    await ctx.trakt.flush();
    ctx.notices.success(t('settings.traktSyncDone', { count: await ctx.syncLog.track('trakt', (signal) => ctx.watch.importFromTrakt({ signal })) }));
    traktPanel.refresh().catch(() => undefined);
  }

  async function removeTrakt() {
    const ok = await ctx.dialogs.confirm({ title: t('settings.traktRemove'), message: t('settings.traktRemoveConfirm'), confirmLabel: t('settings.confirmRemove'), cancelLabel: t('setup.cancel') });
    if (!ok) return;
    await ctx.trakt.disconnect();
    await ctx.watch.removeTraktData();
    ctx.notices.success(t('settings.removed'));
    await traktPanel.refresh();
    ctx.focus.focus(ZONE_ID, visibleRows().indexOf(traktConnectRow) + opsPanel.rows.length); // the remove / sync buttons are gone
  }

  /** "Update": the TMDB download of the titles that are missing or expired, then the genre search. */
  async function updateMetadata() {
    if (metaBusy) return;
    metaBusy = true;
    tmdbPanel.button.classList.add('disabled');
    // Every step that will run is listed at once ("queued"); each one becomes "running" on its turn.
    const steps = [];
    if (ctx.tmdb && ctx.tmdb.enabled) steps.push({ id: 'tmdb', run: () => ctx.genres.download() });
    steps.push({ id: 'genres', run: () => ctx.genres.findGenres() });
    const skipped = new Set();
    const ends = steps.map((step) => ctx.operations.start(step.id, { queued: true, cancel: () => skipped.add(step.id) }));
    try {
      for (const step of steps) {
        if (!skipped.has(step.id)) await step.run();
      }
    } catch (err) {
      log.warn('Metadata update failed', err && err.message);
    } finally {
      ends.forEach((end) => end());
      metaBusy = false;
      tmdbPanel.button.classList.remove('disabled');
      tmdbPanel.refresh().catch(() => undefined);
      devicePanel.refresh().catch(() => undefined);
    }
  }

  const diagnostics = { el: h('div', { class: 'row' }, h('span', { text: t('settings.diagnostics') })), refresh: async () => undefined, activate: async () => ctx.router.push('diagnostics') };

  // Catalog and metadata tables at the top; the "update the catalog" button is the first row of the list.
  const panel = createSyncPanel(ctx);
  const tmdbPanel = createTmdbPanel(ctx);
  const traktPanel = createTraktPanel(ctx);
  const devicePanel = createDevicePanel();
  const opsPanel = createOperationsPanel(ctx);
  let metaBusy = false;
  const syncRow = { el: panel.button, refresh: async () => undefined, activate: async () => panel.syncNow() };
  const metaRow = { el: tmdbPanel.button, refresh: async () => undefined, activate: updateMetadata };
  const metaRemoveRow = {
    el: tmdbPanel.removeButton,
    refresh: async () => undefined,
    async activate() {
      const ok = await ctx.dialogs.confirm({ title: t('settings.metaRemove'), message: t('settings.metaRemoveConfirm'), confirmLabel: t('settings.confirmRemove'), cancelLabel: t('setup.cancel') });
      if (!ok) return;
      ctx.genres.stop();
      await ctx.tmdb.clearAll();
      await ctx.genres.clearTmdb();
      await ctx.syncLog.clear('tmdb');
      ctx.notices.success(t('settings.removed'));
      tmdbPanel.refresh().catch(() => undefined);
    },
  };
  const traktConnectRow = { el: traktPanel.connectButton, refresh: async () => undefined, activate: connectTrakt };
  const traktSyncRow = { el: traktPanel.syncButton, refresh: async () => undefined, activate: syncTrakt };
  const traktRemoveRow = { el: traktPanel.removeButton, refresh: async () => undefined, activate: removeTrakt };
  const tmdbTokenRow = textRow({ ctx, label: t('settings.tmdbKey'), field: 'tmdbKey' });
  const traktIdRow = textRow({ ctx, label: t('settings.traktId'), field: 'traktId' });
  const traktSecretRow = textRow({ ctx, label: t('settings.traktSecret'), field: 'traktSecret', secret: true });
  const prefsTitle = h('h2', { class: 'prefs-title', text: t('settings.preferences') });

  const pinValue = h('span', { class: 'value' });
  const pinRow = {
    el: h('div', { class: 'row' }, h('span', { text: t('settings.parentalPin') }), pinValue),
    refresh: () => ctx.parental.hasPin().then((has) => { pinValue.textContent = has ? '••••' : t('parental.notSet'); }),
    async activate() {
      await changePin({ dialogs: ctx.dialogs, parental: ctx.parental, notices: ctx.notices });
      await pinRow.refresh();
    },
  };

  const prefs = [
    optionRow({ ctx, labelKey: 'settings.language', key: 'language', options: LANGUAGE_OPTIONS, format: language }),
    optionRow({ ctx, labelKey: 'settings.gridItems', key: 'gridItems', options: GRID_OPTIONS }),
    optionRow({ ctx, labelKey: 'settings.carouselItems', key: 'carouselItems', options: CAROUSEL_OPTIONS }),
    optionRow({ ctx, labelKey: 'settings.buffer', key: 'bufferSeconds', options: BUFFER_OPTIONS, format: seconds }),
    autoplay,
    optionRow({ ctx, labelKey: 'settings.timeFormat', key: 'timeFormat', options: TIME_FORMATS, format: timeName }),
    optionRow({ ctx, labelKey: 'settings.dateFormat', key: 'dateFormat', options: DATE_FORMATS, format: dateName }),
    pinRow,
    optionRow({ ctx, labelKey: 'settings.suggestionSource', key: 'suggestionSource', options: SUGGESTION_SOURCE_OPTIONS, format: (v) => (v === 'trakt' ? 'Trakt' : 'TMDB') }),
    diagnostics,
    actionRow({
      ctx,
      label: t('settings.resetAll'),
      confirm: t('settings.resetAllConfirm'),
      run: async () => {
        await resetApp({ db: ctx.db, providers: ctx.providers, stopWork: () => { ctx.genres.stop(); ctx.catalog.cancel(); }, storages: [localStorage, sessionStorage] });
        window.location.reload();
      },
    }),
  ];
  // Focus order follows the page: catalog, TMDB, Trakt, preferences.
  const rows = [syncRow, metaRow, metaRemoveRow, tmdbTokenRow, traktConnectRow, traktSyncRow, traktRemoveRow, traktIdRow, traktSecretRow, ...prefs];
  // The Trakt sync / remove buttons exist only while an account is connected.
  const visibleRows = () => rows.filter((row) => row.el.style.display !== 'none');
  rows.forEach((row) => row.refresh());

  // Stop buttons of the running operations come first, then the fixed rows; the list changes while the page is open.
  const all = () => opsPanel.rows.concat(visibleRows());
  let focusedEl = null;
  const zone = new FocusZone({
    id: ZONE_ID,
    model: new ListModel({ orientation: 'vertical', getCount: () => all().length }),
    onFocus: (i) => {
      const row = all()[i];
      focusedEl = row.el;
      row.el.classList.add('focused');
      ensureVisible(row.el, { first: i === 0 });
    },
    onBlur: () => {
      if (focusedEl) focusedEl.classList.remove('focused');
      focusedEl = null;
    },
    onActivate: (i) => {
      all()[i].activate().catch((err) => log.warn('Setting failed', err && err.message));
    },
  });
  // An operation ended (or started): the rows shift, keep the cursor on the same row.
  opsPanel.onChange = () => {
    if (ctx.focus.activeId !== ZONE_ID) return;
    const rowsNow = all();
    const same = rowsNow.findIndex((row) => row.el === focusedEl);
    ctx.focus.focus(ZONE_ID, same >= 0 ? same : Math.min(opsPanel.rows.length, rowsNow.length - 1));
  };

  return {
    el: h('section', { class: 'page framed' }, h('div', { class: 'page-container' }, h('h1', { text: t('nav.settings') }), opsPanel.el, panel.el, tmdbPanel.el, h('div', { class: 'list' }, tmdbTokenRow.el), traktPanel.el, h('div', { class: 'list' }, traktIdRow.el, traktSecretRow.el), devicePanel.el, prefsTitle, h('div', { class: 'list' }, prefs.map((r) => r.el)))),
    mount() {
      opsPanel.mount();
      tmdbPanel.mount();
      traktPanel.mount();
      panel.mount();
      ctx.providers.getActive().then((provider) => {
        const id = provider && provider.id;
        panel.setProviderName(provider ? provider.name : '');
        panel.el.style.display = id ? '' : 'none';
        syncRow.el.style.display = id ? '' : 'none';
        if (id) panel.setProvider(id);
      });
      tmdbPanel.refresh().catch(() => undefined);
      traktPanel.refresh().catch(() => undefined);
      devicePanel.refresh().catch(() => undefined);
      ctx.focus.register(zone);
      ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
      ctx.focus.focus(ZONE_ID, opsPanel.rows.length); // never on a stop button by accident
    },
    destroy() {
      opsPanel.destroy();
      tmdbPanel.destroy();
      traktPanel.destroy();
      panel.destroy();
      ctx.focus.unregister(ZONE_ID);
    },
    saveState: () => ({ index: zone.index }),
    restoreState(state) {
      ctx.focus.focus(ZONE_ID, state.index);
    },
  };
}
