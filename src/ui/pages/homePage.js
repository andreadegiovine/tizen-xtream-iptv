import { h } from '../dom.js';
import { t, i18n } from '../../i18n/index.js';
import { MediaType } from '../../services/mediaType.js';
import { formatNumber } from '../../core/format.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { createCarousel } from '../components/carousel.js';
import { getEntry, pageEntries } from '../../services/catalogQuery.js';
import { log } from '../../core/logger.js';

const TYPES = [MediaType.MOVIE, MediaType.SERIES, MediaType.LIVE];
const LABEL_KEY = { movie: 'nav.movies', series: 'nav.series', live: 'nav.live' };

/** One-line summary of what is stored for a type: "12,345 titles" or "Not synced yet". */
export function summarizeType(meta, locale) {
  if (!meta) return t('home.never');
  return t('home.titles', { entries: formatNumber(meta.entryCount, locale) });
}

/** "s1e2" → "S1E2". */
export const episodeLabel = (episodeKey) => (episodeKey ? episodeKey.toUpperCase() : '');

/**
 * Home: "Continue watching", latest movies and latest series as carousels, then a catalog summary.
 * Sync details and the manual update button live in the Provider section.
 */
export function createHomePage(ctx) {
  const rowsEl = h('div', { class: 'home-rows' });
  const providerLine = h('p', { class: 'muted' });
  const summaryRows = TYPES.map((type) => {
    const value = h('span', { class: 'sync-status' });
    return { type, value, el: h('div', { class: 'sync-row' }, h('span', { class: 'sync-name', text: t(LABEL_KEY[type]) }), value) };
  });
  const hint = h('p', { class: 'muted sync-info', text: t('home.hint') });
  let carousels = [];
  let providerId = null;
  let unsubscribe = null;
  let destroyed = false;
  let wasRunning = false;
  let building = 0;

  function clearRows() {
    carousels.forEach((c) => ctx.focus.unregister(c.zone.id));
    carousels = [];
    while (rowsEl.firstChild) rowsEl.removeChild(rowsEl.firstChild);
  }

  function enrich(carousel) {
    const byType = {};
    carousel.items.forEach((item, i) => {
      (byType[item.type] = byType[item.type] || { entries: [], cards: [] });
      byType[item.type].entries.push(item.entry);
      byType[item.type].cards.push(carousel.cards[i]);
    });
    if (ctx.enrich) Object.entries(byType).forEach(([type, group]) => ctx.enrich(group.entries, group.cards, type));
  }

  async function loadRows() {
    const mine = (building += 1);
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    const { carouselItems } = await ctx.settings.get();
    providerId = current.provider.id;
    providerLine.textContent = `${t('home.provider')}: ${current.provider.name}`;

    const definitions = [];
    const recent = await ctx.watch.recent({ providerId, limit: carouselItems });
    const resumed = [];
    for (const rec of recent) {
      const entry = await getEntry(current.db, rec.entryKey);
      if (!entry) continue;
      resumed.push({ entry, type: entry.type, meta: { progress: rec.duration ? rec.position / rec.duration : 0, subtitle: episodeLabel(rec.episodeKey) } });
    }
    definitions.push({ id: 'homeContinue', title: t('home.continue'), items: resumed });
    for (const type of [MediaType.MOVIE, MediaType.SERIES]) {
      const page = await pageEntries(current.db, { type, offset: 0, limit: carouselItems });
      definitions.push({ id: `homeLatest-${type}`, title: t(`home.latest.${type}`), items: page.entries.map((entry) => ({ entry, type })) });
    }
    if (destroyed || mine !== building) return;

    const hadFocus = ctx.focus.activeId && ctx.focus.activeId.indexOf('home') === 0 ? { id: ctx.focus.activeId, index: ctx.focus.active.index } : null;
    clearRows();
    carousels = definitions
      .filter((d) => d.items.length)
      .map((d) => createCarousel({ ...d, onOpen: (item) => ctx.openEntry(item.entry, { section: 'home' }) }));
    carousels.forEach((c, i) => {
      rowsEl.appendChild(c.el);
      ctx.focus.register(c.zone);
      ctx.focus.link(c.zone.id, 'up', i === 0 ? TOPBAR_ZONE : carousels[i - 1].zone.id);
      if (i < carousels.length - 1) ctx.focus.link(c.zone.id, 'down', carousels[i + 1].zone.id);
      enrich(c);
    });
    if (carousels.length) {
      ctx.focus.link(TOPBAR_ZONE, 'down', carousels[0].zone.id);
      if (hadFocus && ctx.focus.zones.has(hadFocus.id)) ctx.focus.focus(hadFocus.id, hadFocus.index);
    }
    hint.style.display = carousels.length ? 'none' : '';
    refreshSummary();
  }

  function refreshSummary() {
    if (!providerId) return;
    ctx.catalog.readStatus(providerId).then((status) => {
      if (destroyed) return;
      const locale = i18n.getLocale();
      summaryRows.forEach((row) => {
        row.value.textContent = summarizeType(status[row.type], locale);
      });
    });
  }

  return {
    el: h('section', { class: 'page home' }, rowsEl, providerLine, h('div', { class: 'sync' }, summaryRows.map((r) => r.el)), hint),
    mount() {
      loadRows().catch((err) => log.warn('Home failed', err && err.message));
      wasRunning = ctx.catalog.getState().running;
      unsubscribe = ctx.catalog.onChange((state) => {
        if (wasRunning && !state.running) loadRows().catch(() => undefined);
        wasRunning = state.running;
      });
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
      clearRows();
    },
  };
}
