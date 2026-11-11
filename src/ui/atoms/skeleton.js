import { h, cx } from '../dom.js';

/** A grey loading bar (`.skeleton-line`), with the class of what it stands for. */
export function createSkeletonLine({ className = '', tag = 'div' } = {}) {
  return h(tag, { class: cx(className, 'skeleton-line') });
}

/** A grey loading box (`.skeleton-block`). */
export function createSkeletonBlock({ className = '' } = {}) {
  return h('div', { class: cx('skeleton-block', className) });
}
