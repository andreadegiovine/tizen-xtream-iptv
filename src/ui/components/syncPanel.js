import { h } from '../dom.js';
import { createButton } from '../atoms/button.js';
import { createHint } from '../atoms/hint.js';
import { createPanel, createPanelButtons } from '../atoms/panel.js';
import { createTableRow, createTableStatus, createRowButtons } from '../atoms/tableRow.js';
import { t, i18n } from '../../i18n/index.js';
import { MediaType } from '../../services/mediaType.js';
import { formatNumber, formatDateTime, formatSeconds } from '../../core/format.js';
import { collectDeviceInfo, formatBytes } from '../../services/deviceInfo.js';
import { estimateStoresBytes, CATALOG_STORES, DERIVED_STORES } from '../../services/dbSize.js';

const TYPES = [MediaType.MOVIE, MediaType.SERIES, MediaType.LIVE];
const LABEL_KEY = { movie: 'nav.movies', series: 'nav.series', live: 'nav.live' };
const ACTIVE_PHASES = new Set(['queued', 'categories', 'download', 'write', 'entries', 'retry']);

/** Text for one media type: live progress while syncing, otherwise what the last sync stored. */
export function describeType(state, meta, locale) {
  const phase = (state && state.phase) || 'idle';
  if (phase === 'error') return t(`error.${state.code}`);
  if (phase === 'write') {
    return t('home.phase.write', { done: formatNumber(state.done, locale), total: formatNumber(state.total, locale) });
  }
  if (phase === 'queued') return t('common.queued');
  if (phase === 'retry') return t('home.phase.retry', { attempt: state.attempt, attempts: state.attempts });
  if (ACTIVE_PHASES.has(phase)) return t(`home.phase.${phase}`);
  if (!meta) return t('common.never');
  if ((meta.groupCount > 0 && meta.groupedCount !== undefined) || meta.networkCount > 0) {
    // Live TV: "5321 items · 683 groups (2219 channels) · 12 networks (840 channels) · updated …"
    const parts = [t('home.items', { items: formatNumber(meta.itemCount, locale) })];
    if (meta.groupCount > 0) parts.push(t('home.groups', { groups: formatNumber(meta.groupCount, locale), channels: formatNumber(meta.groupedCount, locale) }));
    if (meta.networkCount > 0) parts.push(t('home.networks', { networks: formatNumber(meta.networkCount, locale), channels: formatNumber(meta.networkedCount, locale) }));
    parts.push(t('home.updatedAt', { time: formatDateTime(meta.lastSync, locale) }));
    return parts.join(' · ');
  }
  return t('home.updated', {
    items: formatNumber(meta.itemCount, locale),
    entries: formatNumber(meta.entryCount, locale),
    time: formatDateTime(meta.lastSync, locale),
  });
}

/** The guide row: "18 250 programmes · 412 channels · 14 genres · valid until … · updated …" (or in progress / never). */
export function describeEpg(meta, running, locale) {
  if (running) return running.queued ? t('common.queued') : t('meta.running', { time: formatDateTime(running.startedAt, locale) });
  if (!meta || meta.skipped) return t('common.never');
  const parts = [t('epg.status.programmes', { count: formatNumber(meta.programmes || 0, locale) })];
  if (meta.guided !== undefined) parts.push(t('epg.status.channels', { count: formatNumber(meta.guided, locale) }));
  if (meta.genres) parts.push(t('epg.status.genres', { count: formatNumber(meta.genres, locale) }));
  if (meta.until) parts.push(t('epg.status.until', { time: formatDateTime(meta.until, locale) }));
  parts.push(t('home.updatedAt', { time: formatDateTime(meta.lastSync, locale) }));
  return parts.join(' · ');
}

/** The remove + refresh buttons at the end of a table row (labels are the aria-labels). */
function rowButtons(removeLabel, refreshLabel) {
  const remove = createButton({ label: removeLabel, icon: 'remove', variant: 'danger', iconOnly: true, className: 'panel-button', title: removeLabel });
  const refresh = createButton({ label: refreshLabel, icon: 'refresh', variant: 'primary', iconOnly: true, className: 'panel-button', title: refreshLabel });
  return { remove, refresh, el: createRowButtons(remove, refresh) };
}

/**
 * Catalog sync status (per type rows, engine, timings) and the manual "update now" button, for the
 * active provider. The page that hosts it owns the focus zone of `button`.
 */
export function createSyncPanel(ctx) {
  const rows = TYPES.map((type) => {
    const buttons = rowButtons(t('settings.typeRemove', { type: t(LABEL_KEY[type]) }), t('settings.typeUpdate', { type: t(LABEL_KEY[type]) }));
    const row = createTableRow({ name: t(LABEL_KEY[type]), buttons: buttons.el });
    return { type, status: row.status, buttons, el: row.el };
  });
  // The programme guide of the provider: what the last download holds, with its own update / remove buttons.
  const epgButtons = rowButtons(t('settings.epgRemove'), t('settings.epgUpdate'));
  const { el: epgRow, status: epgStatus } = createTableRow({ name: t('operations.epg'), buttons: epgButtons.el });
  let epgMeta = null;
  const epgRunning = () => (ctx.operations ? ctx.operations.list().find((op) => op.id === 'epg') || null : null);
  const renderEpg = () => {
    epgStatus.textContent = describeEpg(epgMeta, epgRunning(), i18n.getLocale());
  };
  const refreshEpg = () =>
    ctx.epg && ctx.epg.status
      ? ctx.epg.status().then((meta) => {
          epgMeta = meta;
          renderEpg();
        })
      : Promise.resolve();
  let wasEpgRunning = false;
  let stopEpg = null;
  const { el: engineRow, status: engineStatus } = createTableRow({ name: t('home.engine'), status: createTableStatus() });
  const { el: timingRow, status: timingStatus } = createTableRow({ name: t('home.syncTiming'), status: createTableStatus() });
  const info = createHint({ className: 'sync-info' });
  const providerName = h('span', { class: 'panel-provider' });
  const { el } = createPanel({ title: t('home.catalog'), titleExtra: providerName, rows: [rows.map((r) => r.el), epgRow, engineRow, timingRow], after: info });
  let persisted = {};
  let providerId = null;
  let wasRunning = false;
  let unsubscribe = null;

  function refreshPersisted() {
    if (!providerId) return Promise.resolve();
    return ctx.catalog.readStatus(providerId).then((status) => {
      persisted = status;
      render();
    });
  }

  function render() {
    const state = ctx.catalog.getState();
    const locale = i18n.getLocale();
    rows.forEach((row) => {
      row.status.textContent = describeType(state.types[row.type], persisted[row.type], locale);
    });
    const meta = TYPES.map((type) => persisted[type]).filter(Boolean);
    const total = (key) => formatSeconds(meta.reduce((sum, m) => sum + (m[key] || 0), 0));
    engineStatus.textContent = [state.mode ? t(`home.engine.${state.mode}`) : '', state.paused ? t('home.paused') : ''].filter(Boolean).join(' · ');
    engineRow.style.display = engineStatus.textContent ? '' : 'none';
    timingStatus.textContent = meta.length ? t('home.timing', { fetch: total('fetchMs'), items: total('itemsMs'), entries: total('entriesMs') }) : '';
    timingRow.style.display = meta.length ? '' : 'none';
    const lines = state.error ? [t(`error.${state.error.code}`)] : [];
    info.textContent = lines.join(' · ');
    rows.forEach((row) => row.buttons.refresh.classList.toggle('disabled', state.running));
  }

  return {
    el,
    /** Per media type: { type, remove, refresh } (the buttons at the end of its row). */
    rowButtons: rows.map((row) => ({ type: row.type, remove: row.buttons.remove, refresh: row.buttons.refresh })),
    /** The guide row's buttons: { remove, refresh }. */
    epgButtons: { remove: epgButtons.remove, refresh: epgButtons.refresh },
    refreshEpg: () => refreshEpg(),
    /** Only the media types the provider has (a playlist has no series): the other rows are hidden. */
    setTypes(types) {
      rows.forEach((row) => {
        row.el.style.display = types.indexOf(row.type) >= 0 ? '' : 'none';
      });
    },
    /** Nickname of the active provider, next to the title. */
    setProviderName(name) {
      providerName.textContent = name ? ` · ${name}` : '';
    },
    /** Starts a forced sync of one media type unless one is already running. */
    syncType(type) {
      if (!ctx.catalog.getState().running) ctx.catalog.start({ force: true, types: [type], rewrite: true }); // forced: every row written again
    },
    refreshStatus: () => refreshPersisted(),
    /** Points the panel at a provider (also called when the active provider changes). */
    setProvider(id) {
      providerId = id;
      persisted = {};
      render();
      epgMeta = null;
      renderEpg();
      refreshEpg().catch(() => undefined);
      return refreshPersisted();
    },
    mount() {
      // The guide row follows its download: "in progress" while it runs, the new numbers when it ends.
      if (ctx.operations)
        stopEpg = ctx.operations.onChange(() => {
          const running = Boolean(epgRunning());
          renderEpg();
          if (wasEpgRunning && !running) refreshEpg().catch(() => undefined);
          wasEpgRunning = running;
        });
      wasRunning = ctx.catalog.getState().running;
      unsubscribe = ctx.catalog.onChange((state) => {
        render();
        if (wasRunning && !state.running) refreshPersisted();
        wasRunning = state.running;
      });
      render();
    },
    destroy() {
      if (unsubscribe) unsubscribe();
      if (stopEpg) stopEpg();
    },
  };
}

/** One line of the Metadata table: "ready · last run <time> · N items · 3.2 s". */
export function describeMeta(entry, locale, ready, running = null) {
  if (!ready) return t('settings.notConfigured');
  if (running) return running.queued ? t('common.queued') : t('meta.running', { time: formatDateTime(running.startedAt, locale) });
  if (!entry) return t('common.never');
  return t(entry.failed ? 'meta.failed' : 'meta.ran', {
    time: formatDateTime(entry.lastSync, locale),
    count: formatNumber(entry.count, locale),
    seconds: `${formatSeconds(entry.durationMs)} s`,
  });
}

/** Table with a title, icon buttons at the right of the title and text rows: `{ el, rows, buttons }`. */
function createTable(title, buttons, rows) {
  const status = rows.map((row) => ({ ...row, status: createTableStatus() }));
  status.forEach((row) => {
    row.el = createTableRow({ name: row.label, status: row.status, buttons: row.buttons ? row.buttons.el : null }).el;
  });
  const { el } = createPanel({ title, aside: createPanelButtons(buttons), rows: status.map((r) => r.el) });
  return { el, rows: status };
}

/** "TMDB" table: metadata download (with the titles in the database) and genre search, each with its remove and update buttons. */
export function createTmdbPanel(ctx) {
  const ready = () => Boolean(ctx.tmdb && ctx.tmdb.enabled);
  const tmdbButtons = rowButtons(t('settings.metaRemove'), t('settings.metaUpdate'));
  const genreButtons = rowButtons(t('settings.genresRemove'), t('settings.genresUpdate'));
  const infoButtons = rowButtons(t('settings.infoRemove'), t('settings.infoUpdate'));
  const table = createTable(t('tmdb.title'), [], [
    { name: 'tmdb', label: t('tmdb.download'), buttons: tmdbButtons },
    { name: 'genres', label: t('detail.genres'), buttons: genreButtons },
    { name: 'info', label: t('tmdb.info'), buttons: infoButtons },
  ]);
  const TYPE_LABEL = { movie: 'nav.movies', series: 'nav.series' };

  async function refresh() {
    const log = await ctx.syncLog.get();
    const locale = i18n.getLocale();
    const active = new Map(ctx.operations.list().map((op) => [op.id, op]));
    for (const row of table.rows) {
      row.status.classList.toggle('in-progress', active.has(row.name));
      if (row.name === 'info') {
        row.status.textContent = await describeInfo(log.info, locale, active.get('info'));
        continue;
      }
      const text = describeMeta(log[row.name], locale, row.name === 'genres' || ready(), active.get(row.name));
      row.status.textContent = row.name === 'tmdb' && ready() ? `${formatNumber(await ctx.tmdb.countMeta(), locale)} ${t('tmdb.count').toLowerCase()} · ${text}` : text;
    }
  }
  /**
   * The title details row: while it runs, how far each type is ("Movies 120 / 3,000"); otherwise the last run and, per type, how many
   * titles were asked and how many got a TMDB id (from the details, from the title search).
   */
  async function describeInfo(entry, locale, running) {
    const info = ctx.titleInfo;
    if (!info) return t('settings.notConfigured');
    if (running && !running.queued) {
      const parts = Object.keys(info.progress).map((type) => t('tmdb.infoProgress', { type: t(TYPE_LABEL[type] || type), done: formatNumber(info.progress[type].done, locale), total: formatNumber(info.progress[type].total, locale) }));
      return parts.length ? parts.join(' · ') : describeMeta(entry, locale, true, running);
    }
    const byType = await info.read().catch(() => ({}));
    const parts = ['movie', 'series']
      .filter((type) => byType[type] && (byType[type].asked || byType[type].searched))
      .map((type) => t('tmdb.infoDone', { type: t(TYPE_LABEL[type]), asked: formatNumber(byType[type].asked, locale), found: formatNumber(byType[type].found + byType[type].matched, locale) }));
    return [describeMeta(entry, locale, true, running)].concat(parts).join(' · ');
  }
  let unsubscribe = null;
  let unsubscribeInfo = null;
  let progressFrame = null;
  return {
    el: table.el,
    /** { remove, refresh } of the metadata download row, of the genre search row and of the title details row. */
    tmdbButtons,
    genreButtons,
    infoButtons,
    refresh,
    /** Follows the operations: a row says "running since…" while it works and shows the new result when it ends. */
    mount() {
      unsubscribe = ctx.operations.onChange(() => refresh().catch(() => undefined));
      // The title details tell how far they are: the row follows (at most twice a second).
      if (ctx.titleInfo)
        unsubscribeInfo = ctx.titleInfo.onProgress(() => {
          if (progressFrame) return;
          progressFrame = setTimeout(() => {
            progressFrame = null;
            refresh().catch(() => undefined);
          }, 500);
        });
    },
    destroy() {
      if (unsubscribe) unsubscribe();
      if (unsubscribeInfo) unsubscribeInfo();
      clearTimeout(progressFrame);
    },
  };
}

/** "Trakt" table: connected account and sync state; connect, remove and sync buttons (the last two only when connected). */
export function createTraktPanel(ctx) {
  const mk = (variant, name, label) => createButton({ label, icon: name, variant, iconOnly: true, className: 'panel-button', title: label });
  const connectButton = mk('primary', 'user', t('settings.traktConnect'));
  const removeButton = mk('danger', 'remove', t('settings.traktRemove'));
  const syncButton = mk('primary', 'refresh', t('settings.traktSync'));
  const table = createTable('Trakt', [removeButton, syncButton, connectButton], [
    { name: 'account', label: t('trakt.account') },
    { name: 'trakt', label: t('trakt.sync') },
    { name: 'watched', label: t('trakt.watched') },
    { name: 'progress', label: t('trakt.progress') },
  ]);
  let connected = false;
  removeButton.style.display = 'none'; // shown once an account is known to be connected
  syncButton.style.display = 'none';

  async function refresh() {
    const log = await ctx.syncLog.get();
    const locale = i18n.getLocale();
    const enabled = Boolean(ctx.trakt && ctx.trakt.enabled);
    connected = enabled ? await ctx.trakt.isConnected().catch(() => false) : false;
    const active = new Map(ctx.operations.list().map((op) => [op.id, op]));
    const [account, sync, watchedRow, progressRow] = table.rows;
    if (!enabled) account.status.textContent = t('settings.notConfigured');
    else if (!connected) account.status.textContent = t('settings.notConfigured');
    else account.status.textContent = (await ctx.trakt.account().catch(() => '')) || t('settings.connected');
    sync.status.classList.toggle('in-progress', active.has('trakt'));
    sync.status.textContent = describeMeta(log.trakt, locale, enabled && connected, active.get('trakt'));
    if (enabled && !connected && !active.has('trakt')) sync.status.textContent = t('settings.notConfigured');
    // Titles aligned with Trakt: watched, and in progress ("continue watching").
    const counts = connected && ctx.watch && ctx.watch.traktCounts ? await ctx.watch.traktCounts().catch(() => null) : null;
    watchedRow.el.style.display = counts ? '' : 'none';
    progressRow.el.style.display = counts ? '' : 'none';
    if (counts) {
      watchedRow.status.textContent = formatNumber(counts.watched, locale);
      progressRow.status.textContent = formatNumber(counts.progress, locale);
    }
    connectButton.style.display = connected ? 'none' : '';
    removeButton.style.display = connected ? '' : 'none';
    syncButton.style.display = connected ? '' : 'none';
  }
  let unsubscribe = null;
  return {
    el: table.el,
    connectButton,
    removeButton,
    syncButton,
    isConnected: () => connected,
    refresh,
    mount() {
      unsubscribe = ctx.operations.onChange(() => refresh().catch(() => undefined));
    },
    destroy() {
      if (unsubscribe) unsubscribe();
    },
  };
}

/** "Online · Wi-Fi · 4g · 10 Mbps · 50 ms", or "Offline"; quality parts only when the browser reports them. */
export function networkText(network) {
  if (!network) return t('device.unknown');
  if (!network.online) return t('device.offline');
  const parts = [t('device.online')];
  if (network.kind) parts.push(t(`device.net.${network.kind}`));
  if (network.effectiveType) parts.push(String(network.effectiveType));
  if (network.downlink) parts.push(`${network.downlink} Mbps`);
  if (network.rtt) parts.push(`${network.rtt} ms`);
  return parts.join(' · ');
}

/** Text rows of the "Device" table from `collectDeviceInfo()`. */
export function deviceRows(info) {
  const unknown = t('device.unknown');
  const of = (used, total) => t('device.of', { used: formatBytes(used), total: formatBytes(total) });
  const size = (d) => (d ? `${d.width} × ${d.height}` : null);
  const resolution = info.panel ? `${size(info.panel)}${info.page && size(info.page) !== size(info.panel) ? ` (${size(info.page)})` : ''}` : unknown;
  return [
    { label: t('device.network'), value: networkText(info.network) },
    { label: t('device.resolution'), value: resolution },
    { label: t('device.ram'), value: info.memory ? of(info.memory.used, info.memory.total) : info.ram ? formatBytes(info.ram) : unknown },
    { label: t('device.heap'), value: info.heap ? of(info.heap.used, info.heap.limit) : unknown },
    { label: t('device.storage'), value: info.storage ? of(info.storage.used, info.storage.quota) : unknown }, // then the catalog and database rows
  ];
}

/** "Device" table: the device figures, then the downloaded catalog and the data worked out from it (sizes); the last has the buttons. */
export function createDevicePanel(ctx) {
  const buttons = rowButtons(t('settings.dbRemove'), t('settings.dbUpdate'));
  const { el, body } = createPanel({ title: t('settings.device') });
  const line = (label, value, withButtons = null) => createTableRow({ name: label, statusText: value, buttons: withButtons ? withButtons.el : null }).el;
  async function refresh() {
    const rows = deviceRows(await collectDeviceInfo());
    let sizes = null;
    try {
      const current = await ctx.active.get();
      if (current) sizes = { catalog: await estimateStoresBytes(current.db, CATALOG_STORES), derived: await estimateStoresBytes(current.db, DERIVED_STORES) };
    } catch {
      sizes = null;
    }
    while (body.firstChild) body.removeChild(body.firstChild);
    rows.forEach((row) => body.appendChild(line(row.label, row.value)));
    if (sizes) {
      body.appendChild(line(t('device.dbCatalog'), `≈ ${formatBytes(sizes.catalog)}`));
      body.appendChild(line(t('device.dbDerived'), `≈ ${formatBytes(sizes.derived)}`, buttons));
    } else {
      body.appendChild(line(t('device.dbDerived'), t('device.unknown'), buttons));
    }
  }
  return { el, refresh, updateButton: buttons.refresh, removeButton: buttons.remove };
}

/**
 * "Operations in progress" table (hidden when nothing runs): what runs in the background now, since when, and a stop button for each.
 * `rows` are the focusable entries (the stop buttons); `onChange` is called when the list changes.
 */
export function createOperationsPanel(ctx) {
  const { el, body } = createPanel({ title: t('operations.title') });
  const api = { el, rows: [], onChange: null, mount, destroy };
  let unsubscribe = null;

  function render() {
    while (body.firstChild) body.removeChild(body.firstChild);
    const list = ctx.operations.list();
    el.style.display = list.length ? '' : 'none'; // nothing runs: the table is not shown
    api.rows = list.map((op) => {
      const stop = createButton({ label: t('operations.stop'), icon: 'stop', variant: 'primary', iconOnly: true, className: 'panel-button op-stop', title: t('operations.stop') });
      const statusText = op.queued ? t('common.queued') : t('operations.since', { time: formatDateTime(op.startedAt, i18n.getLocale()) });
      body.appendChild(createTableRow({ name: op.label || t(`operations.${op.id}`), statusText, buttons: stop, className: 'op-row', withButtons: false }).el);
      return { el: stop, refresh: async () => undefined, activate: async () => ctx.operations.cancel(op.id) };
    });
    if (api.onChange) api.onChange();
  }

  function mount() {
    unsubscribe = ctx.operations.onChange(render);
    render();
  }
  function destroy() {
    if (unsubscribe) unsubscribe();
  }
  return api;
}
