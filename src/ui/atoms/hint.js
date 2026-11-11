import { h, cx } from '../dom.js';

/** A muted line of text (`p.muted`): status, empty list, hints. `muted: false` for a plain paragraph. */
export function createHint({ text = '', className = '', muted = true, role = null } = {}) {
  return h('p', { class: cx(muted && 'muted', className) || null, text, role });
}
