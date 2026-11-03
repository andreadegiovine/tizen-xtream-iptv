import { h, toast } from '../dom.js';
import { t, i18n, detectLocale } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { LANGUAGE_OPTIONS, GRID_OPTIONS, CAROUSEL_OPTIONS, BUFFER_OPTIONS, SUGGESTION_SOURCE_OPTIONS } from '../../services/settings.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createSyncPanel, createMetaPanel } from '../components/syncPanel.js';
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
      ctx.apiKeys.set({ [field]: input.value }).then(() => {
        toast(t('settings.saved'));
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

  const categories = { el: h('div', { class: 'row' }, h('span', { text: t('settings.categories') })), refresh: async () => undefined, activate: async () => ctx.router.push('categories', { section: 'settings' }) };

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
      if (connected) ctx.syncLog.track('trakt', () => ctx.watch.importFromTrakt()).catch((err) => log.warn('Trakt import failed', err && err.message));
      await trakt.refresh();
    },
  };

  const tmdbOn = ctx.tmdb && ctx.tmdb.enabled;
  const traktOn = ctx.trakt.enabled;

  const tmdbRows = tmdbOn
    ? [
        actionRow({
          ctx,
          label: t('settings.tmdbSync'),
          run: async () => {
            toast(t('settings.working'), 8000);
            const items = [];
            (await ctx.watch.seeds(30)).forEach((seed) => items.push({ type: seed.type, tmdbId: seed.tmdbId }));
            const current = await ctx.active.get();
            if (current) {
              for (const fav of await ctx.favorites.list(current.provider.id)) {
                const match = /^(movie|series):t(\d+)$/.exec(fav.entryKey);
                if (match) items.push({ type: match[1], tmdbId: Number(match[2]) });
              }
            }
            toast(t('settings.tmdbSyncDone', { count: await ctx.syncLog.track('tmdb', () => ctx.tmdb.refresh(items)) }));
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
            toast(t('settings.traktSyncDone', { count: await ctx.syncLog.track('trakt', () => ctx.watch.importFromTrakt()) }));
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
  const syncRow = { el: panel.button, refresh: async () => undefined, activate: async () => panel.syncNow() };

  const rows = [
    syncRow,
    optionRow({ ctx, labelKey: 'settings.language', key: 'language', options: LANGUAGE_OPTIONS, format: language }),
    optionRow({ ctx, labelKey: 'settings.gridItems', key: 'gridItems', options: GRID_OPTIONS }),
    optionRow({ ctx, labelKey: 'settings.carouselItems', key: 'carouselItems', options: CAROUSEL_OPTIONS }),
    optionRow({ ctx, labelKey: 'settings.buffer', key: 'bufferSeconds', options: BUFFER_OPTIONS, format: seconds }),
    autoplay,
    categories,
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

  const zone = new FocusZone({
    id: ZONE_ID,
    model: new ListModel({ orientation: 'vertical', getCount: () => rows.length }),
    onFocus: (i) => {
      rows[i].el.classList.add('focused');
      ensureVisible(rows[i].el, { first: i === 0 });
    },
    onBlur: (i) => rows[i].el.classList.remove('focused'),
    onActivate: (i) => {
      rows[i].activate().catch((err) => log.warn('Setting failed', err && err.message));
    },
  });

  return {
    el: h('section', { class: 'page' }, h('h1', { text: t('settings.title') }), panel.el, metaPanel.el, h('div', { class: 'list' }, rows.map((r) => r.el))),
    mount() {
      panel.mount();
      ctx.providers.getActiveId().then((id) => {
        panel.el.style.display = id ? '' : 'none';
        syncRow.el.style.display = id ? '' : 'none';
        if (id) panel.setProvider(id);
      });
      metaPanel.refresh().catch(() => undefined);
      ctx.focus.register(zone);
      ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
      ctx.focus.focus(ZONE_ID, 0);
    },
    destroy() {
      panel.destroy();
      ctx.focus.unregister(ZONE_ID);
    },
    saveState: () => ({ index: zone.index }),
    restoreState(state) {
      ctx.focus.focus(ZONE_ID, state.index);
    },
  };
}
