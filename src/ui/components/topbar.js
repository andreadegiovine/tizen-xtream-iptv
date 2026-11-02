import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';

export const TOPBAR_ZONE = 'topbar';

const ITEMS = [
  { id: 'search', labelKey: 'nav.search', route: 'comingSoon', params: { titleKey: 'nav.search' } },
  { id: 'home', labelKey: 'nav.home', route: 'home' },
  { id: 'live', labelKey: 'nav.live', route: 'comingSoon', params: { titleKey: 'nav.live' } },
  { id: 'movies', labelKey: 'nav.movies', route: 'comingSoon', params: { titleKey: 'nav.movies' } },
  { id: 'series', labelKey: 'nav.series', route: 'comingSoon', params: { titleKey: 'nav.series' } },
  { id: 'suggestions', labelKey: 'nav.suggestions', route: 'comingSoon', params: { titleKey: 'nav.suggestions' } },
  { id: 'provider', labelKey: 'nav.provider', route: 'providerSetup' },
  { id: 'settings', labelKey: 'nav.settings', route: 'settings' },
];

export function createTopbar(ctx) {
  const el = h('nav', { class: 'topbar', 'aria-label': 'Main' });
  let nodes = [];
  let activeRoute = 'home';

  const zone = new FocusZone({
    id: TOPBAR_ZONE,
    model: new ListModel({ orientation: 'horizontal', getCount: () => ITEMS.length }),
    onFocus: (i) => nodes[i] && nodes[i].classList.add('focused'),
    onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
    onActivate: (i) => {
      const item = ITEMS[i];
      ctx.router.reset(item.route, item.params || {});
    },
  });
  ctx.focus.register(zone);

  function render() {
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(h('span', { class: 'brand', text: t('app.title') }));
    nodes = ITEMS.map((item) =>
      h('span', { class: `topbar-item${item.route === activeRoute ? ' current' : ''}`, text: t(item.labelKey) }),
    );
    nodes.forEach((node) => el.appendChild(node));
    if (ctx.focus.activeId === TOPBAR_ZONE) nodes[zone.index].classList.add('focused');
  }

  render();
  return {
    el,
    zone,
    render,
    setVisible(visible) {
      el.style.display = visible ? '' : 'none';
    },
    setCurrentRoute(route) {
      activeRoute = route;
      render();
    },
    indexForRoute(route) {
      const index = ITEMS.findIndex((item) => item.route === route);
      return index === -1 ? 1 : index;
    },
  };
}
