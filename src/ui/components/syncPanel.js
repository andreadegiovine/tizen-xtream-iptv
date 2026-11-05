import { h } from '../dom.js';
import { icon } from '../icons.js';
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

/** The remove + refresh buttons at the end of a table row (labels are the aria-labels). */
function rowButtons(removeLabel, refreshLabel) {
  const remove = h('button', { class: 'btn danger icon-only panel-button', type: 'button', 'aria-label': removeLabel, title: removeLabel }, icon('remove'));
  const refresh = h('button', { class: 'btn primary icon-only panel-button', type: 'button', 'aria-label': refreshLabel, title: refreshLabel }, icon('refresh'));
  return { remove, refresh, el: h('span', { class: 'row-buttons' }, remove, refresh) };
}

/**
 * Catalog sync status (per type rows, engine, timings) and the manual "update now" button, for the
 * active provider. The page that hosts it owns the focus zone of `button`.
 */
export function createSyncPanel(ctx) {
  const rows = TYPES.map((type) => {
    const status = h('span', { class: 'sync-status' });
    const buttons = rowButtons(t('settings.typeRemove', { type: t(LABEL_KEY[type]) }), t('settings.typeUpdate', { type: t(LABEL_KEY[type]) }));
    return { type, status, buttons, el: h('div', { class: 'sync-row with-buttons' }, h('span', { class: 'sync-name', text: t(LABEL_KEY[type]) }), status, buttons.el) };
  });
  const engineStatus = h('span', { class: 'sync-status' });
  const timingStatus = h('span', { class: 'sync-status' });
  const engineRow = h('div', { class: 'sync-row' }, h('span', { class: 'sync-name', text: t('home.engine') }), engineStatus);
  const timingRow = h('div', { class: 'sync-row' }, h('span', { class: 'sync-name', text: t('home.syncTiming') }), timingStatus);
  const info = h('p', { class: 'muted sync-info' });
  const providerName = h('span', { class: 'panel-provider' });
  const el = h('div', { class: 'sync-panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('home.catalog') }, providerName)), h('div', { class: 'sync' }, rows.map((r) => r.el), engineRow, timingRow), info);
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
      return refreshPersisted();
    },
    mount() {
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
  const status = rows.map((row) => ({ ...row, status: h('span', { class: 'sync-status' }) }));
  status.forEach((row) => {
    row.el = h('div', { class: row.buttons ? 'sync-row with-buttons' : 'sync-row' }, h('span', { class: 'sync-name', text: row.label }), row.status, row.buttons ? row.buttons.el : null);
  });
  const el = h('div', { class: 'sync-panel' }, h('div', { class: 'panel-head' }, h('h2', { text: title }), h('div', { class: 'panel-buttons' }, buttons)), h('div', { class: 'sync' }, status.map((r) => r.el)));
  return { el, rows: status };
}

/** "TMDB" table: metadata download (with the titles in the database) and genre search, each with its remove and update buttons. */
export function createTmdbPanel(ctx) {
  const ready = () => Boolean(ctx.tmdb && ctx.tmdb.enabled);
  const tmdbButtons = rowButtons(t('settings.metaRemove'), t('settings.metaUpdate'));
  const genreButtons = rowButtons(t('settings.genresRemove'), t('settings.genresUpdate'));
  const table = createTable(t('tmdb.title'), [], [
    { name: 'tmdb', label: t('tmdb.download'), buttons: tmdbButtons },
    { name: 'genres', label: t('detail.genres'), buttons: genreButtons },
  ]);

  async function refresh() {
    const log = await ctx.syncLog.get();
    const locale = i18n.getLocale();
    const active = new Map(ctx.operations.list().map((op) => [op.id, op]));
    for (const row of table.rows) {
      row.status.classList.toggle('in-progress', active.has(row.name));
      const text = describeMeta(log[row.name], locale, row.name === 'genres' || ready(), active.get(row.name));
      row.status.textContent = row.name === 'tmdb' && ready() ? `${formatNumber(await ctx.tmdb.countMeta(), locale)} ${t('tmdb.count').toLowerCase()} · ${text}` : text;
    }
  }
  let unsubscribe = null;
  return {
    el: table.el,
    /** { remove, refresh } of the metadata download row and of the genre search row. */
    tmdbButtons,
    genreButtons,
    refresh,
    /** Follows the operations: a row says "running since…" while it works and shows the new result when it ends. */
    mount() {
      unsubscribe = ctx.operations.onChange(() => refresh().catch(() => undefined));
    },
    destroy() {
      if (unsubscribe) unsubscribe();
    },
  };
}

/** "Trakt" table: connected account and sync state; connect, remove and sync buttons (the last two only when connected). */
export function createTraktPanel(ctx) {
  const mk = (cls, name, label) => h('button', { class: `btn ${cls} icon-only panel-button`, type: 'button', 'aria-label': label, title: label }, icon(name));
  const connectButton = mk('primary', 'user', t('settings.traktConnect'));
  const removeButton = mk('danger', 'remove', t('settings.traktRemove'));
  const syncButton = mk('primary', 'refresh', t('settings.traktSync'));
  const table = createTable('Trakt', [removeButton, syncButton, connectButton], [
    { name: 'account', label: t('trakt.account') },
    { name: 'trakt', label: t('trakt.sync') },
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
    const [account, sync] = table.rows;
    if (!enabled) account.status.textContent = t('settings.notConfigured');
    else if (!connected) account.status.textContent = t('settings.notConfigured');
    else account.status.textContent = (await ctx.trakt.account().catch(() => '')) || t('settings.connected');
    sync.status.classList.toggle('in-progress', active.has('trakt'));
    sync.status.textContent = describeMeta(log.trakt, locale, enabled && connected, active.get('trakt'));
    if (enabled && !connected && !active.has('trakt')) sync.status.textContent = t('settings.notConfigured');
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
    { label: t('device.heap'), value: info.heap ? of(info.heap.used, info.heap.limit) : unknown },
    { label: t('device.storage'), value: info.storage ? of(info.storage.used, info.storage.quota) : unknown },
    { label: t('device.ram'), value: info.memory ? of(info.memory.used, info.memory.total) : info.ram ? formatBytes(info.ram) : unknown },
  ];
}

/** "Device" table: the device figures, then the downloaded catalog and the data worked out from it (sizes); the last has the buttons. */
export function createDevicePanel(ctx) {
  const body = h('div', { class: 'sync' });
  const buttons = rowButtons(t('settings.dbRemove'), t('settings.dbUpdate'));
  const el = h('div', { class: 'sync-panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('settings.device') })), body);
  const line = (label, value, withButtons = null) =>
    h('div', { class: withButtons ? 'sync-row with-buttons' : 'sync-row' }, h('span', { class: 'sync-name', text: label }), h('span', { class: 'sync-status', text: value }), withButtons ? withButtons.el : null);
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
  const body = h('div', { class: 'sync' });
  const el = h('div', { class: 'sync-panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('operations.title') })), body);
  const api = { el, rows: [], onChange: null, mount, destroy };
  let unsubscribe = null;

  function render() {
    while (body.firstChild) body.removeChild(body.firstChild);
    const list = ctx.operations.list();
    el.style.display = list.length ? '' : 'none'; // nothing runs: the table is not shown
    api.rows = list.map((op) => {
      const stop = h('button', { class: 'btn primary icon-only panel-button op-stop', type: 'button', 'aria-label': t('operations.stop'), title: t('operations.stop') }, icon('stop'));
      body.appendChild(
        h(
          'div',
          { class: 'sync-row op-row' },
          h('span', { class: 'sync-name', text: t(`operations.${op.id}`) }),
          h('span', { class: 'sync-status', text: op.queued ? t('common.queued') : t('operations.since', { time: formatDateTime(op.startedAt, i18n.getLocale()) }) }),
          stop,
        ),
      );
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
