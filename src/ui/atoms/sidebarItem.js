import { h, cx } from '../dom.js';
import { icon as iconNode } from '../icons.js';

/**
 * Entry of a page sidebar (`.browse-cat`): an icon, the name, the number at the right (`count`: text; `countPending` shows a sweeping
 * placeholder while the number is read), `current` the entry on screen, `sub` an entry inside a group, `trailingIcon` the chevron of a
 * group (`open` turns it).
 */
export function createSidebarItem({ name, icon = null, count = '', countPending = false, current = false, sub = false, trailingIcon = null, open = false }) {
  const el = h('div', { class: cx('browse-cat', current && 'current', sub && 'sub') });
  if (icon) el.appendChild(h('span', { class: 'browse-cat-icon' }, iconNode(icon)));
  el.appendChild(h('span', { class: 'browse-cat-name', text: name }));
  el.appendChild(h('span', { class: cx('browse-cat-count', countPending && 'skeleton-line'), text: count }));
  if (trailingIcon) el.appendChild(iconNode(trailingIcon, open ? 'open' : ''));
  return el;
}

/** A sidebar entry still loading (grey bars). */
export function createSidebarItemSkeleton() {
  return h('div', { class: 'browse-cat sub skeleton-cat' }, h('span', { class: 'browse-cat-name skeleton-line' }), h('span', { class: 'browse-cat-count skeleton-line' }));
}
