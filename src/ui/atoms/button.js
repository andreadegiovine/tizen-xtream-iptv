import { h, cx } from '../dom.js';
import { icon as iconNode } from '../icons.js';

/**
 * Button (`button.btn`): a text, or an icon only (`icon` without `label`, or `iconOnly`). `variant`: 'primary' | 'danger' | ''.
 * `label` is the text shown, or only the accessible name when the button shows an icon (`ariaLabel`, `title` set apart if needed).
 */
export function createButton({ label = '', icon = null, variant = '', iconOnly = null, className = '', ariaLabel = null, title = null } = {}) {
  const onlyIcon = iconOnly === null ? Boolean(icon) && !label : iconOnly;
  const name = ariaLabel !== null ? ariaLabel : onlyIcon ? label || null : null;
  return h(
    'button',
    { class: cx('btn', variant, onlyIcon && icon ? 'icon-only' : '', className), type: 'button', 'aria-label': name, title },
    icon ? iconNode(icon) : null,
    onlyIcon ? null : label,
  );
}
