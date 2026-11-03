import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { MediaType } from '../../services/mediaType.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { createCarousel } from '../components/carousel.js';
import { createSkeletonCard } from '../components/card.js';
import { getEntry, pageEntries } from '../../services/catalogQuery.js';
import { log } from '../../core/logger.js';

/** "s1e2" → "S1E2". */
export const episodeLabel = (episodeKey) => (episodeKey ? episodeKey.toUpperCase() : '');

/** The Home layout drawn with placeholders (same wrappers and classes as the real rows): used behind the first-start form. */
/**
 * Home: "Continue watching" (when there is something to resume), new movies, new series, then the suggested
 * movies and series. Sync details and the manual update buttons live in the Settings.
 */
export function createHomeSkeleton(rows = 3, cards = 9) {
  const carousel = () => h('div', { class: 'carousel' }, h('h2', { class: 'carousel-title skeleton-line' }), h('div', { class: 'carousel-track' }, Array.from({ length: cards }, () => createSkeletonCard())));
  return h('div', { class: 'home-rows' }, Array.from({ length: rows }, carousel));
}

export function createHomePage(ctx) {
  const rowsEl = h('div', { class: 'home-rows' });
  const hint = h('p', { class: 'muted sync-info', text: t('common.empty') });
  hint.style.display = 'none'; // shown only once the rows are known to be empty
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

  function render(definitions) {
    const hadFocus = ctx.focus.activeId && ctx.focus.activeId.indexOf('home') === 0 ? { id: ctx.focus.activeId, index: ctx.focus.active.index } : null;
    clearRows();
    carousels = definitions
      .filter((d) => d.items.length)
      .map((d, index) => createCarousel({ ...d, revealTop: index === 0, onOpen: (item) => ctx.openEntry(item.entry, { section: 'home' }) }));
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
      definitions.push({ id: `homeLatest-${type}`, title: t(`home.new.${type}`), items: page.entries.map((entry) => ({ entry, type })) });
    }
    if (destroyed || mine !== building) return;

    render(definitions);

    // Suggestions come from TMDB / Trakt: they can take a while (or fail), so they never hold the other rows back.
    const suggested = await ctx.suggestions.build({ limit: carouselItems * 4 }).then((result) => result.entries, () => []);
    if (destroyed || mine !== building || !suggested.length) return;
    const more = [MediaType.MOVIE, MediaType.SERIES].map((type) => ({ id: `homeSuggested-${type}`, title: t(`home.suggested.${type}`), items: suggested.filter((entry) => entry.type === type).slice(0, carouselItems).map((entry) => ({ entry, type })) }));
    render(definitions.concat(more));
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
