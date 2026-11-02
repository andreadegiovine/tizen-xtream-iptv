import { h } from '../dom.js';
import { t, i18n } from '../../i18n/index.js';
import { MediaType } from '../../services/mediaType.js';
import { formatNumber, formatDateTime, formatSeconds } from '../../core/format.js';

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
  const button = h('button', { class: 'btn primary sync-button', type: 'button', text: t('home.update') });
  const el = h('div', { class: 'sync-panel' }, h('h2', { text: t('home.catalog') }), h('div', { class: 'sync' }, rows.map((r) => r.el)), info, button);
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
