import { h } from '../dom.js';
import { t, i18n } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { MediaType } from '../../services/mediaType.js';
import { formatNumber, formatDateTime, formatSeconds } from '../../core/format.js';

const ZONE_ID = 'home';
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

export function createHomePage(ctx) {
  const providerLine = h('p', { class: 'muted' });
  const rows = TYPES.map((type) => ({
    type,
    status: h('span', { class: 'sync-status' }),
    el: null,
  }));
  rows.forEach((row) => {
    row.el = h('div', { class: 'sync-row' }, h('span', { class: 'sync-name', text: t(LABEL_KEY[row.type]) }), row.status);
  });
  const info = h('p', { class: 'muted sync-info' });
  const button = h('button', { class: 'btn primary', type: 'button', text: t('home.update') });
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

  const zone = new FocusZone({
    id: ZONE_ID,
    model: new ListModel({ orientation: 'vertical', getCount: () => 1 }),
    onFocus: () => button.classList.add('focused'),
    onBlur: () => button.classList.remove('focused'),
    onActivate: () => {
      if (!ctx.catalog.getState().running) ctx.catalog.start({ force: true });
    },
  });

  return {
    el: h(
      'section',
      { class: 'page home' },
      h('h1', { text: t('app.title') }),
      providerLine,
      h('h2', { text: t('home.catalog') }),
      h('div', { class: 'sync' }, rows.map((row) => row.el)),
      info,
      h('div', { class: 'form' }, button),
    ),
    mount() {
      ctx.focus.register(zone);
      ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
      ctx.focus.focus(ZONE_ID, 0);
      ctx.providers.getActive().then((provider) => {
        if (!provider) return;
        providerId = provider.id;
        providerLine.textContent = `${t('home.provider')}: ${provider.name}`;
        refreshPersisted();
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
      ctx.focus.unregister(ZONE_ID);
    },
  };
}
