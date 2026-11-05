import { createCodePrompt } from '../components/codePrompt.js';
import { resetApp } from '../../services/resetApp.js';
import { h } from '../dom.js';
import { changePin } from '../components/pinFlows.js';
import { TEXT_SIZES, applyTextSize } from '../../core/textSize.js';
import { TIME_FORMATS, DATE_FORMATS, formatClockTime, formatClockDate } from '../../core/clock.js';
import { t, i18n, detectLocale } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { Dir } from '../focus/models.js';
import { LANGUAGE_OPTIONS, GRID_OPTIONS, CAROUSEL_OPTIONS, BUFFER_OPTIONS, SCREENSAVER_OPTIONS, SUGGESTION_SOURCE_OPTIONS } from '../../services/settings.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createSyncPanel, createTmdbPanel, createTraktPanel, createDevicePanel, createOperationsPanel } from '../components/syncPanel.js';
import { log } from '../../core/logger.js';
import { rebuildEntries } from '../../services/catalogSync.js';
import { rebuildLive } from '../../services/rebuildLive.js';
import { parseTerms, termsText } from '../../services/liveGrouping.js';
import { DEFAULT_SIMILARITY, DEFAULT_MAX_DIFF } from '../../services/liveNetworks.js';
import { icon } from '../icons.js';
import { createField } from '../components/field.js';
import { framedPage } from '../components/formPage.js';

const ZONE_ID = 'settings';

/** An editable text value (API keys) as a Field. OK opens the on-screen keyboard; Done saves. */
export function textRow({ label, field, secret = false, ctx }) {
  let input = null;
  const show = () => {
    input.setValue(ctx.apiKeys.getStored(field));
  };
  const save = (value) => {
    const before = ctx.apiKeys.getStored(field);
    const titlesChange = field === 'tmdbKey' && Boolean(before.trim()) !== Boolean(value.trim());
    ctx.apiKeys.set({ [field]: value }).then(() => (titlesChange ? rebuildTitles(ctx) : undefined)).then(() => {
      ctx.notices.success(t('notice.saved'));
      // A new TMDB key starts the first metadata run at once (genres and TMDB data of what was watched).
      if (field === 'tmdbKey' && value.trim() && value.trim() !== before && ctx.genres) {
        ctx.genres
          .forgetMisses()
          .then(() => ctx.genres.backfill())
          .catch(() => undefined);
      }
      ctx.router.reload(); // rows that depend on the keys appear or disappear
    });
  };
  input = createField({ label, type: secret ? 'password' : 'text', placeholder: '—', onSubmit: save, onCancel: show });
  return { el: input.el, root: input.root, refresh: async () => show(), activate: async () => input.focus() };
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
    ctx.catalogChanged();
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
      if (key === 'textSize') applyTextSize(chosen);
      if (key === 'screensaver' && ctx.screensaver) ctx.screensaver.setMinutes(chosen);
      if (key === 'language') i18n.setLocale(chosen === 'auto' ? detectLocale(navigator.language) : chosen);
      if ((key === 'timeFormat' || key === 'dateFormat') && ctx.refreshClock) ctx.refreshClock();
      ctx.notices.success(t('notice.saved'), { key: 'setting' });
    },
  };
}

/** On/off switch shown at the right of a settings row. */
function toggle() {
  return h('span', { class: 'toggle', role: 'switch', 'aria-checked': 'false' }, h('span', { class: 'toggle-knob' }));
}

function setToggle(el, on) {
  el.classList.toggle('on', Boolean(on));
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

export function createSettingsPage(ctx) {
  const language = (v) => (v === 'auto' ? t('settings.language.auto') : v);
  const seconds = (v) => `${v} s`;
  const now = new Date();
  const timeName = (v) => (v === 'auto' ? t('settings.format.auto') : `${v === '12h' ? t('settings.time.12h') : t('settings.time.24h')} (${formatClockTime(now, v)})`);
  const dateName = (v) => (v === 'auto' ? t('settings.format.auto') : `${t(`settings.date.${v}`)} (${formatClockDate(now, v)})`);

  const autoplayValue = toggle();
  const autoplay = {
    el: h('div', { class: 'row' }, h('span', { text: t('settings.autoplayNext') }), autoplayValue),
    refresh: () => ctx.settings.get().then((s) => { setToggle(autoplayValue, s.autoplayNext); }),
    async activate() {
      const s = await ctx.settings.get();
      const next = await ctx.settings.update({ autoplayNext: !s.autoplayNext });
      setToggle(autoplayValue, next.autoplayNext);
      ctx.notices.success(t('notice.saved'), { key: 'setting' });
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
    ctx.notices.success(t('notice.removed'));
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
    secondary: 'left',
    el: tmdbPanel.removeButton,
    refresh: async () => undefined,
    async activate() {
      const ok = await ctx.dialogs.confirm({ title: t('settings.metaRemove'), message: t('settings.metaRemoveConfirm'), confirmLabel: t('settings.confirmRemove'), cancelLabel: t('setup.cancel') });
      if (!ok) return;
      ctx.genres.stop();
      await ctx.tmdb.clearAll();
      await ctx.genres.clearTmdb();
      await ctx.syncLog.clear('tmdb');
      ctx.notices.success(t('notice.removed'));
      tmdbPanel.refresh().catch(() => undefined);
    },
  };
  const traktConnectRow = { el: traktPanel.connectButton, refresh: async () => undefined, activate: connectTrakt };
  const traktSyncRow = { el: traktPanel.syncButton, refresh: async () => undefined, activate: syncTrakt };
  const traktRemoveRow = { secondary: 'left', el: traktPanel.removeButton, refresh: async () => undefined, activate: removeTrakt };
  const tmdbTokenRow = textRow({ ctx, label: t('settings.tmdbKey'), field: 'tmdbKey' });
  const traktIdRow = textRow({ ctx, label: t('settings.traktId'), field: 'traktId' });
  const traktSecretRow = textRow({ ctx, label: t('settings.traktSecret'), field: 'traktSecret', secret: true });

  const pinValue = h('span', { class: 'value' });
  const pinRow = {
    el: h('div', { class: 'row' }, h('span', { text: t('parental.enterPin') }), pinValue),
    refresh: () => ctx.parental.hasPin().then((has) => { pinValue.textContent = has ? '••••' : t('parental.notSet'); }),
    async activate() {
      await changePin({ dialogs: ctx.dialogs, parental: ctx.parental, notices: ctx.notices });
      await pinRow.refresh();
    },
  };

  const groupingValue = toggle();
  const liveGrouping = {
    el: h('div', { class: 'row' }, h('span', { text: t('settings.liveGrouping') }), groupingValue),
    refresh: () => ctx.settings.get().then((s) => { setToggle(groupingValue, s.liveGrouping); }),
    async activate() {
      const s = await ctx.settings.get();
      const next = await ctx.settings.update({ liveGrouping: !s.liveGrouping });
      setToggle(groupingValue, next.liveGrouping);
      await regroup();
    },
  };

  const networksValue = toggle();
  const liveNetworks = {
    el: h('div', { class: 'row' }, h('span', { text: t('settings.liveNetworks') }), networksValue),
    refresh: () => ctx.settings.get().then((s) => { setToggle(networksValue, s.liveNetworks); }),
    async activate() {
      const s = await ctx.settings.get();
      const next = await ctx.settings.update({ liveNetworks: !s.liveNetworks });
      setToggle(networksValue, next.liveNetworks);
      await regroup();
    },
  };

  /** Rebuilds Live TV with the grouping settings as they are now. */
  async function regroup() {
    try {
      await rebuildLive(ctx);
      ctx.notices.success(t('notice.saved'), { key: 'setting' });
    } catch (err) {
      log.warn('Regrouping failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'setting' });
    }
  }

  // Words removed from channel names: the field shows the defaults as its placeholder, the button at its right brings them back.
  const patternsReset = h('button', { class: 'btn danger icon-only row-reset', type: 'button', 'aria-label': t('settings.liveGroupReset'), title: t('settings.liveGroupReset') }, icon('remove'));
  const showPatterns = () => ctx.settings.get().then((s) => { patternsField.setValue(s.liveGroupPatterns); });
  const patternsField = createField({
    label: t('settings.liveGroupPatterns'),
    placeholder: t('settings.liveGroupPlaceholder'),
    trailing: patternsReset,
    onSubmit: (value) => ctx.settings.update({ liveGroupPatterns: termsText(parseTerms(value)) }).then(showPatterns).then(regroup),
    onCancel: showPatterns,
  });
  const patternsRow = { el: patternsField.el, root: patternsField.root, refresh: showPatterns, activate: async () => patternsField.focus() };
  const patternsResetRow = {
    secondary: 'right',
    el: patternsReset,
    refresh: async () => undefined,
    async activate() {
      await ctx.settings.update({ liveGroupPatterns: '' });
      await showPatterns();
      await regroup();
    },
  };

  /** A number field (with its reset button, a second row like the one of the words) for a network setting; Enter saves and rebuilds Live TV. */
  function numberRows({ key, labelKey, resetKey, fallback }) {
    const reset = h('button', { class: 'btn danger icon-only row-reset', type: 'button', 'aria-label': t(resetKey), title: t(resetKey) }, icon('remove'));
    const show = () => ctx.settings.get().then((s) => { field.setValue(s[key]); });
    const field = createField({
      label: t(labelKey),
      placeholder: String(fallback),
      inputmode: 'numeric',
      trailing: reset,
      onSubmit: (value) => ctx.settings.update({ [key]: value.trim() }).then(show).then(regroup),
      onCancel: show,
    });
    return [
      { el: field.el, root: field.root, refresh: show, activate: async () => field.focus() },
      {
        secondary: 'right',
        el: reset,
        refresh: async () => undefined,
        async activate() {
          await ctx.settings.update({ [key]: fallback });
          await show();
          await regroup();
        },
      },
    ];
  }
  const [similarityRow, similarityResetRow] = numberRows({ key: 'liveNetworkSimilarity', labelKey: 'settings.liveNetworkSimilarity', resetKey: 'settings.liveNetworkReset', fallback: DEFAULT_SIMILARITY });
  const [maxDiffRow, maxDiffResetRow] = numberRows({ key: 'liveNetworkMaxDiff', labelKey: 'settings.liveNetworkMaxDiff', resetKey: 'settings.liveNetworkReset', fallback: DEFAULT_MAX_DIFF });

  const resetAll = actionRow({
    ctx,
    label: t('settings.resetAll'),
    confirm: t('settings.resetAllConfirm'),
    run: async () => {
      await resetApp({ db: ctx.db, providers: ctx.providers, stopWork: () => { ctx.genres.stop(); ctx.catalog.cancel(); }, storages: [localStorage, sessionStorage] });
      window.location.reload();
    },
  });
  // Preferences in sections, in the order of the page. `list`: rows of the usual list; `fields`: text fields (with their reset buttons).
  const sections = [
    {
      titleKey: 'settings.section.appearance',
      list: [
        optionRow({ ctx, labelKey: 'settings.language', key: 'language', options: LANGUAGE_OPTIONS, format: language }),
        optionRow({ ctx, labelKey: 'settings.textSize', key: 'textSize', options: TEXT_SIZES, format: (v) => `${v}%` }),
        optionRow({ ctx, labelKey: 'settings.gridItems', key: 'gridItems', options: GRID_OPTIONS }),
        optionRow({ ctx, labelKey: 'settings.carouselItems', key: 'carouselItems', options: CAROUSEL_OPTIONS }),
        optionRow({ ctx, labelKey: 'settings.timeFormat', key: 'timeFormat', options: TIME_FORMATS, format: timeName }),
        optionRow({ ctx, labelKey: 'settings.dateFormat', key: 'dateFormat', options: DATE_FORMATS, format: dateName }),
        optionRow({ ctx, labelKey: 'settings.screensaver', key: 'screensaver', options: SCREENSAVER_OPTIONS, format: (v) => (v ? t('settings.screensaver.minutes', { count: v }) : t('settings.screensaver.off')) }),
      ],
    },
    {
      titleKey: 'settings.section.playback',
      list: [optionRow({ ctx, labelKey: 'settings.buffer', key: 'bufferSeconds', options: BUFFER_OPTIONS, format: seconds }), autoplay],
    },
    {
      titleKey: 'settings.section.live',
      list: [liveGrouping, liveNetworks],
      fields: [similarityRow, similarityResetRow, maxDiffRow, maxDiffResetRow, patternsRow, patternsResetRow],
    },
    {
      titleKey: 'settings.section.content',
      list: [optionRow({ ctx, labelKey: 'settings.suggestionSource', key: 'suggestionSource', options: SUGGESTION_SOURCE_OPTIONS, format: (v) => (v === 'trakt' ? 'Trakt' : 'TMDB') }), pinRow],
    },
    { titleKey: 'settings.section.advanced', list: [diagnostics, resetAll] },
  ];
  const prefs = sections.flatMap((section) => (section.list || []).concat(section.fields || []));
  const prefsBlocks = sections.map((section) => [
    h('h2', { class: 'prefs-title', text: t(section.titleKey) }),
    section.list ? h('div', { class: 'list' }, section.list.map((r) => r.el)) : null,
    section.fields ? h('div', { class: 'fields' }, section.fields.filter((r) => !r.secondary).map((r) => r.root)) : null,
  ]);
  // Focus order follows the page: catalog, TMDB, Trakt, preferences.
  const rows = [syncRow, metaRow, metaRemoveRow, tmdbTokenRow, traktConnectRow, traktSyncRow, traktRemoveRow, traktIdRow, traktSecretRow, ...prefs];
  // The Trakt sync / remove buttons exist only while an account is connected.
  const visibleRows = () => rows.filter((row) => row.el.style.display !== 'none');
  rows.forEach((row) => row.refresh());

  // Stop buttons of the running operations come first, then the fixed rows; the list changes while the page is open.
  // Up / Down visit one control per line (the right-most button, or the field with a button at its right);
  // the controls at the left (`secondary: 'left'`) or at the right (`'right'`) of it are reached with Left / Right.
  const linesModel = (getRows) => ({
    getCount: () => getRows().length,
    navigate(dir, index) {
      const list = getRows();
      let from = index;
      while (from > 0 && list[from].secondary) from -= 1; // a side control belongs to the line of its main one
      const step = (d) => {
        for (let i = from + d; i >= 0 && i < list.length; i += d) if (!list[i].secondary) return { type: 'move', index: i };
        return { type: 'exit', dir };
      };
      if (dir === Dir.DOWN) return step(1);
      if (dir === Dir.UP) return step(-1);
      const next = list[index + 1];
      const here = list[index];
      if (dir === Dir.LEFT) {
        if (here.secondary === 'right') return { type: 'move', index: index - 1 };
        return next && next.secondary === 'left' ? { type: 'move', index: index + 1 } : { type: 'exit', dir };
      }
      if (dir === Dir.RIGHT) {
        if (here.secondary === 'left') return { type: 'move', index: index - 1 };
        return next && next.secondary === 'right' ? { type: 'move', index: index + 1 } : { type: 'exit', dir };
      }
      return { type: 'exit', dir };
    },
  });
  const all = () => opsPanel.rows.concat(visibleRows());
  let focusedEl = null;
  const zone = new FocusZone({
    id: ZONE_ID,
    model: linesModel(() => all()),
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
    el: framedPage(h('h1', { text: t('nav.settings') }), opsPanel.el, panel.el, tmdbPanel.el, h('div', { class: 'fields' }, tmdbTokenRow.root), traktPanel.el, h('div', { class: 'fields' }, traktIdRow.root, traktSecretRow.root), devicePanel.el, prefsBlocks),
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
