import { h } from '../dom.js';
import { t } from '../../i18n/index.js';

export function createHomePage(ctx) {
  const el = h('section', { class: 'page home' }, h('h1', { text: t('app.title') }));
  ctx.providers.getActive().then((provider) => {
    if (!provider) return;
    el.appendChild(h('p', { class: 'muted', text: `${t('home.provider')}: ${provider.name}` }));
    el.appendChild(h('p', { text: t('home.placeholder') }));
  });
  return { el };
}

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
