import { h } from '../dom.js';
import { t } from '../../i18n/index.js';

export function createComingSoonPage(_ctx, params = {}) {
  return {
    el: h(
      'section',
      { class: 'page' },
      h('h1', { text: t(params.titleKey || 'common.comingSoon') }),
      h('p', { class: 'muted', text: t('common.comingSoonText') }),
    ),
  };
}
