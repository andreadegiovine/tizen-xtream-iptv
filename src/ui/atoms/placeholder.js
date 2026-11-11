import { h, cx } from '../dom.js';
import { icon as iconNode } from '../icons.js';

/** The icon shown where a picture is missing (`.card-placeholder`): a film, a channel, a folder, a lock. */
export function createPlaceholder({ icon, className = '' }) {
  return h('div', { class: cx('card-placeholder', className) }, iconNode(icon));
}
