import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import LOGO_SVG from '../../../logo.svg';

/** The X mark on its square (no rounded corners, no wordmark): logo.svg at the root of the repository, the drawing of the app icons too. */
export const MARK = LOGO_SVG.trim();

/** App logo (X mark + wordmark) shown at the left of the top bar; not focusable. */
export function createLogo() {
  const mark = h('span', { class: 'logo-mark' });
  mark.innerHTML = MARK;
  return h('span', { class: 'logo', 'aria-label': t('app.name') }, mark);
}
