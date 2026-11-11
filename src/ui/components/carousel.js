import { h } from '../dom.js';
import { createHeading } from '../atoms/heading.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { ensureVisible } from '../scroll.js';
import { createCard } from './card.js';

/** Cards a row shows on a 1920 px screen, and how many more are kept ready past the right edge (the rest come while scrolling). */
export const VISIBLE_CARDS = 7;
export const AHEAD_CARDS = 5;

/**
 * Horizontal row of cards with its own focus zone.
 * items: [{ entry, type, meta? }]; onOpen(item) is called on OK. `startIndex`: the card the focus lands on first; `revealTop`: focusing it scrolls the page to the top.
 * Every row is lazy: only the cards on screen plus AHEAD_CARDS exist; the next ones are made as the focus moves right. A long `items` list
 * is shown that way by itself; `more(offset, count)` (optional) reads the next items of a row whose list is not known yet (resolves with
 * [] at the end). `onAdded(items, cards)` is called with the cards added later (the first ones are returned in `cards`).
 */
export function createCarousel({ id, title, items: given, onOpen, className = '', revealTop = false, startIndex = 0, more: moreItems = null, onAdded = null }) {
  const track = h('div', { class: 'carousel-track' });
  // A list given whole: the first cards now (at least up to the one the focus starts on), the others from the list while scrolling.
  const firstCount = Math.max(VISIBLE_CARDS + AHEAD_CARDS, startIndex + VISIBLE_CARDS + AHEAD_CARDS);
  const items = moreItems ? given : given.slice(0, firstCount);
  const more = moreItems || (given.length > items.length ? (offset, count) => given.slice(offset, offset + count) : null);
  const cards = [];
  const add = (list) =>
    list.map((item) => {
      const card = createCard(item.entry, item.type, item.meta);
      track.appendChild(card.el);
      cards.push(card);
      return card;
    });
  add(items);
  let ended = !more;
  let reading = null;
  /** Reads the next items until the row holds `want` cards (or it has no more). */
  function fill(want) {
    if (ended || reading || items.length >= want) return reading;
    const count = want - items.length;
    const take = (next) => {
      const list = next || [];
      if (list.length < count) ended = true;
      if (!list.length) return;
      items.push(...list);
      const made = add(list);
      if (onAdded) onAdded(list, made);
    };
    // The rest of a list given whole is added at once (no waiting); a `more` reader may answer later.
    if (!moreItems) {
      take(more(items.length, count));
      return null;
    }
    reading = Promise.resolve(more(items.length, count))
      .then((next) => {
        reading = null;
        take(next);
        fill(want);
      })
      .catch(() => {
        reading = null;
        ended = true;
      });
    return reading;
  }
  const el = h('div', { class: `carousel${className ? ` ${className}` : ''}` }, title ? createHeading({ text: title, className: 'carousel-title' }) : null, track);

  const zone = new FocusZone({
    id,
    // The focus can move over the whole row: a card not made yet is made when the focus reaches it.
    model: new ListModel({ orientation: 'horizontal', getCount: () => (moreItems ? items.length : given.length) }),
    onFocus: (i) => {
      fill(i + VISIBLE_CARDS + AHEAD_CARDS);
      if (!cards[i]) return;
      const node = cards[i].el;
      node.classList.add('focused');
      track.scrollLeft = Math.max(0, node.offsetLeft - 48);
      ensureVisible(el, { first: revealTop }); // the first row also brings the page heading back into view
    },
    onBlur: (i) => cards[i] && cards[i].el.classList.remove('focused'),
    onActivate: (i) => onOpen && onOpen((moreItems ? items : given)[i]),
  });
  zone.index = Math.max(0, Math.min(startIndex, (moreItems ? items : given).length - 1)); // where the focus lands when the row is reached
  fill(VISIBLE_CARDS + AHEAD_CARDS);
  return { el, zone, cards, items, fill };
}
