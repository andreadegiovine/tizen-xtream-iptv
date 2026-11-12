import { h, cx } from '../dom.js';
import { icon as iconNode } from '../icons.js';
import { setTip } from '../tooltip.js';

/**
 * Icon box (`.icon-btn`): the actions of a title page, of a guide row, the pin and heart of a browse head. `active`: toggled on
 * (watched, favourite), drawn like the focused state. `tag` 'span' for one that is never a form control (the browse head).
 * `label`: its name, also its tooltip (`tipDir` 'up' or 'down').
 */
export function createIconButton({ icon, label = null, active = false, className = '', tag = 'button', tipDir = 'up' }) {
  const el = h(tag, { class: cx('icon-btn', active && 'active', className), type: tag === 'button' ? 'button' : null, 'aria-label': label }, iconNode(icon));
  return setTip(el, label, tipDir);
}

/** Changes the name (and tooltip) of an icon box: a toggle says what pressing it does. */
export function setIconButtonLabel(el, label) {
  if (label) el.setAttribute('aria-label', label);
  else el.removeAttribute('aria-label');
  setTip(el, label, el.getAttribute('data-tip-dir') || 'up');
}

/** Turns the toggled-on look of an icon box on or off. */
export function setIconButtonActive(el, on) {
  el.classList.toggle('active', Boolean(on));
}
