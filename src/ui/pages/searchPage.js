import { h } from '../dom.js';
import { createHint } from '../atoms/hint.js';
import { createSkeletonLine } from '../atoms/skeleton.js';
import { createListRow } from '../atoms/listRow.js';
import { t, i18n } from '../../i18n/index.js';
import { createTypedRows } from '../components/typedRows.js';
import { createSkeletonCard } from '../components/card.js';
import { collectionEntry } from '../../services/collections.js';
import { getEntry } from '../../services/catalogQuery.js';
import { log } from '../../core/logger.js';
import { formatClockTime } from '../../core/clock.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { ensureVisible } from '../scroll.js';

const PER_TYPE = 100; // results per type (the rows load their cards lazily)
const RECENT_ZONE = 'searchRecent';

/**
 * Search page: the last searches while nothing is typed, placeholders while a search runs, then the results as one carousel per type. The text field lives in the top bar:
 * it calls setQuery() while typing and focusResults() on Enter / Down.
 */
export function createSearchPage(ctx, params = {}) {
  const status = createHint({ className: 'search-status' });
  const rows = createTypedRows(ctx, { prefix: 'search', limit: PER_TYPE, linkFromField: true, onOpen: (entry) => remember() || open(entry) });

  /** A collection opens its page; a programme opens its channel / group with the focus on it; the rest opens its detail page. */
  function open(entry) {
    if (entry.collectionId) return ctx.router.push('collection', { id: entry.collectionId, section: 'search' });
    if (entry.isProgramme) return ctx.openEntry(entry.row, { section: 'search', programme: entry.start });
    return ctx.openEntry(entry, { section: 'search' });
  }

  /** Programmes of the guide whose title matches, as cards: the picture of their channel / group, "21:00 – 22:30" under the title. */
  async function matchingProgrammes(text) {
    if (!ctx.epg || !ctx.epg.searchProgrammes) return [];
    const current = await ctx.active.get();
    if (!current) return [];
    const [found, prefs] = await Promise.all([ctx.epg.searchProgrammes(text, { limit: PER_TYPE }), ctx.settings.get()]);
    const format = (ms) => formatClockTime(new Date(ms), prefs.timeFormat || 'auto', i18n.getLocale());
    const out = [];
    for (const p of found) {
      const row = await getEntry(current.db, p.rowKey).catch(() => null);
      if (!row) continue;
      out.push({
        key: `programme:${p.channelId}:${p.start}`,
        type: 'programme',
        isProgramme: true,
        name: p.title,
        icon: row.icon,
        adult: row.adult,
        subtitle: `${format(p.start)} – ${format(p.stop)}`,
        start: p.start,
        row,
      });
    }
    return out;
  }
  const skeleton = h('div', { class: 'search-skeleton' }, createSkeletonLine({ className: 'title' }), h('div', { class: 'skeleton-row' }, [0, 1, 2, 3, 4, 5].map(() => createSkeletonCard())));
  skeleton.style.display = 'none';
  const recentList = h('div', { class: 'list search-recent-list' });
  const recentEl = h('div', { class: 'search-recent' }, recentList);
  recentEl.style.display = 'none';
  let recentNodes = [];
  let recent = [];
  let recentRegistered = false;
  let query = '';
  let token = 0;
  let destroyed = false;

  /** The text of the search whose result was opened counts as a real search: it goes in the recent ones. */
  function remember() {
    if (ctx.searchHistory && query.length >= 2) ctx.searchHistory.add(query).catch(() => undefined);
    return false;
  }

  const recentZone = new FocusZone({
    id: RECENT_ZONE,
    nodes: () => recentNodes,
    model: new ListModel({ orientation: 'vertical', getCount: () => recent.length }),
    onFocus: (i) => {
      if (!recentNodes[i]) return;
      recentNodes[i].classList.add('focused');
      ensureVisible(recentNodes[i], { first: i === 0 });
    },
    onBlur: (i) => recentNodes[i] && recentNodes[i].classList.remove('focused'),
    onActivate: (i) => {
      const text = recent[i];
      if (!text) return;
      if (ctx.setSearchText) ctx.setSearchText(text); // the text goes in the field of the top bar
      if (ctx.searchHistory) ctx.searchHistory.add(text).catch(() => undefined);
      page.setQuery(text).then(() => rows.focusFirst());
    },
  });

  function hideRecent() {
    recentEl.style.display = 'none';
    if (recentRegistered) {
      ctx.focus.unregister(RECENT_ZONE);
      recentRegistered = false;
    }
  }

  /** The last searches, as a list to pick from (nothing when there are none). */
  async function showRecent() {
    const mine = (token += 1);
    rows.set([]);
    skeleton.style.display = 'none';
    status.textContent = '';
    const list = ctx.searchHistory ? await ctx.searchHistory.list().catch(() => []) : [];
    if (destroyed || mine !== token) return;
    recent = list;
    while (recentList.firstChild) recentList.removeChild(recentList.firstChild);
    recentNodes = recent.map((text) => createListRow({ label: text }).el);
    recentNodes.forEach((node) => recentList.appendChild(node));
    recentEl.style.display = recent.length ? '' : 'none';
    if (!recent.length) return;
    if (!recentRegistered) {
      ctx.focus.register(recentZone);
      recentRegistered = true;
    }
    if (ctx.linkSearchDown) ctx.linkSearchDown(RECENT_ZONE);
  }

  /** Collections whose name matches, as card entries (shown first, in their own carousel). */
  async function matchingCollections(text) {
    const current = await ctx.active.get();
    if (!current) return [];
    const list = await ctx.collections.search(current.provider.id, text);
    return Promise.all(list.slice(0, PER_TYPE).map((c) => collectionEntry(current.db, c, getEntry, (count) => t('collections.items', { count }))));
  }

  let running = false; // a search is under way: its placeholders stay until it answers

  async function run() {
    if (query.length < 2) {
      await showRecent();
      return;
    }
    hideRecent();
    const mine = (token += 1);
    skeleton.style.display = '';
    running = true;
    try {
      const found = query.length < 2 ? [] : await ctx.search.search(query, { limit: PER_TYPE * 6 });
      if (query.length >= 2 && ctx.collections) found.push(...(await matchingCollections(query)));
      if (query.length >= 2) found.push(...(await matchingProgrammes(query).catch(() => [])));
      if (destroyed || mine !== token) return;
      rows.set(found);
      skeleton.style.display = 'none';
      status.textContent = query.length >= 2 && !found.length ? t('common.empty') : '';
    } catch (err) {
      skeleton.style.display = 'none';
      log.warn('Search failed', err && err.message);
    } finally {
      if (mine === token) running = false;
    }
  }

  const page = {
    el: h('section', { class: 'page search' }, recentEl, status, skeleton, rows.el),
    mount() {
      query = String(params.query || '').trim();
      run();
    },
    destroy() {
      destroyed = true;
      hideRecent();
      rows.destroy();
    },
    /**
     * Called at every keystroke (before the debounce): the placeholders replace the recent searches until the results arrive. The TV
     * keyboard also sends an input event when it closes (Down / Done) without changing the text: then the results stay as they are.
     */
    showSkeleton(text) {
      if (text !== undefined && String(text).trim() === query && query.length >= 2) return;
      hideRecent();
      status.textContent = '';
      skeleton.style.display = '';
    },
    /** The field was emptied: the recent searches are back. */
    showRecent() {
      query = '';
      return showRecent();
    },
    /** Called by the top bar while typing. */
    setQuery(text) {
      const next = String(text || '').trim();
      if (next === query) {
        // Same text (e.g. Enter / Down after typing): keep the cards and the focus, and never leave placeholders on screen.
        if (!running) skeleton.style.display = 'none';
        return Promise.resolve();
      }
      query = next;
      return run();
    },
    getQuery: () => query,
    /** Moves the focus from the search field to the first result. */
    focusResults: () => rows.focusFirst() || (recentRegistered && recent.length ? ctx.focus.focus(RECENT_ZONE, 0) : false),
    saveState: () => ({ query, focus: rows.savedFocus() }),
    restoreState(state) {
      if (state && state.query) {
        query = state.query;
        run().then(() => rows.focusSaved(state.focus)); // back on the result that was opened
      }
    },
  };
  return page;
}
