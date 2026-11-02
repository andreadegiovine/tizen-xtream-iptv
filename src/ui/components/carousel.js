import { h } from '../dom.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { ensureVisible } from '../scroll.js';
import { createCard } from './card.js';

/**
 * Horizontal row of cards with its own focus zone.
 * items: [{ entry, type, meta? }]; onOpen(item) is called on OK.
 */
export function createCarousel({ id, title, items, onOpen }) {
  const track = h('div', { class: 'carousel-track' });
  const cards = items.map((item) => {
    const card = createCard(item.entry, item.type, item.meta);
    track.appendChild(card.el);
    return card;
  });
  const el = h('div', { class: 'carousel' }, h('h2', { class: 'carousel-title', text: title }), track);

  const zone = new FocusZone({
    id,
    model: new ListModel({ orientation: 'horizontal', getCount: () => items.length }),
    onFocus: (i) => {
      const node = cards[i].el;
      node.classList.add('focused');
      track.scrollLeft = Math.max(0, node.offsetLeft - 64);
      ensureVisible(el, { first: false });
    },
    onBlur: (i) => cards[i] && cards[i].el.classList.remove('focused'),
    onActivate: (i) => onOpen(items[i]),
  });
  return { el, zone, cards, items };
}
