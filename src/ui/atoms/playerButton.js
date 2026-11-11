import { h } from '../dom.js';
import { icon as iconNode } from '../icons.js';

/** Button of the player controls (`.player-btn`); `tip`: a label shown above it while focused (where it goes). Returns { el, tipEl }. */
export function createPlayerButton({ icon, label = null, tip = false }) {
  const tipEl = tip ? h('span', { class: 'player-btn-tip' }) : null;
  const el = h('button', { class: 'player-btn', type: 'button', 'aria-label': label }, iconNode(icon), tipEl);
  return { el, tipEl };
}

/** The icon of a player button (play / pause, the aspect ratio...) replaced by another. */
export function setPlayerButtonIcon(el, name) {
  const old = el.querySelector('.icon');
  const next = iconNode(name);
  if (old) el.replaceChild(next, old);
  else el.insertBefore(next, el.firstChild);
}
