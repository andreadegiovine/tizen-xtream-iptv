import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { createTypedRows } from '../components/typedRows.js';
import { createSkeletonCard } from '../components/card.js';
import { collectionEntry } from '../../services/collections.js';
import { getEntry } from '../../services/catalogQuery.js';
import { log } from '../../core/logger.js';

const PER_TYPE = 20;

/**
 * Search results as one carousel per type. The text field lives in the top bar:
 * it calls setQuery() while typing and focusResults() on Enter / Down.
 */
export function createSearchPage(ctx, params = {}) {
  const status = h('p', { class: 'muted search-status' });
  const rows = createTypedRows(ctx, { prefix: 'search', limit: PER_TYPE, onOpen: (entry) => (entry.collectionId ? ctx.router.push('collection', { id: entry.collectionId, section: 'search' }) : ctx.openEntry(entry, { section: 'search' })) });
  const skeleton = h('div', { class: 'search-skeleton' }, h('div', { class: 'skeleton-line title' }), h('div', { class: 'skeleton-row' }, [0, 1, 2, 3, 4, 5].map(() => createSkeletonCard())));
  skeleton.style.display = 'none';
  let query = '';
  let token = 0;
  let destroyed = false;

  /** Collections whose name matches, as card entries (shown first, in their own carousel). */
  async function matchingCollections(text) {
    const current = await ctx.active.get();
    if (!current) return [];
    const list = await ctx.collections.search(current.provider.id, text);
    return Promise.all(list.slice(0, PER_TYPE).map((c) => collectionEntry(current.db, c, getEntry, (count) => t('collections.items', { count }))));
  }

  async function run() {
    const mine = (token += 1);
    if (query.length >= 2) skeleton.style.display = '';
    try {
      const found = query.length < 2 ? [] : await ctx.search.search(query, { limit: PER_TYPE * 6 });
      if (query.length >= 2 && ctx.collections) found.push(...(await matchingCollections(query)));
      if (destroyed || mine !== token) return;
      rows.set(found);
      skeleton.style.display = 'none';
      status.textContent = query.length >= 2 && !found.length ? t('common.empty') : '';
    } catch (err) {
      skeleton.style.display = 'none';
      log.warn('Search failed', err && err.message);
    }
  }

  return {
    el: h('section', { class: 'page search' }, status, skeleton, rows.el),
    mount() {
      query = String(params.query || '').trim();
      if (query) run();
    },
    destroy() {
      destroyed = true;
      rows.destroy();
    },
    /** Called at every keystroke (before the debounce): placeholders until the results arrive. */
    showSkeleton() {
      status.textContent = '';
      skeleton.style.display = '';
    },
    /** Called by the top bar while typing. */
    setQuery(text) {
      const next = String(text || '').trim();
      if (next === query) return Promise.resolve(); // same text (e.g. Enter after typing): keep the cards and the focus
      query = next;
      return run();
    },
    getQuery: () => query,
    /** Moves the focus from the search field to the first result. */
    focusResults: () => rows.focusFirst(),
    saveState: () => ({ query }),
    restoreState(state) {
      if (state && state.query) {
        query = state.query;
        run().then(() => rows.focusFirst());
      }
    },
  };
}
