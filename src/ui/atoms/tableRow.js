import { h, cx } from '../dom.js';

/**
 * Row of a settings table (`.sync-row`): the name, the status (`status`: an element to fill later, or `statusText`) and, at the
 * right, buttons (`buttons`: an element; `withButtons: false` keeps the plain row layout). Returns { el, status }.
 */
export function createTableRow({ name, status = null, statusText = null, buttons = null, className = '', withButtons = Boolean(buttons) }) {
  const statusEl = status || h('span', { class: 'sync-status', text: statusText });
  const el = h('div', { class: cx('sync-row', withButtons && 'with-buttons', className) }, h('span', { class: 'sync-name', text: name }), statusEl, buttons);
  return { el, status: statusEl };
}

/** The status cell of a table row, filled later. */
export const createTableStatus = (className = '') => h('span', { class: cx('sync-status', className) });

/** The buttons at the right of a table row (`.row-buttons`). */
export const createRowButtons = (...buttons) => h('span', { class: 'row-buttons' }, buttons);
