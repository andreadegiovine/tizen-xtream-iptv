import { h } from '../dom.js';
import { icon } from '../icons.js';
import { t, i18n } from '../../i18n/index.js';
import { MediaType } from '../../services/mediaType.js';
import { formatNumber, formatDateTime, formatSeconds } from '../../core/format.js';
import { collectDeviceInfo, formatBytes } from '../../services/deviceInfo.js';

const TYPES = [MediaType.MOVIE, MediaType.SERIES, MediaType.LIVE];
const LABEL_KEY = { movie: 'nav.movies', series: 'nav.series', live: 'nav.live' };
const ACTIVE_PHASES = new Set(['queued', 'categories', 'download', 'write', 'entries']);

/** Text for one media type: live progress while syncing, otherwise what the last sync stored. */
export function describeType(state, meta, locale) {
  const phase = (state && state.phase) || 'idle';
  if (phase === 'error') return t(`error.${state.code}`);
  if (phase === 'write') {
    return t('home.phase.write', { done: formatNumber(state.done, locale), total: formatNumber(state.total, locale) });
  }
  if (ACTIVE_PHASES.has(phase)) return t(`home.phase.${phase}`);
  if (!meta) return t('home.never');
  return t('home.updated', {
    items: formatNumber(meta.itemCount, locale),
    entries: formatNumber(meta.entryCount, locale),
    time: formatDateTime(meta.lastSync, locale),
  });
}

/** Round icon button at the right of a table title (the label stays as aria-label). */
function refreshButton(label) {
  return h('button', { class: 'btn primary icon-only panel-button', type: 'button', 'aria-label': label, title: label }, icon('refresh'));
}

/**
 * Catalog sync status (per type rows, engine, timings) and the manual "update now" button, for the
 * active provider. The page that hosts it owns the focus zone of `button`.
 */
export function createSyncPanel(ctx) {
  const rows = TYPES.map((type) => {
    const status = h('span', { class: 'sync-status' });
    return { type, status, el: h('div', { class: 'sync-row' }, h('span', { class: 'sync-name', text: t(LABEL_KEY[type]) }), status) };
  });
  const info = h('p', { class: 'muted sync-info' });
  const button = refreshButton(t('home.update'));
  const providerName = h('span', { class: 'panel-provider' });
  const el = h('div', { class: 'sync-panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('home.catalog') }, providerName), button), h('div', { class: 'sync' }, rows.map((r) => r.el)), info);
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
    const lines = [];
    if (state.mode) lines.push(t('home.engine', { mode: t(`home.engine.${state.mode}`) }));
    if (state.paused) lines.push(t('home.paused'));
    if (meta.length) {
      lines.push(
        t('home.timing', {
          fetch: formatSeconds(meta.reduce((sum, m) => sum + (m.fetchMs || 0), 0)),
          items: formatSeconds(meta.reduce((sum, m) => sum + (m.itemsMs || 0), 0)),
          entries: formatSeconds(meta.reduce((sum, m) => sum + (m.entriesMs || 0), 0)),
        }),
      );
    }
    if (state.error) lines.push(t(`error.${state.error.code}`));
    info.textContent = lines.join(' · ');
    button.classList.toggle('disabled', state.running);
  }

  return {
    el,
    button,
    /** Nickname of the active provider, next to the title. */
    setProviderName(name) {
      providerName.textContent = name ? ` · ${name}` : '';
    },
    /** Starts a forced sync unless one is already running. */
    syncNow() {
      if (!ctx.catalog.getState().running) ctx.catalog.start({ force: true });
    },
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
  if (running) return running.queued ? t('operations.queued') : t('meta.running', { time: formatDateTime(running.startedAt, locale) });
  if (!entry) return t('meta.never');
  return t(entry.failed ? 'meta.failed' : 'meta.ran', {
    time: formatDateTime(entry.lastSync, locale),
    count: formatNumber(entry.count, locale),
    seconds: `${formatSeconds(entry.durationMs)} s`,
  });
}

/** "Metadata" table in the same style as the catalog one: TMDB, genres and Trakt, with state and timings. */
export function createMetaPanel(ctx) {
  const rows = [
    { name: 'tmdb', label: 'TMDB', ready: () => Boolean(ctx.tmdb && ctx.tmdb.enabled) },
    { name: 'genres', label: t('meta.genres'), ready: () => true },
    { name: 'trakt', label: 'Trakt', ready: () => Boolean(ctx.trakt && ctx.trakt.enabled) },
  ].map((row) => {
    const status = h('span', { class: 'sync-status' });
    return { ...row, status, el: h('div', { class: 'sync-row' }, h('span', { class: 'sync-name', text: row.label }), status) };
  });
  const button = refreshButton(t('settings.metaUpdate'));
  const removeButton = h('button', { class: 'btn danger icon-only panel-button', type: 'button', 'aria-label': t('settings.metaRemove'), title: t('settings.metaRemove') }, icon('remove'));
  const el = h('div', { class: 'sync-panel' }, h('div', { class: 'panel-head' }, h('h2', { text: t('meta.title') }), h('div', { class: 'panel-buttons' }, removeButton, button)), h('div', { class: 'sync' }, rows.map((r) => r.el)));

  async function refresh() {
    const log = await ctx.syncLog.get();
    const locale = i18n.getLocale();
    const connected = ctx.trakt && ctx.trakt.enabled ? await ctx.trakt.isConnected().catch(() => false) : false;
    const active = new Map(ctx.operations.list().map((op) => [op.id, op]));
    rows.forEach((row) => {
      let text = describeMeta(log[row.name], locale, row.ready(), active.get(row.name));
      if (row.name === 'trakt' && row.ready() && !connected && !active.has('trakt')) text = t('settings.notConnected');
      row.status.classList.toggle('in-progress', active.has(row.name));
      row.status.textContent = text;
    });
  }
  let unsubscribe = null;
  return {
    el,
    button,
    removeButton,
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

/** Text rows of the "Device" table from `collectDeviceInfo()`. */
export function deviceRows(info) {
  const unknown = t('device.unknown');
  const of = (used, total) => t('device.of', { used: formatBytes(used), total: formatBytes(total) });
  const size = (d) => (d ? `${d.width} × ${d.height}` : null);
  const resolution = info.panel ? `${size(info.panel)}${info.page && size(info.page) !== size(info.panel) ? ` (${size(info.page)})` : ''}` : unknown;
  return [
    { label: t('device.resolution'), value: resolution },
    { label: t('device.heap'), value: info.heap ? of(info.heap.used, info.heap.limit) : unknown },
    { label: t('device.storage'), value: info.storage ? of(info.storage.used, info.storage.quota) : unknown },
    { label: t('device.ram'), value: info.memory ? of(info.memory.used, info.memory.total) : info.ram ? formatBytes(info.ram) : unknown },
  ];
}

/** "Device" table in the same style as Catalog and Metadata. */
export function createDevicePanel() {
  const body = h('div', { class: 'sync' });
  const el = h('div', { class: 'sync-panel' }, h('h2', { text: t('settings.device') }), body);
  async function refresh() {
    const rows = deviceRows(await collectDeviceInfo());
    while (body.firstChild) body.removeChild(body.firstChild);
    rows.forEach((row) => body.appendChild(h('div', { class: 'sync-row' }, h('span', { class: 'sync-name', text: row.label }), h('span', { class: 'sync-status', text: row.value }))));
  }
  return { el, refresh };
}

/**
 * "Operations in progress" table: what runs in the background now, since when, and a stop button for each.
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
    if (!list.length) body.appendChild(h('div', { class: 'sync-row' }, h('span', { class: 'sync-status', text: t('operations.none') })));
    api.rows = list.map((op) => {
      const stop = h('button', { class: 'btn danger icon-only op-stop', type: 'button', 'aria-label': t('operations.stop'), title: t('operations.stop') }, icon('stop'));
      body.appendChild(
        h(
          'div',
          { class: 'sync-row op-row' },
          h('span', { class: 'sync-name', text: t(`operations.${op.id}`) }),
          h('span', { class: 'sync-status', text: op.queued ? t('operations.queued') : t('operations.since', { time: formatDateTime(op.startedAt, i18n.getLocale()) }) }),
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
