import { h, cx } from '../dom.js';
import { icon as iconNode } from '../icons.js';
import { setTip } from '../tooltip.js';

/**
 * Button (`button.btn`): a text, or an icon only (`icon` without `label`, or `iconOnly`). `variant`: 'primary' | 'danger' | ''.
 * `label` is the text shown, or only the accessible name when the button shows an icon (`ariaLabel` set apart if needed): an icon
 * only button shows it as its tooltip (`tipDir` 'up' or 'down').
 */
export function createButton({ label = '', icon = null, variant = '', iconOnly = null, className = '', ariaLabel = null, tipDir = 'up' } = {}) {
  const onlyIcon = iconOnly === null ? Boolean(icon) && !label : iconOnly;
  const name = ariaLabel !== null ? ariaLabel : onlyIcon ? label || null : null;
  const el = h('button', { class: cx('btn', variant, onlyIcon && icon ? 'icon-only' : '', className), type: 'button', 'aria-label': name }, icon ? iconNode(icon) : null, onlyIcon ? null : label);
  return onlyIcon && icon ? setTip(el, name, tipDir) : el;
}
