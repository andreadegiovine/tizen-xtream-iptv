import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { MediaType } from '../../services/mediaType.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { createCarousel } from '../components/carousel.js';
import { getEntry, pageEntries } from '../../services/catalogQuery.js';
import { log } from '../../core/logger.js';

/** "s1e2" → "S1E2". */
export const episodeLabel = (episodeKey) => (episodeKey ? episodeKey.toUpperCase() : '');

/**
 * Home: "Continue watching", latest movies and latest series as carousels.
 * Sync details and the manual update button live in the Provider section.
 */
export function createHomePage(ctx) {
  const rowsEl = h('div', { class: 'home-rows' });
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
  }

  return {
    el: h('section', { class: 'page home' }, rowsEl, hint),
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
