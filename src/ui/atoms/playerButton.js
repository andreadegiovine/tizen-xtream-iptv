import { h } from '../dom.js';
import { icon as iconNode } from '../icons.js';
import { setTip } from '../tooltip.js';

/** Button of the player controls (`.player-btn`): its name is its tooltip, above it. Returns { el }. */
export function createPlayerButton({ icon, label = null }) {
  const el = h('button', { class: 'player-btn', type: 'button', 'aria-label': label }, iconNode(icon));
  setTip(el, label);
  return { el };
}

/** Changes the name of a player button; `tip`: a tooltip other than its name (where previous / next channel go). */
export function setPlayerButtonLabel(el, label, tip = null) {
  if (label) el.setAttribute('aria-label', label);
  setTip(el, tip || label);
}

/** The icon of a player button (play / pause, the aspect ratio...) replaced by another. */
export function setPlayerButtonIcon(el, name) {
  const old = el.querySelector('.icon');
  const next = iconNode(name);
  if (old) el.replaceChild(next, old);
  else el.insertBefore(next, el.firstChild);
}
