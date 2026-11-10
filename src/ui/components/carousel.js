import { h } from '../dom.js';
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
 * `more(offset, count)` (optional): the next items of a longer row, read as the focus moves right so that AHEAD_CARDS cards past the
 * screen are always there; resolves with [] at the end. `onAdded(items, cards)` is called with the cards added that way.
 */
export function createCarousel({ id, title, items, onOpen, className = '', revealTop = false, startIndex = 0, more = null, onAdded = null }) {
  const track = h('div', { class: 'carousel-track' });
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
    reading = Promise.resolve(more(items.length, count))
      .then((next) => {
        reading = null;
        const list = next || [];
        if (list.length < count) ended = true;
        if (!list.length) return;
        items.push(...list);
        const made = add(list);
        if (onAdded) onAdded(list, made);
        fill(want);
      })
      .catch(() => {
        reading = null;
        ended = true;
      });
    return reading;
  }
  const el = h('div', { class: `carousel${className ? ` ${className}` : ''}` }, title ? h('h2', { class: 'carousel-title', text: title }) : null, track);

  const zone = new FocusZone({
    id,
    model: new ListModel({ orientation: 'horizontal', getCount: () => items.length }),
    onFocus: (i) => {
      fill(i + VISIBLE_CARDS + AHEAD_CARDS);
      if (!cards[i]) return;
      const node = cards[i].el;
      node.classList.add('focused');
      track.scrollLeft = Math.max(0, node.offsetLeft - 48);
      ensureVisible(el, { first: revealTop }); // the first row also brings the page heading back into view
    },
    onBlur: (i) => cards[i] && cards[i].el.classList.remove('focused'),
    onActivate: (i) => onOpen && onOpen(items[i]),
  });
  zone.index = Math.max(0, Math.min(startIndex, items.length - 1)); // where the focus lands when the row is reached
  fill(VISIBLE_CARDS + AHEAD_CARDS);
  return { el, zone, cards, items, fill };
}
