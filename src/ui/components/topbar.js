import { h } from '../dom.js';
import { createTopbarItem, createTopbarItemSkeleton } from '../atoms/topbarItem.js';
import { createTextInput } from '../atoms/textInput.js';
import { t, i18n } from '../../i18n/index.js';
import { icon } from '../icons.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { createLogo } from './logo.js';
import { formatClockTime, formatClockDate } from '../../core/clock.js';

export const TOPBAR_ZONE = 'topbar';
export const SEARCH_BAR_ZONE = 'topbarSearch';
export const MIN_QUERY_LENGTH = 2;
const IME_DONE = 65376;
const IME_CANCEL = 65385;
const DEBOUNCE_MS = 400; // search starts 0.4 s after the last key (Enter starts it at once): the index answers at once from its worker

// `id` is the section: it is what the bar highlights as "current". `icon` items show only the icon
// (the label stays as aria-label); `end` items are pushed to the right edge of the screen.
// `action: 'search'` opens the search bar instead of navigating.
export const SECTIONS = [
  { id: 'home', labelKey: 'nav.home', route: 'home', icon: 'home', iconOnly: true },
  { id: 'search', labelKey: 'nav.search', route: 'search', icon: 'search', iconOnly: true, action: 'search' },
  { id: 'movies', labelKey: 'nav.movies', route: 'browse', params: { type: 'movie' } },
  { id: 'series', labelKey: 'nav.series', route: 'browse', params: { type: 'series' } },
  { id: 'live', labelKey: 'nav.live', route: 'browse', params: { type: 'live' } },
  { id: 'favorites', labelKey: 'nav.favorites', route: 'favorites' },
  { id: 'collections', labelKey: 'nav.collections', route: 'collections' },
  { id: 'suggestions', labelKey: 'nav.suggestions', route: 'suggestions' },
  { id: 'provider', labelKey: 'nav.provider', route: 'providers', icon: 'provider', iconOnly: true, end: true },
  { id: 'settings', labelKey: 'nav.settings', route: 'settings', icon: 'settings', iconOnly: true, end: true },
];

// Shown only while a page offers it (a category or genre grid): adds / removes the open grid from the favourites.

const SECTION_OF_ROUTE = { categories: 'settings', browse: 'home', search: 'search', suggestions: 'suggestions', favorites: 'favorites', collections: 'collections', collection: 'collections', network: 'live', detail: 'home', player: 'home', home: 'home', settings: 'settings', diagnostics: 'settings', providers: 'provider', providerSetup: 'provider' };

/** Section a router entry belongs to: explicit `params.section`, otherwise derived from the route name. */
export function sectionForEntry(entry) {
  if (!entry) return 'home';
  return (entry.params && entry.params.section) || SECTION_OF_ROUTE[entry.name] || 'home';
}

/** True when the text is long enough to run a search. */
export const isSearchable = (text) => String(text || '').trim().length >= MIN_QUERY_LENGTH;

/**
 * Top navigation bar. In "search mode" the sections are replaced by a text field with a close icon, between the logo and the clock;
 * `handlers.onOpen()` fires when the user opens the search, `handlers.onCleared()` when the field is emptied, `handlers.onQuery(text)` fires (debounced) while typing, `handlers.onSubmit()` on Enter / Down,
 * `handlers.onClose()` when the user closes the search.
 */
export function createTopbar(ctx, handlers = {}) {
  const el = h('nav', { class: 'topbar', 'aria-label': t('a11y.mainNav') });
  let nodes = [];
  let currentSection = 'home';
  let searching = false;
  let skeleton = false; // first start: logo and placeholder items, nothing to focus
  let input = null;
  let field = null;
  let closeBtn = null;
  let timer = null;
  let hidden = new Set(); // sections left out of the bar (empty favourites, collections, suggestions; or not offered by the provider)
  const items = () => SECTIONS.filter((section) => !hidden.has(section.id));
  const indexOf = (id) => Math.max(0, items().findIndex((s) => s.id === id));

  const zone = new FocusZone({
    id: TOPBAR_ZONE,
    model: new ListModel({ orientation: 'horizontal', getCount: () => (searching || skeleton ? 0 : items().length) }),
    onFocus: (i) => nodes[i] && nodes[i].classList.add('focused'),
    onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
    onActivate: (i) => {
      const section = items()[i];
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
    el.setAttribute('aria-label', t('a11y.mainNav')); // again after a language change
    while (el.firstChild) el.removeChild(el.firstChild);
    nodes = [];
    let spacerAdded = false;
    el.appendChild(createLogo());
    items().forEach((section) => {
      if (section.end && !spacerAdded) {
        el.appendChild(h('span', { class: 'topbar-spacer' }));
        spacerAdded = true;
      }
      if (skeleton) {
        el.appendChild(createTopbarItemSkeleton({ icon: section.iconOnly }));
        return;
      }
      const label = t(section.labelKey);
      const node = createTopbarItem({ label, icon: section.icon || null, iconOnly: Boolean(section.iconOnly), current: section.id === currentSection });
      nodes.push(node);
      el.appendChild(node);
    });
    appendClock();
    if (ctx.focus.activeId === TOPBAR_ZONE && nodes[zone.index]) nodes[zone.index].classList.add('focused');
  }

  /** Time over date at the right edge (also while the search field is open). */
  function appendClock() {
    clockTime = h('span', { class: 'clock-time' });
    clockDate = h('span', { class: 'clock-date' });
    el.appendChild(h('span', { class: 'topbar-clock', 'aria-hidden': 'true' }, clockTime, clockDate));
    paintClock();
  }

  // Time over date, at the right edge after the settings icon; it follows the system format unless Settings says otherwise.
  let clockTime = null;
  let clockDate = null;
  let clockFormats = { timeFormat: 'auto', dateFormat: 'auto' };
  let clockTimer = null;
  function paintClock() {
    if (!clockTime) return;
    const now = new Date();
    clockTime.textContent = formatClockTime(now, clockFormats.timeFormat, i18n.getLocale());
    clockDate.textContent = formatClockDate(now, clockFormats.dateFormat, i18n.getLocale());
  }
  function scheduleClock() {
    clearTimeout(clockTimer);
    const wait = 60000 - (Date.now() % 60000) + 50; // wake just after the minute changes
    clockTimer = setTimeout(() => {
      paintClock();
      scheduleClock();
    }, wait);
  }
  async function refreshClock() {
    try {
      const { timeFormat, dateFormat } = await ctx.settings.get();
      clockFormats = { timeFormat, dateFormat };
    } catch {
      /* keep the system formats */
    }
    paintClock();
  }

  function renderSearch(initial) {
    while (el.firstChild) el.removeChild(el.firstChild);
    input = createTextInput({ placeholder: t('search.placeholder') });
    input.value = initial || '';
    field = h('label', { class: 'topbar-search' }, icon('search'), input);
    closeBtn = createTopbarItem({ label: t('search.close'), icon: 'close', iconOnly: true });
    el.append(createLogo(), field, closeBtn); // the field takes the room between the logo and the clock
    appendClock();
    input.addEventListener('input', () => {
      clearTimeout(timer);
      if (!input.value.trim()) {
        if (handlers.onCleared) handlers.onCleared(); // empty field: the recent searches again
        return;
      }
      if (handlers.onTyping) handlers.onTyping(input.value);
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
    /** Placeholder items (same sections, no labels, not focusable) while there is no provider yet. */
    setSkeleton(on) {
      if (skeleton === on) return;
      skeleton = on;
      if (!searching) renderNav();
    },
    setVisible(visible) {
      el.style.display = visible ? '' : 'none';
    },
    /** Leaves the given sections out of the bar (the others shift); the cursor stays on the same section when it is still there. */
    setHidden(ids) {
      const next = new Set(ids);
      if (next.size === hidden.size && Array.from(next).every((id) => hidden.has(id))) return;
      const focusedId = (items()[zone.index] || {}).id;
      hidden = next;
      zone.index = focusedId && !hidden.has(focusedId) ? indexOf(focusedId) : indexOf(currentSection);
      api.render();
    },
    isHidden: (id) => hidden.has(id),
    /** Marks the section as current and parks the bar's cursor on it (so coming back lands on it). */
    setCurrentSection(id) {
      currentSection = id;
      zone.index = indexOf(id);
      api.render();
    },
    indexOfSection: indexOf,
    refreshClock,
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
        if (handlers.onOpen) handlers.onOpen(); // the search page (with the recent searches) opens at once
      }
    },
    /** Puts a text in the search field (a recent search picked from the list). */
    setQuery(text) {
      if (input) input.value = text;
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
  refreshClock();
  scheduleClock();
  return api;
}
