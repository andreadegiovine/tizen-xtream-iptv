import { h } from '../dom.js';
import { t, i18n } from '../../i18n/index.js';
import { MediaType } from '../../services/mediaType.js';
import { formatNumber } from '../../core/format.js';

const TYPES = [MediaType.MOVIE, MediaType.SERIES, MediaType.LIVE];
const LABEL_KEY = { movie: 'nav.movies', series: 'nav.series', live: 'nav.live' };

/** One-line summary of what is stored for a type: "12,345 titles" or "Not synced yet". */
export function summarizeType(meta, locale) {
  if (!meta) return t('home.never');
  return t('home.titles', { entries: formatNumber(meta.entryCount, locale) });
}

/**
 * Home: for now a summary of the active provider's catalog. Sync details and the manual update
 * button live in the Provider section. Carousels arrive with milestone 7.
 */
export function createHomePage(ctx) {
  const providerLine = h('p', { class: 'muted' });
  const rows = TYPES.map((type) => {
    const value = h('span', { class: 'sync-status' });
    return { type, value, el: h('div', { class: 'sync-row' }, h('span', { class: 'sync-name', text: t(LABEL_KEY[type]) }), value) };
  });
  const hint = h('p', { class: 'muted sync-info', text: t('home.hint') });
  let providerId = null;
  let unsubscribe = null;
  let destroyed = false;
  let wasRunning = false;

  function refresh() {
    if (!providerId) return;
    ctx.catalog.readStatus(providerId).then((status) => {
      if (destroyed) return;
      const locale = i18n.getLocale();
      rows.forEach((row) => {
        row.value.textContent = summarizeType(status[row.type], locale);
      });
    });
  }

  return {
    el: h('section', { class: 'page home' }, h('h1', { text: t('app.title') }), providerLine, h('div', { class: 'sync' }, rows.map((r) => r.el)), hint),
    mount() {
      ctx.providers.getActive().then((provider) => {
        if (!provider || destroyed) return;
        providerId = provider.id;
        providerLine.textContent = `${t('home.provider')}: ${provider.name}`;
        refresh();
      });
      wasRunning = ctx.catalog.getState().running;
      unsubscribe = ctx.catalog.onChange((state) => {
        if (wasRunning && !state.running) refresh();
        wasRunning = state.running;
      });
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
    },
  };
}
