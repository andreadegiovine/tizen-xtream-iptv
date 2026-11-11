import { h } from '../dom.js';
import { createHeading } from '../atoms/heading.js';
import { createHint } from '../atoms/hint.js';
import { t } from '../../i18n/index.js';

export function createComingSoonPage(_ctx, params = {}) {
  return {
    el: h(
      'section',
      { class: 'page' },
      createHeading({ level: 1, text: t(params.titleKey || 'common.comingSoon') }),
      createHint({ text: t('common.comingSoonText') }),
    ),
  };
}
