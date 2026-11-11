import { h, cx } from '../dom.js';
import { icon as iconNode } from '../icons.js';

/**
 * Icon box (`.icon-btn`): the actions of a title page, of a guide row, the pin and heart of a browse head. `active`: toggled on
 * (watched, favourite), drawn like the focused state. `tag` 'span' for one that is never a form control (the browse head).
 */
export function createIconButton({ icon, label = null, active = false, className = '', title = null, tag = 'button' }) {
  return h(tag, { class: cx('icon-btn', active && 'active', className), type: tag === 'button' ? 'button' : null, 'aria-label': label, title }, iconNode(icon));
}

/** Turns the toggled-on look of an icon box on or off. */
export function setIconButtonActive(el, on) {
  el.classList.toggle('active', Boolean(on));
}
