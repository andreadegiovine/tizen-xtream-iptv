import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { TOPBAR_ZONE } from './topbar.js';
import { createCarousel } from './carousel.js';

const ORDER = ['movie', 'series', 'live'];
const LABEL = { movie: 'nav.movies', series: 'nav.series', live: 'nav.live' };

/** Splits entries by type, keeping the order and at most `limit` per type. */
export function groupByType(entries, limit = 20) {
  return ORDER.map((type) => ({ type, entries: entries.filter((entry) => entry.type === type).slice(0, limit) })).filter((group) => group.entries.length);
}

/**
 * One carousel per media type (movies, series, channels), stacked vertically with linked focus zones.
 * Used by Favorites, Suggestions and the search results.
 */
export function createTypedRows(ctx, { prefix, onOpen, limit = 20 }) {
  const el = h('div', { class: 'typed-rows' });
  let carousels = [];

  function clear() {
    carousels.forEach((c) => ctx.focus.unregister(c.zone.id));
    carousels = [];
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  return {
    el,
    set(entries) {
      clear();
      carousels = groupByType(entries, limit).map((group) => {
        const carousel = createCarousel({
          id: `${prefix}-${group.type}`,
          title: t(LABEL[group.type]),
          items: group.entries.map((entry) => ({ entry, type: group.type })),
          onOpen: (item) => onOpen(item.entry),
        });
        carousel.type = group.type;
        return carousel;
      });
      carousels.forEach((carousel, i) => {
        el.appendChild(carousel.el);
        ctx.focus.register(carousel.zone);
        ctx.focus.link(carousel.zone.id, 'up', i === 0 ? TOPBAR_ZONE : carousels[i - 1].zone.id);
        if (i < carousels.length - 1) ctx.focus.link(carousel.zone.id, 'down', carousels[i + 1].zone.id);
        if (ctx.enrich) ctx.enrich(carousel.items.map((item) => item.entry), carousel.cards, carousel.type, i > 0);
      });
      if (carousels.length) ctx.focus.link(TOPBAR_ZONE, 'down', carousels[0].zone.id);
      if (ctx.syncSearchLinks) ctx.syncSearchLinks();
    },
    count: () => carousels.length,
    focusFirst: () => carousels.length > 0 && ctx.focus.focus(carousels[0].zone.id, 0),
    destroy: clear,
  };
}
