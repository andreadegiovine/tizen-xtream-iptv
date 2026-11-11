import { h, cx } from '../dom.js';
import { icon as iconNode } from '../icons.js';

/**
 * One choice of a choice list (`.choice`): a label, with an icon before it (`icon`, the line is then `with-icon` unless `plainIcon`),
 * `current` the one chosen now, `trailingIcon` an icon after the label (a remove mark). `index` goes in `data-i`.
 */
export function createChoice({ label, icon = null, current = false, className = '', index = null, trailingIcon = null, iconLayout = true }) {
  if (icon || trailingIcon) {
    return h(
      'div',
      { class: cx('choice', icon && iconLayout && 'with-icon', className, current && 'current'), 'data-i': index },
      icon ? iconNode(icon) : null,
      h('span', { text: label }),
      trailingIcon ? iconNode(trailingIcon) : null,
    );
  }
  return h('div', { class: cx('choice', className, current && 'current'), text: label, 'data-i': index });
}
