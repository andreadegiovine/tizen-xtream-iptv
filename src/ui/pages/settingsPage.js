import { h, toast } from '../dom.js';
import { t, i18n, detectLocale } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { LANGUAGE_OPTIONS, GRID_OPTIONS, CAROUSEL_OPTIONS, BUFFER_OPTIONS, SUGGESTION_SOURCE_OPTIONS } from '../../services/settings.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createSyncPanel, createMetaPanel, createDevicePanel, createOperationsPanel } from '../components/syncPanel.js';
import { log } from '../../core/logger.js';

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
      ctx.apiKeys.set({ [field]: input.value }).then(() => {
        toast(t('settings.saved'));
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
    },
  };
}

export function createSettingsPage(ctx) {
  const language = (v) => (v === 'auto' ? t('settings.language.auto') : v);
  const seconds = (v) => `${v} s`;

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


  const tmdbValue = h('span', { class: 'value', text: ctx.tmdb && ctx.tmdb.enabled ? t('common.on') : t('settings.notConfigured') });
  const tmdbRow = { el: h('div', { class: 'row' }, h('span', { text: 'TMDB' }), tmdbValue), refresh: async () => undefined, activate: async () => undefined };

  const traktValue = h('span', { class: 'value' });
  const trakt = {
    el: h('div', { class: 'row' }, h('span', { text: 'Trakt' }), traktValue),
    async refresh() {
      if (!ctx.trakt.enabled) traktValue.textContent = t('settings.notConfigured');
      else traktValue.textContent = (await ctx.trakt.isConnected()) ? t('settings.connected') : t('settings.notConnected');
    },
    async activate() {
      if (!ctx.trakt.enabled) return;
      if (await ctx.trakt.isConnected()) {
        const ok = await ctx.dialogs.confirm({ title: 'Trakt', message: t('settings.traktDisconnect'), confirmLabel: t('settings.disconnect'), cancelLabel: t('setup.cancel') });
        if (ok) await ctx.trakt.disconnect();
        await trakt.refresh();
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
      const dialog = ctx.dialogs.confirm({ title: 'Trakt', message: t('settings.traktCode', { url: shown.url, code: shown.code }), confirmLabel: t('common.ok'), cancelLabel: t('setup.cancel') });
      login.then((done) => { if (done) ctx.dialogs.dismiss(); });
      const answer = await dialog;
      if (!answer) controller.abort();
      const connected = await login.catch(() => false);
      if (connected) ctx.syncLog.track('trakt', (signal) => ctx.watch.importFromTrakt({ signal })).catch((err) => log.warn('Trakt import failed', err && err.message));
      await trakt.refresh();
    },
  };


  /** Downloads again the TMDB data of what was watched and of the favourites; resolves with how many titles. */
  async function refreshTmdb() {
    const items = [];
    (await ctx.watch.seeds(30)).forEach((seed) => items.push({ type: seed.type, tmdbId: seed.tmdbId }));
    const current = await ctx.active.get();
    if (current) {
      for (const fav of await ctx.favorites.list(current.provider.id)) {
        const match = /^(movie|series):t(\d+)$/.exec(fav.entryKey);
        if (match) items.push({ type: match[1], tmdbId: Number(match[2]) });
      }
    }
    return ctx.syncLog.track('tmdb', (signal) => ctx.tmdb.refresh(items, { signal }));
  }

  /** "Update metadata now": TMDB data, the genre search and the Trakt watch state, whichever is available. */
  async function updateMetadata() {
    if (metaBusy) return;
    metaBusy = true;
    metaPanel.button.classList.add('disabled');
    toast(t('settings.working'), 15000);
    // Every step that will run is listed at once ("queued"); each one becomes "running" on its turn.
    const steps = [];
    if (ctx.tmdb && ctx.tmdb.enabled) steps.push({ id: 'tmdb', run: refreshTmdb });
    if (ctx.trakt.enabled && (await ctx.trakt.isConnected())) {
      steps.push({
        id: 'trakt',
        run: async () => {
          await ctx.trakt.flush();
          await ctx.syncLog.track('trakt', (signal) => ctx.watch.importFromTrakt({ signal }));
        },
      });
    }
    steps.push({ id: 'genres', run: () => ctx.genres.backfill() });
    const skipped = new Set();
    const ends = steps.map((step) => ctx.operations.start(step.id, { queued: true, cancel: () => skipped.add(step.id) }));
    try {
      for (const step of steps) {
        if (!skipped.has(step.id)) await step.run();
      }
      toast(t('settings.metaDone'));
    } catch (err) {
      log.warn('Metadata update failed', err && err.message);
    } finally {
      ends.forEach((end) => end());
      metaBusy = false;
      metaPanel.button.classList.remove('disabled');
      metaPanel.refresh().catch(() => undefined);
      devicePanel.refresh().catch(() => undefined);
    }
  }

  const tmdbOn = ctx.tmdb && ctx.tmdb.enabled;
  const traktOn = ctx.trakt.enabled;

  const tmdbRows = tmdbOn
    ? [
        actionRow({
          ctx,
          label: t('settings.tmdbSync'),
          run: async () => {
            toast(t('settings.working'), 8000);
            toast(t('settings.tmdbSyncDone', { count: await refreshTmdb() }));
            ctx.genres.backfill().catch(() => undefined); // genres of the rest of the catalog, in background
          },
        }),
        actionRow({ ctx, label: t('settings.tmdbRemove'), confirm: t('settings.tmdbRemoveConfirm'), run: async () => { await ctx.tmdb.clearAll(); await ctx.genres.clearTmdb(); toast(t('settings.removed')); } }),
      ]
    : [];

  const traktRows = traktOn
    ? [
        actionRow({
          ctx,
          label: t('settings.traktSync'),
          run: async () => {
            if (!(await ctx.trakt.isConnected())) {
              toast(t('settings.traktNeedLogin'));
              return;
            }
            toast(t('settings.working'), 15000);
            await ctx.trakt.flush();
            toast(t('settings.traktSyncDone', { count: await ctx.syncLog.track('trakt', (signal) => ctx.watch.importFromTrakt({ signal })) }));
          },
        }),
        actionRow({
          ctx,
          label: t('settings.traktRemove'),
          confirm: t('settings.traktRemoveConfirm'),
          run: async () => {
            await ctx.trakt.disconnect();
            await ctx.watch.removeTraktData();
            toast(t('settings.removed'));
            ctx.router.reload();
          },
        }),
      ]
    : [];

  const diagnostics = { el: h('div', { class: 'row' }, h('span', { text: t('settings.diagnostics') })), refresh: async () => undefined, activate: async () => ctx.router.push('diagnostics') };

  // Catalog and metadata tables at the top; the "update the catalog" button is the first row of the list.
  const panel = createSyncPanel(ctx);
  const metaPanel = createMetaPanel(ctx);
  const devicePanel = createDevicePanel();
  const opsPanel = createOperationsPanel(ctx);
  let metaBusy = false;
  const syncRow = { el: panel.button, refresh: async () => undefined, activate: async () => panel.syncNow() };
  const metaRow = { el: metaPanel.button, refresh: async () => undefined, activate: updateMetadata };
  const prefsTitle = h('h2', { class: 'prefs-title', text: t('settings.preferences') });

  const rows = [
    syncRow,
    metaRow,
    optionRow({ ctx, labelKey: 'settings.language', key: 'language', options: LANGUAGE_OPTIONS, format: language }),
    optionRow({ ctx, labelKey: 'settings.gridItems', key: 'gridItems', options: GRID_OPTIONS }),
    optionRow({ ctx, labelKey: 'settings.carouselItems', key: 'carouselItems', options: CAROUSEL_OPTIONS }),
    optionRow({ ctx, labelKey: 'settings.buffer', key: 'bufferSeconds', options: BUFFER_OPTIONS, format: seconds }),
    autoplay,
    optionRow({ ctx, labelKey: 'settings.suggestionSource', key: 'suggestionSource', options: SUGGESTION_SOURCE_OPTIONS, format: (v) => (v === 'trakt' ? 'Trakt' : 'TMDB') }),
    textRow({ ctx, label: t('settings.tmdbKey'), field: 'tmdbKey' }),
    tmdbRow,
    ...tmdbRows,
    textRow({ ctx, label: t('settings.traktId'), field: 'traktId' }),
    textRow({ ctx, label: t('settings.traktSecret'), field: 'traktSecret', secret: true }),
    trakt,
    ...traktRows,
    diagnostics,
  ];
  rows.forEach((row) => row.refresh());

  // Stop buttons of the running operations come first, then the fixed rows; the list changes while the page is open.
  const all = () => opsPanel.rows.concat(rows);
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
    el: h('section', { class: 'page framed' }, h('div', { class: 'page-container' }, h('h1', { text: t('settings.title') }), opsPanel.el, panel.el, metaPanel.el, devicePanel.el, prefsTitle, h('div', { class: 'list' }, rows.slice(2).map((r) => r.el)))),
    mount() {
      opsPanel.mount();
      metaPanel.mount();
      panel.mount();
      ctx.providers.getActive().then((provider) => {
        const id = provider && provider.id;
        panel.setProviderName(provider ? provider.name : '');
        panel.el.style.display = id ? '' : 'none';
        syncRow.el.style.display = id ? '' : 'none';
        if (id) panel.setProvider(id);
      });
      metaPanel.refresh().catch(() => undefined);
      devicePanel.refresh().catch(() => undefined);
      ctx.focus.register(zone);
      ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
      ctx.focus.focus(ZONE_ID, opsPanel.rows.length); // never on a stop button by accident
    },
    destroy() {
      opsPanel.destroy();
      metaPanel.destroy();
      panel.destroy();
      ctx.focus.unregister(ZONE_ID);
    },
    saveState: () => ({ index: zone.index }),
    restoreState(state) {
      ctx.focus.focus(ZONE_ID, state.index);
    },
  };
}
