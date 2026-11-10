import { continueWatching } from '../../services/continueWatching.js';
import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { MediaType } from '../../services/mediaType.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { createCarousel, VISIBLE_CARDS, AHEAD_CARDS } from '../components/carousel.js';
import { createSkeletonCard } from '../components/card.js';
import { getEntry, pageEntries } from '../../services/catalogQuery.js';
import { log } from '../../core/logger.js';

const ROW_LIMIT = 200; // a home row ends here, however long the catalog
const SUGGESTION_LIMIT = 500; // every suggestion found (the rows load lazily)

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

  /** What a row shows: the same signature means the same cards (kept as they are, pictures included). */
  const signature = (d) => d.items.map((item) => `${item.entry.key}|${item.meta ? `${item.meta.progress}|${item.meta.subtitle}` : ''}`).join(',');

  /**
   * Draws the rows. Rows whose cards did not change are kept as they are: when the suggestions arrive (a second render) the rows
   * above are not built again, so their posters do not reload all together (a flash on the TV).
   */
  function render(definitions) {
    const hadFocus = ctx.focus.activeId && ctx.focus.activeId.indexOf('home') === 0 ? { id: ctx.focus.activeId, index: ctx.focus.active.index } : null;
    const previous = new Map(carousels.map((c) => [c.id, c]));
    const next = definitions
      .filter((d) => d.items.length)
      .map((d, index) => {
        const sig = signature(d);
        const kept = previous.get(d.id);
        if (kept && kept.sig === sig && kept.first === (index === 0)) {
          previous.delete(d.id);
          return kept;
        }
        const carousel = createCarousel({
          ...d,
          revealTop: index === 0,
          onOpen: (item) => ctx.openEntry(item.entry, { section: 'home' }),
          // Cards read while scrolling get the same metadata as the first ones.
          onAdded: (list, made) => enrich({ items: list, cards: made }),
        });
        return Object.assign(carousel, { id: d.id, sig, first: index === 0, fresh: true });
      });
    previous.forEach((c) => {
      ctx.focus.unregister(c.zone.id);
      c.el.remove();
    });
    carousels = next;
    carousels.forEach((c, i) => {
      if (rowsEl.children[i] !== c.el) rowsEl.insertBefore(c.el, rowsEl.children[i] || null);
      if (c.fresh) {
        ctx.focus.register(c.zone);
        enrich(c);
        c.fresh = false;
      }
      ctx.focus.link(c.zone.id, 'up', i === 0 ? TOPBAR_ZONE : carousels[i - 1].zone.id);
      if (i < carousels.length - 1) ctx.focus.link(c.zone.id, 'down', carousels[i + 1].zone.id);
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
    providerId = current.provider.id;

    // Each row reads the cards on screen plus AHEAD_CARDS; the carousel asks for the next ones while the focus moves right (`more`).
    const first = VISIBLE_CARDS + AHEAD_CARDS;
    const definitions = [];
    const recent = await continueWatching(ctx, { providerId, limit: ROW_LIMIT });
    const resumeItem = async (rec) => {
      const entry = await getEntry(current.db, rec.entryKey);
      return entry ? { entry, type: entry.type, meta: { progress: rec.duration ? rec.position / rec.duration : 0, subtitle: episodeLabel(rec.episodeKey) } } : null;
    };
    const resumedFrom = async (offset, count) => (await Promise.all(recent.slice(offset, offset + count).map(resumeItem))).filter(Boolean);
    definitions.push({ id: 'homeContinue', title: t('home.continue'), items: await resumedFrom(0, first), more: (offset, count) => resumedFrom(offset, count) });
    for (const type of [MediaType.MOVIE, MediaType.SERIES]) {
      const page = await pageEntries(current.db, { type, offset: 0, limit: first });
      const more = async (offset, count) => (offset >= ROW_LIMIT ? [] : (await pageEntries(current.db, { type, offset, limit: count })).entries.map((entry) => ({ entry, type })));
      definitions.push({ id: `homeLatest-${type}`, title: t(`home.new.${type}`), items: page.entries.map((entry) => ({ entry, type })), more });
    }
    if (destroyed || mine !== building) return;

    render(definitions);

    // Suggestions come from TMDB / Trakt: they can take a while (or fail), so they never hold the other rows back.
    const suggested = await ctx.suggestions.build({ limit: SUGGESTION_LIMIT }).then((result) => result.entries, () => []);
    if (destroyed || mine !== building || !suggested.length) return;
    const more = [MediaType.MOVIE, MediaType.SERIES].map((type) => {
      const all = suggested.filter((entry) => entry.type === type).map((entry) => ({ entry, type }));
      return { id: `homeSuggested-${type}`, title: t(`home.suggested.${type}`), items: all.slice(0, first), more: async (offset, count) => all.slice(offset, offset + count) };
    });
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
