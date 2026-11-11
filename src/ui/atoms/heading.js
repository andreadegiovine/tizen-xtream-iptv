import { h } from '../dom.js';

/** A title (`h1`…`h3`), with an optional class: page titles, section titles, dialog titles. */
export function createHeading({ level = 2, text = '', className = '' } = {}) {
  return h(`h${level}`, { class: className || null, text });
}
