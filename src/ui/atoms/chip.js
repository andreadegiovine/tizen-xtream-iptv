import { h, cx } from '../dom.js';

/** Chip (`span.chip`): a genre, a category, a name; `link` when OK opens something. */
export function createChip({ text, link = false, className = '' }) {
  return h('span', { class: cx('chip', link && 'link', className), text });
}

/** The small label above a group of chips (`span.detail-label`). */
export function createChipLabel(text) {
  return h('span', { class: 'detail-label', text });
}
