import { h } from '../dom.js';

/**
 * A settings table with its head (`.sync-panel`): the title (`titleExtra`: something inside it, like the provider name), something
 * at the right of it (`aside`: buttons), then the rows (`rows`, in a `.sync` box, or `body` given) and what follows them (`after`).
 * Returns { el, body }.
 */
export function createPanel({ title, titleExtra = null, aside = null, rows = [], body = null, after = null }) {
  const box = body || h('div', { class: 'sync' }, rows);
  const el = h('div', { class: 'sync-panel' }, h('div', { class: 'panel-head' }, h('h2', { text: title }, titleExtra), aside), box, after);
  return { el, body: box };
}

/** The buttons at the right of a panel title (`.panel-buttons`). */
export const createPanelButtons = (buttons) => h('div', { class: 'panel-buttons' }, buttons);
