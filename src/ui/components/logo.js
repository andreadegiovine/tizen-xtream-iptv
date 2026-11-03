import { h } from '../dom.js';

const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" aria-hidden="true"><rect width="1024" height="1024" rx="224" fill="#0c0c12"/><defs><clipPath id="logo-cb"><rect x="452" y="150" width="120" height="724" transform="rotate(-45 512 512)"/></clipPath></defs><rect x="452" y="150" width="120" height="724" rx="14" transform="rotate(45 512 512)" fill="#a30f1d"/><rect x="452" y="150" width="120" height="724" rx="14" transform="rotate(-45 512 512)" fill="#e5202f"/><g clip-path="url(#logo-cb)"><rect x="452" y="150" width="120" height="724" transform="rotate(45 512 512)" fill="#6e0a14"/></g></svg>';

/** App logo (X mark + wordmark) shown at the left of the top bar; not focusable. */
export function createLogo() {
  const mark = h('span', { class: 'logo-mark' });
  mark.innerHTML = MARK;
  return h('span', { class: 'logo', 'aria-label': 'Xtream IPTV' }, mark, h('span', { class: 'logo-text' }, 'XTREAM ', h('b', { text: 'IPTV' })));
}
