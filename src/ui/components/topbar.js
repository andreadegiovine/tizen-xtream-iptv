import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { icon } from '../icons.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';

export const TOPBAR_ZONE = 'topbar';
export const SEARCH_BAR_ZONE = 'topbarSearch';
export const MIN_QUERY_LENGTH = 2;
const IME_DONE = 65376;
const IME_CANCEL = 65385;
const DEBOUNCE_MS = 300;

// `id` is the section: it is what the bar highlights as "current". `icon` items show only the icon
// (the label stays as aria-label); `end` items are pushed to the right edge of the screen.
// `action: 'search'` opens the search bar instead of navigating.
export const SECTIONS = [
  { id: 'home', labelKey: 'nav.home', route: 'home', icon: 'home', iconOnly: true },
  { id: 'movies', labelKey: 'nav.movies', route: 'browse', params: { type: 'movie' } },
  { id: 'series', labelKey: 'nav.series', route: 'browse', params: { type: 'series' } },
  { id: 'live', labelKey: 'nav.live', route: 'browse', params: { type: 'live' } },
  { id: 'search', labelKey: 'nav.search', route: 'search', icon: 'search', iconOnly: true, action: 'search' },
  { id: 'provider', labelKey: 'nav.provider', route: 'providers', icon: 'provider', iconOnly: true, end: true },
  { id: 'settings', labelKey: 'nav.settings', route: 'settings', icon: 'settings', iconOnly: true, end: true },
];

const SECTION_OF_ROUTE = { categories: 'settings', browse: 'home', search: 'search', suggestions: 'home', detail: 'home', player: 'home', home: 'home', settings: 'settings', diagnostics: 'settings', providers: 'provider', providerSetup: 'provider' };

/** Section a router entry belongs to: explicit `params.section`, otherwise derived from the route name. */
export function sectionForEntry(entry) {
  if (!entry) return 'home';
  return (entry.params && entry.params.section) || SECTION_OF_ROUTE[entry.name] || 'home';
}

/** True when the text is long enough to run a search. */
export const isSearchable = (text) => String(text || '').trim().length >= MIN_QUERY_LENGTH;

/**
 * Top navigation bar. In "search mode" it is replaced by a full-width text field with a close icon;
 * `handlers.onQuery(text)` fires (debounced) while typing, `handlers.onSubmit()` on Enter / Down,
 * `handlers.onClose()` when the user closes the search.
 */
export function createTopbar(ctx, handlers = {}) {
  const el = h('nav', { class: 'topbar', 'aria-label': 'Main' });
  let nodes = [];
  let currentSection = 'home';
  let searching = false;
  let input = null;
  let field = null;
  let closeBtn = null;
  let timer = null;
  const indexOf = (id) => Math.max(0, SECTIONS.findIndex((s) => s.id === id));

  const zone = new FocusZone({
    id: TOPBAR_ZONE,
    model: new ListModel({ orientation: 'horizontal', getCount: () => (searching ? 0 : SECTIONS.length) }),
    onFocus: (i) => nodes[i] && nodes[i].classList.add('focused'),
    onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
    onActivate: (i) => {
      const section = SECTIONS[i];
      if (section.action === 'search') {
        api.openSearch();
        return;
      }
      // focusTopbar: after switching section the focus stays on the bar (press Down to enter the page).
      ctx.router.reset(section.route, { ...(section.params || {}), section: section.id, focusTopbar: true });
    },
  });
  ctx.focus.register(zone);

  const searchZone = new FocusZone({
    id: SEARCH_BAR_ZONE,
    model: new ListModel({ orientation: 'horizontal', getCount: () => 2 }),
    onFocus: (i) => (i === 0 ? field : closeBtn) && (i === 0 ? field : closeBtn).classList.add('focused'),
    onBlur: (i) => (i === 0 ? field : closeBtn) && (i === 0 ? field : closeBtn).classList.remove('focused'),
    onActivate: (i) => (i === 0 ? input.focus() : api.closeSearch()),
  });

  function renderNav() {
    while (el.firstChild) el.removeChild(el.firstChild);
    nodes = [];
    let spacerAdded = false;
    SECTIONS.forEach((section) => {
      if (section.end && !spacerAdded) {
        el.appendChild(h('span', { class: 'topbar-spacer' }));
        spacerAdded = true;
      }
      const label = t(section.labelKey);
      const node = h('span', { class: `topbar-item${section.id === currentSection ? ' current' : ''}${section.iconOnly ? ' icon-only' : ''}`, 'aria-label': label });
      if (section.icon) node.appendChild(icon(section.icon));
      if (!section.iconOnly) node.appendChild(h('span', { text: label }));
      nodes.push(node);
      el.appendChild(node);
    });
    if (ctx.focus.activeId === TOPBAR_ZONE && nodes[zone.index]) nodes[zone.index].classList.add('focused');
  }

  function renderSearch(initial) {
    while (el.firstChild) el.removeChild(el.firstChild);
    input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: t('search.placeholder') });
    input.value = initial || '';
    field = h('label', { class: 'topbar-search' }, icon('search'), input);
    closeBtn = h('span', { class: 'topbar-item icon-only', 'aria-label': t('search.close') }, icon('close'));
    el.append(field, closeBtn);
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => handlers.onQuery && handlers.onQuery(input.value), DEBOUNCE_MS);
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation(); // the text field owns its keys
      const code = event.keyCode;
      if (code === 13 || code === IME_DONE || code === 40) {
        event.preventDefault();
        input.blur();
        clearTimeout(timer);
        if (handlers.onQuery) handlers.onQuery(input.value);
        if (handlers.onSubmit) handlers.onSubmit();
      } else if (code === IME_CANCEL) {
        input.blur();
      } else if (code === 27 || code === 10009) {
        event.preventDefault();
        api.closeSearch();
      }
    });
  }

  const api = {
    el,
    zone,
    searchZone,
    render() {
      if (!searching) renderNav();
    },
    setVisible(visible) {
      el.style.display = visible ? '' : 'none';
    },
    /** Marks the section as current and parks the bar's cursor on it (so coming back lands on it). */
    setCurrentSection(id) {
      currentSection = id;
      zone.index = indexOf(id);
      api.render();
    },
    indexOfSection: indexOf,
    isSearching: () => searching,
    getQuery: () => (input ? input.value : ''),
    /** Shows the search field. `silent` keeps the current focus (used when the results page is restored). */
    openSearch({ query = '', silent = false } = {}) {
      if (searching) return;
      searching = true;
      el.classList.add('searching');
      renderSearch(query);
      ctx.focus.register(searchZone);
      // While searching the section bar is empty: pages that go "up" to it are sent to the search field.
      ctx.focus.link(TOPBAR_ZONE, 'up', SEARCH_BAR_ZONE);
      api.syncSearchLinks();
      if (!silent) {
        ctx.focus.focus(SEARCH_BAR_ZONE, 0);
        input.focus();
      }
    },
    /** Back to the normal bar. `notify: false` when the caller already navigated away. */
    closeSearch({ notify = true } = {}) {
      if (!searching) return;
      clearTimeout(timer);
      searching = false;
      el.classList.remove('searching');
      if (input) input.blur();
      input = null;
      field = null;
      closeBtn = null;
      ctx.focus.unregister(SEARCH_BAR_ZONE);
      const links = ctx.focus.links.get(TOPBAR_ZONE);
      if (links) delete links.up;
      renderNav();
      if (notify && handlers.onClose) handlers.onClose();
    },
    /** "Down" from the search field goes where "Down" from the section bar goes (the page's first zone). */
    syncSearchLinks() {
      const links = ctx.focus.links.get(TOPBAR_ZONE);
      if (searching && links && links.down) ctx.focus.link(SEARCH_BAR_ZONE, 'down', links.down);
    },
    /** Lets main.js attach the handlers after the router exists. */
    setHandlers(next) {
      Object.assign(handlers, next);
    },
  };

  renderNav();
  return api;
}
