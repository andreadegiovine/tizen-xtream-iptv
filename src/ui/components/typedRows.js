import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { focusRowAt, savedRowFocus } from '../rowFocus.js';
import { createCarousel } from './carousel.js';

const ORDER = ['collection', 'movie', 'series', 'live', 'programme'];
const LABEL = { collection: 'nav.collections', movie: 'nav.movies', series: 'nav.series', live: 'nav.live', programme: 'search.programmes' };

/**
 * A favourite category or genre shown as a card: `{ type, key, name, filterKind: 'category' | 'genre', filterId }`.
 * The card carries an icon instead of a poster and the kind ("Category", "Genre") as its subtitle.
 */
export const isFilterEntry = (entry) => Boolean(entry && entry.filterKind);
const isGenreFilter = (entry) => entry.filterKind === 'genre' || entry.filterKind === 'epgGenre';
export const filterCardMeta = (entry) => ({ placeholder: isGenreFilter(entry) ? 'genres' : 'categories', subtitle: t(isGenreFilter(entry) ? 'favorites.genre' : 'favorites.category') });

/** Splits entries by type (collections first), keeping the order and at most `limit` per type. */
export function groupByType(entries, limit = 500) {
  const first = (entry) => (entry.isNetwork ? 0 : 1); // networks come ahead of the channels and groups
  return ORDER.map((type) => ({ type, entries: entries.filter((entry) => entry.type === type).sort((a, b) => first(a) - first(b)).slice(0, limit) })).filter((group) => group.entries.length);
}

/**
 * One carousel per media type (movies, series, channels), stacked vertically with linked focus zones.
 * Used by Favorites, Suggestions and the search results. `topZone`: where Up from the first row goes (the search field of the results;
 * none elsewhere: the top bar is reached with Back). A `collection` entry carries `collectionId` and a `subtitle` (its item count).
 */
export function createTypedRows(ctx, { prefix, onOpen, limit = 500, hideFavorite = false, topZone = null }) { // onOpen(entry): titles and favourite filters (see isFilterEntry)
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
      carousels = groupByType(entries, limit).map((group, index) => {
        const carousel = createCarousel({
          id: `${prefix}-${group.type}`,
          title: t(LABEL[group.type]),
          items: group.entries.map((entry) => {
            if (entry.type === 'collection') return { entry, type: 'movie', meta: { placeholder: 'folder', subtitle: entry.subtitle } }; // cards of a collection look like titles
            if (entry.type === 'programme') return { entry, type: 'live', meta: { subtitle: entry.subtitle } }; // a guide programme: the channel's picture, its hours
            return isFilterEntry(entry) ? { entry, type: group.type, meta: filterCardMeta(entry) } : { entry, type: group.type };
          }),
          onOpen: (item) => onOpen(item.entry),
          revealTop: index === 0,
          // Cards made while scrolling get the same badges and metadata as the first ones.
          onAdded: (list, made) => {
            if (ctx.enrich && group.type !== 'collection' && group.type !== 'programme') ctx.enrich(list.map((item) => item.entry), made, group.type, true, { hideFavorite });
          },
        });
        carousel.type = group.type;
        return carousel;
      });
      carousels.forEach((carousel, i) => {
        el.appendChild(carousel.el);
        ctx.focus.register(carousel.zone);
        if (i > 0) ctx.focus.link(carousel.zone.id, 'up', carousels[i - 1].zone.id);
        else if (topZone) ctx.focus.link(carousel.zone.id, 'up', topZone);
        if (i < carousels.length - 1) ctx.focus.link(carousel.zone.id, 'down', carousels[i + 1].zone.id);
        if (ctx.enrich && carousel.type !== 'collection' && carousel.type !== 'programme') ctx.enrich(carousel.items.map((item) => item.entry), carousel.cards, carousel.type, i > 0, { hideFavorite });
      });
      if (topZone && ctx.linkSearchDown && carousels.length) ctx.linkSearchDown(carousels[0].zone.id);
    },
    count: () => carousels.length,
    focusFirst: () => carousels.length > 0 && ctx.focus.focus(carousels[0].zone.id, 0),
    /** The card the focus is on (to land on it again when the page comes back), or null. */
    savedFocus: () => savedRowFocus(ctx.focus, carousels.map((c) => c.zone.id)),
    /** Focuses a saved card (its row reads its cards up to it), or the first card when its row is gone. */
    focusSaved(saved) {
      const row = saved && carousels.find((c) => c.zone.id === saved.id);
      if (row) focusRowAt(ctx.focus, row, saved.index);
      else if (carousels.length) ctx.focus.focus(carousels[0].zone.id, 0);
    },
    destroy: clear,
  };
}
