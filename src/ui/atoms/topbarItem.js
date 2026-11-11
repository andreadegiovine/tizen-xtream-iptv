import { h, cx } from '../dom.js';
import { icon as iconNode } from '../icons.js';

/** Entry of the top bar (`.topbar-item`): icon and / or label, `current` the section on screen. */
export function createTopbarItem({ label, icon = null, iconOnly = false, current = false }) {
  return h('span', { class: cx('topbar-item', current && 'current', iconOnly && 'icon-only'), 'aria-label': label }, icon ? iconNode(icon) : null, iconOnly ? null : h('span', { text: label }));
}

/** A top bar entry still loading (a grey bar; `icon`: the short one of an icon entry). */
export function createTopbarItemSkeleton({ icon = false } = {}) {
  return h('span', { class: 'topbar-item' }, h('span', { class: cx('skeleton-line', icon && 'icon') }));
}
