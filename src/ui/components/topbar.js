import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';

export const TOPBAR_ZONE = 'topbar';

// `id` is the section: it is what the bar highlights as "current", independently of the page
// (several sections still share the same placeholder page).
export const SECTIONS = [
  { id: 'search', labelKey: 'nav.search', route: 'comingSoon', params: { titleKey: 'nav.search' } },
  { id: 'home', labelKey: 'nav.home', route: 'home' },
  { id: 'live', labelKey: 'nav.live', route: 'comingSoon', params: { titleKey: 'nav.live' } },
  { id: 'movies', labelKey: 'nav.movies', route: 'comingSoon', params: { titleKey: 'nav.movies' } },
  { id: 'series', labelKey: 'nav.series', route: 'comingSoon', params: { titleKey: 'nav.series' } },
  { id: 'suggestions', labelKey: 'nav.suggestions', route: 'comingSoon', params: { titleKey: 'nav.suggestions' } },
  { id: 'provider', labelKey: 'nav.provider', route: 'providerSetup' },
  { id: 'settings', labelKey: 'nav.settings', route: 'settings' },
];

const SECTION_OF_ROUTE = { home: 'home', settings: 'settings', diagnostics: 'settings', providerSetup: 'provider' };

/** Section a router entry belongs to: explicit `params.section`, otherwise derived from the route name. */
export function sectionForEntry(entry) {
  if (!entry) return 'home';
  return (entry.params && entry.params.section) || SECTION_OF_ROUTE[entry.name] || 'home';
}

export function createTopbar(ctx) {
  const el = h('nav', { class: 'topbar', 'aria-label': 'Main' });
  let nodes = [];
  let currentSection = 'home';
  const indexOf = (id) => Math.max(0, SECTIONS.findIndex((s) => s.id === id));

  const zone = new FocusZone({
    id: TOPBAR_ZONE,
    model: new ListModel({ orientation: 'horizontal', getCount: () => SECTIONS.length }),
    onFocus: (i) => nodes[i] && nodes[i].classList.add('focused'),
    onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
    onActivate: (i) => {
      const section = SECTIONS[i];
      // focusTopbar: after switching section the focus stays on the bar (press Down to enter the page).
      ctx.router.reset(section.route, { ...(section.params || {}), section: section.id, focusTopbar: true });
    },
  });
  ctx.focus.register(zone);

  function render() {
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(h('span', { class: 'brand', text: t('app.title') }));
    nodes = SECTIONS.map((section) =>
      h('span', { class: `topbar-item${section.id === currentSection ? ' current' : ''}`, text: t(section.labelKey) }),
    );
    nodes.forEach((node) => el.appendChild(node));
    if (ctx.focus.activeId === TOPBAR_ZONE && nodes[zone.index]) nodes[zone.index].classList.add('focused');
  }

  render();
  return {
    el,
    zone,
    render,
    setVisible(visible) {
      el.style.display = visible ? '' : 'none';
    },
    /** Marks the section as current and parks the bar's cursor on it (so coming back lands on it). */
    setCurrentSection(id) {
      currentSection = id;
      zone.index = indexOf(id);
      render();
    },
    indexOfSection: indexOf,
  };
}
