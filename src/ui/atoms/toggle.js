import { h } from '../dom.js';

/** On / off switch (`span.toggle`), at the right of a settings row. */
export function createToggle(on = false) {
  const el = h('span', { class: 'toggle', role: 'switch', 'aria-checked': 'false' }, h('span', { class: 'toggle-knob' }));
  if (on) setToggle(el, true);
  return el;
}

export function setToggle(el, on) {
  el.classList.toggle('on', Boolean(on));
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}
