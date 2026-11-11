import { h, cx } from '../dom.js';

/**
 * Row of a list (`.list .row`): the label at the left and, at the right, a value (`value`: text, or `valueEl` an element such as a
 * switch). Returns { el, valueEl } (valueEl: the value span when `value` was given, the element passed otherwise, or null).
 */
export function createListRow({ label, value = null, valueEl = null, className = '', lead = null }) {
  const right = valueEl || (value !== null ? h('span', { class: 'value', text: value }) : null);
  const el = h('div', { class: cx('row', className) }, lead, h('span', { class: lead ? 'cat-name' : null, text: label }), right);
  return { el, valueEl: right };
}

/** An empty value span of a row, filled later (`.value`). */
export const createRowValue = () => h('span', { class: 'value' });
