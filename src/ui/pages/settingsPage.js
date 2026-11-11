import { createCodePrompt } from '../components/codePrompt.js';
import { resetApp } from '../../services/resetApp.js';
import { clearDerived } from '../../services/derivedStore.js';
import { removeCatalogType } from '../../services/catalogSync.js';
import { DERIVED_STORES } from '../../services/dbSize.js';
import { Priority } from '../../services/backgroundQueue.js';
import { transactionDone, dbDelete } from '../../core/idb.js';
import { GENRES_SOURCE_KEY } from '../../services/genreBackfill.js';
import { h } from '../dom.js';
import { createListRow, createRowValue } from '../atoms/listRow.js';
import { createToggle, setToggle } from '../atoms/toggle.js';
import { createHeading } from '../atoms/heading.js';
import { createHint } from '../atoms/hint.js';
import { changePin } from '../components/pinFlows.js';
import { TEXT_SIZES, applyTextSize } from '../../core/textSize.js';
import { TIME_FORMATS, DATE_FORMATS, formatClockTime, formatClockDate } from '../../core/clock.js';
import { t, i18n, detectLocale } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { Dir } from '../focus/models.js';
import { LANGUAGE_OPTIONS, BUFFER_OPTIONS, SCREENSAVER_OPTIONS, SUGGESTION_SOURCE_OPTIONS, isEpgUrl } from '../../services/settings.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createSyncPanel, createTmdbPanel, createTraktPanel, createDevicePanel, createOperationsPanel } from '../components/syncPanel.js';
import { log } from '../../core/logger.js';
import { probeGuide } from '../../services/epgSync.js';
import { rebuildLive } from '../../services/rebuildLive.js';
import { parseTerms, termsText } from '../../services/liveGrouping.js';
import { DEFAULT_SIMILARITY, DEFAULT_MAX_DIFF } from '../../services/liveNetworks.js';
import { createField } from '../atoms/field.js';
import { framedPage } from '../components/formPage.js';
import { runningVersions, lastCheck } from '../../services/updates.js';
import { providerMediaTypes } from '../../services/providerTypes.js';
import { APP_VERSION } from '../../core/env.js';
import { formatDateTime } from '../../core/format.js';

const ZONE_ID = 'settings';

/** An editable text value (API keys) as a Field. OK opens the on-screen keyboard; Done saves. */
export function textRow({ label, field, secret = false, ctx }) {
  let input = null;
  const show = () => {
    input.setValue(ctx.apiKeys.getStored(field));
  };
  const save = (value) => {
    const before = ctx.apiKeys.getStored(field);
    ctx.apiKeys.set({ [field]: value }).then(() => {
      ctx.notices.success(t('notice.saved'));
      // A new TMDB key starts the first metadata run at once (genres and TMDB data of what was watched).
      if (field === 'tmdbKey' && value.trim() && value.trim() !== before && ctx.genres) {
        // A provider genre search running now is stopped: TMDB's genres replace the provider's, so its download goes first.
        ctx.genres
          .forgetMisses()
          .then(() => ctx.genres.restart())
          .catch(() => undefined);
      }
      ctx.router.reload(); // rows that depend on the keys appear or disappear
    });
  };
  input = createField({ label, type: secret ? 'password' : 'text', placeholder: '—', onSubmit: save, onCancel: show });
  const row = { el: input.el, root: input.root, refresh: async () => show(), activate: async () => input.focus() };
  row.clearRow = clearRowOf(input);
  return row;
}

/** The "x" of a text field as a row at its right (Right from the field): OK empties the field (or puts its default back) and saves it. */
export function clearRowOf(field) {
  return { secondary: 'right', el: field.clearEl, refresh: async () => undefined, activate: async () => field.clear() };
}

/** A row that runs an action (optionally after a confirmation). */
export function actionRow({ label, run, confirm = null, ctx }) {
  return {
    el: createListRow({ label: label }).el,
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
  const value = createRowValue();
  const el = createListRow({ label: t(labelKey), valueEl: value }).el;
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


export function createSettingsPage(ctx) {
  const language = (v) => (v === 'auto' ? t('settings.language.auto') : v);
  const seconds = (v) => `${v} s`;
  const now = new Date();
  const timeName = (v) => (v === 'auto' ? t('settings.format.auto') : `${v === '12h' ? t('settings.time.12h') : t('settings.time.24h')} (${formatClockTime(now, v, i18n.getLocale())})`);
  const dateName = (v) => (v === 'auto' ? t('settings.format.auto') : `${t(`settings.date.${v}`)} (${formatClockDate(now, v, i18n.getLocale())})`);

  const autoplayValue = createToggle();
  const autoplay = {
    el: createListRow({ label: t('settings.autoplayNext'), valueEl: autoplayValue }).el,
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

  /** Runs the metadata steps asked (`tmdb`: download, `genres`: provider genre search), each listed as queued and running in turn. */
  async function runMetadata(ids) {
    if (metaBusy) return;
    metaBusy = true;
    [tmdbPanel.tmdbButtons.refresh, tmdbPanel.genreButtons.refresh].forEach((b) => b.classList.add('disabled'));
    const steps = [];
    if (ids.includes('tmdb') && ctx.tmdb && ctx.tmdb.enabled) steps.push({ id: 'tmdb', run: () => ctx.genres.download() });
    // Genres: with TMDB they are written again from its saved metadata (no request); without, the provider is asked (slowly).
    if (ids.includes('genres')) steps.push({ id: 'genres', run: () => (ctx.tmdb && ctx.tmdb.enabled ? ctx.genres.restore() : ctx.genres.findGenres()) });
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
      [tmdbPanel.tmdbButtons.refresh, tmdbPanel.genreButtons.refresh].forEach((b) => b.classList.remove('disabled'));
      tmdbPanel.refresh().catch(() => undefined);
      devicePanel.refresh().catch(() => undefined);
    }
  }

  const diagnostics = { el: createListRow({ label: t('settings.diagnostics') }).el, refresh: async () => undefined, activate: async () => ctx.router.push('diagnostics') };

  // Catalog and metadata tables at the top; the "update the catalog" button is the first row of the list.
  const panel = createSyncPanel(ctx);
  const tmdbPanel = createTmdbPanel(ctx);
  const traktPanel = createTraktPanel(ctx);
  const devicePanel = createDevicePanel(ctx);
  const opsPanel = createOperationsPanel(ctx);
  let metaBusy = false;
  const typeName = (type) => t({ movie: 'nav.movies', series: 'nav.series', live: 'nav.live' }[type]);
  const rowOf = (el, activate, secondary = null) => ({ el, ...(secondary ? { secondary } : {}), refresh: async () => undefined, activate });
  const confirmRemove = (title, message) => ctx.dialogs.confirm({ title, message, confirmLabel: t('settings.confirmRemove'), cancelLabel: t('setup.cancel') });

  // Catalog table: one remove / update pair per media type.
  async function removeType(type) {
    const ok = await confirmRemove(t('settings.typeRemove', { type: typeName(type) }), t('settings.typeRemoveConfirm', { type: typeName(type) }));
    if (!ok) return;
    const current = await ctx.active.get();
    if (!current) return;
    ctx.genres.stop();
    ctx.catalog.cancel();
    await removeCatalogType(current.db, type);
    ctx.catalogChanged();
    ctx.notices.success(t('notice.removed'));
    panel.refreshStatus().catch(() => undefined);
    devicePanel.refresh().catch(() => undefined);
  }
  // Every update goes through the job queue: asked while something runs, it waits its turn (listed as queued).
  const queueJob = (key, label, run) => {
    if (!ctx.jobs.add(key, label, run)) ctx.notices.info(t('operations.alreadyQueued'), { key: 'queued' });
  };
  const catalogRows = panel.rowButtons.flatMap((b) => [
    rowOf(b.refresh, async () => queueJob(`catalog:${b.type}`, `${t('operations.catalog')} · ${typeName(b.type)}`, () => ctx.catalog.start({ force: true, types: [b.type], rewrite: true }))),
    rowOf(b.remove, () => removeType(b.type), 'left'),
  ]);
  // Guide row: download again now (it is otherwise downloaded once a day, after the other start-up work), or delete it.
  async function removeEpg() {
    if (!(await confirmRemove(t('settings.epgRemove'), t('settings.epgRemoveConfirm')))) return;
    await ctx.epg.clear();
    ctx.notices.success(t('notice.removed'));
    panel.refreshEpg().catch(() => undefined);
    devicePanel.refresh().catch(() => undefined);
  }
  if (ctx.epg) {
    catalogRows.push(
      rowOf(panel.epgButtons.refresh, async () => ctx.epg.maybeSync({ force: true }).catch(() => undefined)),
      rowOf(panel.epgButtons.remove, () => removeEpg(), 'left'),
    );
  }

  // TMDB table: metadata download and genre search.
  async function removeMetadata() {
    if (!(await confirmRemove(t('settings.metaRemove'), t('settings.metaRemoveConfirm')))) return;
    ctx.genres.stop();
    await ctx.tmdb.clearAll();
    await ctx.genres.clearTmdb();
    await ctx.syncLog.clear('tmdb');
    ctx.notices.success(t('notice.removed'));
    tmdbPanel.refresh().catch(() => undefined);
  }
  async function removeGenres() {
    if (!(await confirmRemove(t('settings.genresRemove'), t('settings.genresRemoveConfirm')))) return;
    ctx.genres.stop();
    await ctx.genres.clearTmdb();
    await ctx.syncLog.clear('genres');
    ctx.catalogChanged();
    ctx.notices.success(t('notice.removed'));
    tmdbPanel.refresh().catch(() => undefined);
  }
  const tmdbRows = [
    rowOf(tmdbPanel.tmdbButtons.refresh, async () => queueJob('tmdb', t('operations.tmdb'), () => runMetadata(['tmdb']))),
    rowOf(tmdbPanel.tmdbButtons.remove, removeMetadata, 'left'),
    rowOf(tmdbPanel.genreButtons.refresh, async () => queueJob('genres', t('operations.genres'), () => runMetadata(['genres']))),
    rowOf(tmdbPanel.genreButtons.remove, removeGenres, 'left'),
  ];
  const dbUpdateRow = {
    el: devicePanel.updateButton,
    refresh: async () => undefined,
    activate: async () =>
      queueJob('rebuild', t('operations.rebuild'), async () => {
        await ctx.rebuildCatalog(['movie', 'series', 'live']); // in the catalog worker
        await ctx.genres.restore().catch(() => undefined); // the genres come back from the saved TMDB metadata, not from the network
        ctx.catalogChanged();
        ctx.notices.success(t('notice.dbRebuilt'));
        devicePanel.refresh().catch(() => undefined);
      }),
  };
  const dbRemoveRow = {
    secondary: 'left',
    el: devicePanel.removeButton,
    refresh: async () => undefined,
    async activate() {
      if (!(await confirmRemove(t('settings.dbRemove'), t('settings.dbRemoveConfirm')))) return;
      queueJob('empty', t('settings.dbRemove'), emptyDerived);
    },
  };
  /** Empties what is worked out from the catalog and builds it again (queued like every update). */
  async function emptyDerived() {
    const current = await ctx.active.get();
    if (!current) return;
    // The downloaded catalog (lists, categories, details) stays: what is worked out from it is emptied and built again, with no download.
    const tx = current.db.transaction(DERIVED_STORES, 'readwrite');
    DERIVED_STORES.forEach((name) => tx.objectStore(name).clear());
    await transactionDone(tx);
    await clearDerived(current.db);
    await dbDelete(current.db, 'meta', GENRES_SOURCE_KEY); // the provider's genres come back with the rebuild, then TMDB's replace them
    log.info('Derived data emptied by the user (entries, groups, genres, search index, sidebar)');
    await ctx.rebuildCatalog(['movie', 'series', 'live']); // in the catalog worker
    await ctx.genres.restore().catch(() => undefined);
    ctx.catalogChanged();
    ctx.notices.success(t('notice.removed'));
    if (ctx.queue) ctx.queue.add({ name: 'genres', priority: Priority.METADATA, run: () => ctx.genres.backfill().catch(() => undefined) });
    devicePanel.refresh().catch(() => undefined);
  }
  const traktConnectRow = { el: traktPanel.connectButton, refresh: async () => undefined, activate: connectTrakt };
  const traktSyncRow = { el: traktPanel.syncButton, refresh: async () => undefined, activate: syncTrakt };
  const traktRemoveRow = { secondary: 'left', el: traktPanel.removeButton, refresh: async () => undefined, activate: removeTrakt };
  const tmdbTokenRow = textRow({ ctx, label: t('settings.tmdbKey'), field: 'tmdbKey' });
  const traktIdRow = textRow({ ctx, label: t('settings.traktId'), field: 'traktId' });
  const traktSecretRow = textRow({ ctx, label: t('settings.traktSecret'), field: 'traktSecret', secret: true });
  const openSubtitlesRow = textRow({ ctx, label: t('settings.openSubtitlesKey'), field: 'openSubtitlesKey', secret: true });

  const pinValue = createRowValue();
  const pinRow = {
    el: createListRow({ label: t('parental.enterPin'), valueEl: pinValue }).el,
    refresh: () => ctx.parental.hasPin().then((has) => { pinValue.textContent = has ? '••••' : t('parental.notSet'); }),
    async activate() {
      await changePin({ dialogs: ctx.dialogs, parental: ctx.parental, notices: ctx.notices });
      await pinRow.refresh();
    },
  };

  // Clean titles: year in brackets, [tags] and language prefixes taken out of movie / series names; changing it rebuilds the titles.
  const cleanValue = createToggle();
  const cleanTitlesRow = {
    el: createListRow({ label: t('settings.cleanTitles'), valueEl: cleanValue }).el,
    refresh: () => ctx.settings.get().then((s) => { setToggle(cleanValue, s.cleanTitles); }),
    async activate() {
      const s = await ctx.settings.get();
      const next = await ctx.settings.update({ cleanTitles: !s.cleanTitles });
      setToggle(cleanValue, next.cleanTitles);
      await ctx.rebuildCatalog(['movie', 'series']); // in the catalog worker
    },
  };

  const groupingValue = createToggle();
  const liveGrouping = {
    el: createListRow({ label: t('settings.liveGrouping'), valueEl: groupingValue }).el,
    refresh: () => ctx.settings.get().then((s) => { setToggle(groupingValue, s.liveGrouping); }),
    async activate() {
      const s = await ctx.settings.get();
      const next = await ctx.settings.update({ liveGrouping: !s.liveGrouping });
      setToggle(groupingValue, next.liveGrouping);
      await regroup();
    },
  };

  const networksValue = createToggle();
  const liveNetworks = {
    el: createListRow({ label: t('settings.liveNetworks'), valueEl: networksValue }).el,
    refresh: () => ctx.settings.get().then((s) => { setToggle(networksValue, s.liveNetworks); }),
    async activate() {
      const s = await ctx.settings.get();
      const next = await ctx.settings.update({ liveNetworks: !s.liveNetworks });
      setToggle(networksValue, next.liveNetworks);
      await regroup();
    },
  };

  // Numbers left out when comparing names for networks: "Dazn 11 Serie B" and "Dazn 12 Serie B" end in one network.
  const ignoreNumbersValue = createToggle();
  const ignoreNumbersRow = {
    el: createListRow({ label: t('settings.liveNetworkIgnoreNumbers'), valueEl: ignoreNumbersValue }).el,
    refresh: () => ctx.settings.get().then((s) => { setToggle(ignoreNumbersValue, s.liveNetworkIgnoreNumbers); }),
    async activate() {
      const s = await ctx.settings.get();
      const next = await ctx.settings.update({ liveNetworkIgnoreNumbers: !s.liveNetworkIgnoreNumbers });
      setToggle(ignoreNumbersValue, next.liveNetworkIgnoreNumbers);
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

  // Words removed from channel names (added to the built-in ones): the x empties the field, which means only the built-in words.
  const showPatterns = () => ctx.settings.get().then((s) => { patternsField.setValue(s.liveGroupPatterns); });
  const patternsField = createField({
    label: t('settings.liveGroupPatterns'),
    placeholder: t('settings.liveGroupPlaceholder'),
    onSubmit: (value) => ctx.settings.update({ liveGroupPatterns: termsText(parseTerms(value)) }).then(showPatterns).then(regroup),
    onCancel: showPatterns,
  });
  const patternsRow = { el: patternsField.el, root: patternsField.root, refresh: showPatterns, activate: async () => patternsField.focus() };
  const patternsClearRow = clearRowOf(patternsField);

  // Custom EPG: saved only when it is an http(s) address that answers with an XMLTV guide; empty goes back to the provider's guide.
  const showEpg = () => ctx.settings.get().then((st) => { epgField.setValue(st.customEpgUrl); });
  const epgField = createField({
    label: t('settings.customEpg'),
    placeholder: t('settings.customEpgPlaceholder'),
    inputmode: 'url',
    onCancel: showEpg,
    onSubmit: async (value) => {
      const url = value.trim();
      if (url && !(isEpgUrl(url) && (await probeGuide(url)))) {
        ctx.notices.error(t('settings.customEpgInvalid'), { key: 'setting' });
        await showEpg();
        return;
      }
      await ctx.settings.update({ customEpgUrl: url });
      ctx.notices.success(t('settings.customEpgSaved'), { key: 'setting' });
      if (ctx.epg) ctx.epg.maybeSync({ force: true }).catch(() => undefined);
    },
  });
  const epgRow = { el: epgField.el, root: epgField.root, refresh: showEpg, activate: async () => epgField.focus() };
  const epgClearRow = clearRowOf(epgField);

  /** A number field for a network setting; Enter saves and rebuilds Live TV. Its x puts the default value back (to confirm with Done). */
  function numberRows({ key, labelKey, fallback }) {
    const show = () => ctx.settings.get().then((s) => { field.setValue(s[key]); });
    const field = createField({
      label: t(labelKey),
      placeholder: String(fallback),
      inputmode: 'numeric',
      defaultValue: String(fallback),
      onSubmit: (value) => ctx.settings.update({ [key]: value.trim() }).then(show).then(regroup),
      onCancel: show,
    });
    return [
      { el: field.el, root: field.root, refresh: show, activate: async () => field.focus() },
      clearRowOf(field),
    ];
  }
  const [similarityRow, similarityClearRow] = numberRows({ key: 'liveNetworkSimilarity', labelKey: 'settings.liveNetworkSimilarity', fallback: DEFAULT_SIMILARITY });
  const [maxDiffRow, maxDiffClearRow] = numberRows({ key: 'liveNetworkMaxDiff', labelKey: 'settings.liveNetworkMaxDiff', fallback: DEFAULT_MAX_DIFF });

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
      // Everything about the app as a whole: language and look, clock, then playback, suggestions and the parental PIN.
      titleKey: 'settings.section.general',
      list: [
        optionRow({ ctx, labelKey: 'settings.language', key: 'language', options: LANGUAGE_OPTIONS, format: language }),
        optionRow({ ctx, labelKey: 'settings.textSize', key: 'textSize', options: TEXT_SIZES, format: (v) => `${v}%` }),
        optionRow({ ctx, labelKey: 'settings.timeFormat', key: 'timeFormat', options: TIME_FORMATS, format: timeName }),
        optionRow({ ctx, labelKey: 'settings.dateFormat', key: 'dateFormat', options: DATE_FORMATS, format: dateName }),
        optionRow({ ctx, labelKey: 'settings.screensaver', key: 'screensaver', options: SCREENSAVER_OPTIONS, format: (v) => (v ? t('settings.screensaver.minutes', { count: v }) : t('settings.screensaver.off')) }),
        optionRow({ ctx, labelKey: 'settings.buffer', key: 'bufferSeconds', options: BUFFER_OPTIONS, format: seconds }),
        optionRow({ ctx, labelKey: 'settings.suggestionSource', key: 'suggestionSource', options: SUGGESTION_SOURCE_OPTIONS, format: (v) => (v === 'trakt' ? 'Trakt' : 'TMDB') }),
        pinRow,
      ],
    },
    { titleKey: 'settings.section.vod', list: [cleanTitlesRow, autoplay] },
    {
      // Channels: their grouping by quality, the words removed from their names to compare them, the custom guide.
      titleKey: 'settings.section.live',
      parts: [{ list: [liveGrouping] }, { fields: [patternsRow, patternsClearRow] }, { fields: [epgRow, epgClearRow] }],
    },
    {
      // Networks: on / off, then how similar names must be; the toggle for the numbers sits right under the maximum difference.
      titleKey: 'settings.section.networks',
      parts: [{ list: [liveNetworks] }, { fields: [similarityRow, similarityClearRow, maxDiffRow, maxDiffClearRow] }, { list: [ignoreNumbersRow] }],
    },
    { titleKey: 'settings.section.advanced', list: [diagnostics, resetAll] },
  ];
  // A section is a list of rows and / or text fields, or `parts` of both in the order given.
  const partsOf = (section) => section.parts || [{ list: section.list, fields: section.fields }];
  const prefs = sections.flatMap((section) => partsOf(section).flatMap((part) => (part.list || []).concat(part.fields || [])));
  const prefsBlocks = sections.flatMap((section) => [
    createHeading({ text: t(section.titleKey), className: 'prefs-title' }),
    ...partsOf(section).flatMap((part) => [
      part.list ? h('div', { class: 'list' }, part.list.map((r) => r.el)) : null,
      part.fields ? h('div', { class: 'fields' }, part.fields.filter((r) => !r.secondary).map((r) => r.root)) : null,
    ]),
  ]);
  // Focus order follows the page: catalog, TMDB, Trakt, preferences.
  const rows = [...catalogRows, ...tmdbRows, tmdbTokenRow, tmdbTokenRow.clearRow, traktConnectRow, traktSyncRow, traktRemoveRow, traktIdRow, traktIdRow.clearRow, traktSecretRow, traktSecretRow.clearRow, openSubtitlesRow, openSubtitlesRow.clearRow, dbUpdateRow, dbRemoveRow, ...prefs];
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
    nodes: () => all().map((row) => row.el),
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

  // Under the title: one box per optional service that is off (TMDB, Trakt, OpenSubtitles), saying what it adds. A box goes away as soon
  // as its key is typed (or the Trakt account connected).
  const promos = (() => {
    const el = h('div', { class: 'service-promos' });
    const boxes = ['tmdb', 'trakt', 'opensubtitles'].map((id) => {
      const box = h('div', { class: `service-promo ${id}` }, createHeading({ level: 3, text: t(`settings.promo.${id}.title`) }), createHint({ text: t(`settings.promo.${id}.text`), muted: false }));
      el.appendChild(box);
      return { id, box };
    });
    const refresh = async () => {
      const keys = ctx.apiKeys.get();
      const traktOn = ctx.trakt && ctx.trakt.isConnected ? await ctx.trakt.isConnected().catch(() => false) : false;
      const on = { tmdb: Boolean(keys.tmdbKey), trakt: traktOn, opensubtitles: Boolean(keys.openSubtitlesKey) };
      boxes.forEach(({ id, box }) => {
        box.style.display = on[id] ? 'none' : '';
      });
      el.style.display = boxes.some(({ id }) => !on[id]) ? '' : 'none';
    };
    return { el, refresh };
  })();

  // Under the title, small: the version running; the packages that update themselves add when version.json last answered.
  const versions = runningVersions();
  const checked = lastCheck();
  const version = versions.bundle || APP_VERSION;
  const autoupdate = typeof __AUTOUPDATE__ !== 'undefined' && __AUTOUPDATE__;
  const versionText = !autoupdate ? `v${version}` : checked ? t('settings.versionLine', { version, time: formatDateTime(checked, i18n.getLocale()) }) : t('settings.versionNever', { version });
  const versionEl = createHint({ text: versionText, className: 'settings-version', muted: false });

  return {
    el: framedPage(createHeading({ level: 1, text: t('nav.settings'), className: 'settings-title' }), versionEl, promos.el, opsPanel.el, panel.el, tmdbPanel.el, h('div', { class: 'fields' }, tmdbTokenRow.root), traktPanel.el, h('div', { class: 'fields' }, traktIdRow.root, traktSecretRow.root), createHeading({ text: 'OpenSubtitles', className: 'prefs-title' }), h('div', { class: 'fields' }, openSubtitlesRow.root), devicePanel.el, prefsBlocks),
    mount() {
      opsPanel.mount();
      tmdbPanel.mount();
      traktPanel.mount();
      panel.mount();
      ctx.providers.getActive().then((provider) => {
        const id = provider && provider.id;
        panel.setProviderName(provider ? provider.name : '');
        panel.setTypes(providerMediaTypes(provider));
        panel.el.style.display = id ? '' : 'none';
        catalogRows.forEach((row) => { row.el.style.display = id ? '' : 'none'; });
        // The update / remove buttons of a type the provider does not have (a playlist's series) are hidden with its row.
        panel.rowButtons.forEach((b) => {
          if (!provider || providerMediaTypes(provider).indexOf(b.type) >= 0) return;
          b.refresh.style.display = 'none';
          b.remove.style.display = 'none';
        });
        if (id) panel.setProvider(id);
      });
      promos.refresh().catch(() => undefined);
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
