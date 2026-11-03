import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { listCategories } from '../../services/catalogQuery.js';
import { rebuildEntries } from '../../services/catalogSync.js';
import { openProviderDb } from '../../db/providerDb.js';
import { icon } from '../icons.js';
import { log } from '../../core/logger.js';

const ZONE_ID = 'categories';
const TYPES = ['movie', 'series', 'live'];
const TYPE_LABEL = { movie: 'nav.movies', series: 'nav.series', live: 'nav.live' };

/** Pure: toggles an id in a set copy. */
export function toggleId(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Choose the categories to hide per media type; applying rebuilds the grids without re-downloading. */
export function createCategoriesPage(ctx, params = {}) {
  const status = h('p', { class: 'muted search-status' });
  const list = h('div', { class: 'list categories-list' });
  let type = 'movie';
  let categories = [];
  let excluded = new Set();
  let original = new Set();
  let rows = []; // { el, activate }
  let providerId = null;
  let db = null; // database of the provider being edited
  let ownDb = false; // opened here (not the active provider's shared handle): closed on leave
  let destroyed = false;
  let busy = false;

  const zone = new FocusZone({
    id: ZONE_ID,
    model: new ListModel({ orientation: 'vertical', getCount: () => rows.length }),
    onFocus: (i) => {
      rows[i].el.classList.add('focused');
      ensureVisible(rows[i].el, { first: i === 0 });
    },
    onBlur: (i) => rows[i] && rows[i].el.classList.remove('focused'),
    onActivate: (i) => rows[i] && rows[i].activate(),
  });


  function build(focusIndex = 0) {
    while (list.firstChild) list.removeChild(list.firstChild);
    const typeRow = { el: h('div', { class: 'row' }, h('span', { text: t('categories.type') }), h('span', { class: 'value', text: t(TYPE_LABEL[type]) })), activate: chooseType };
    const catRows = categories.map((c) => {
      // Eye = shown in the app, crossed-out eye = hidden (row dimmed).
      const mark = h('span', { class: 'cat-mark' });
      const el = h('div', { class: 'row cat-row' }, mark, h('span', { class: 'cat-name', text: c.name }));
      const show = () => {
        const hidden = excluded.has(c.id);
        el.classList.toggle('hidden', hidden);
        while (mark.firstChild) mark.removeChild(mark.firstChild);
        mark.appendChild(icon(hidden ? 'hidden' : 'seen'));
      };
      show();
      return {
        el,
        activate() {
          excluded = toggleId(excluded, c.id);
          show();
          status.textContent = '';
        },
      };
    });
    const apply = { el: h('button', { class: 'btn primary', type: 'button', text: t('categories.apply') }), activate: applyChanges };
    rows = [typeRow, apply, ...catRows];
    rows.forEach((r) => list.appendChild(r.el));
    if (ctx.focus.activeId === ZONE_ID) ctx.focus.focus(ZONE_ID, Math.min(focusIndex, rows.length - 1));
  }

  async function loadType(nextType) {
    type = nextType;
    if (!db) {
      const activeProvider = await ctx.active.get();
      const wanted = params.providerId || (activeProvider && activeProvider.provider.id);
      if (!wanted || destroyed) return;
      if (activeProvider && activeProvider.provider.id === wanted) db = activeProvider.db;
      else {
        db = await openProviderDb(wanted);
        ownDb = true;
      }
      providerId = wanted;
    }
    if (destroyed) return;
    categories = (await listCategories(db, type)).map((c) => ({ id: c.id, name: c.name }));
    excluded = await ctx.settings.getExcluded(providerId, type);
    original = new Set(excluded);
    build(0);
  }

  async function chooseType() {
    const value = await ctx.dialogs.choose({ title: t('categories.type'), options: TYPES.map((v) => ({ label: t(TYPE_LABEL[v]), value: v })), selected: type });
    if (value !== null && value !== type) await loadType(value);
  }

  async function applyChanges() {
    if (busy) return;
    if (ctx.catalog.getState().running && ctx.catalog.getState().providerId === providerId) {
      status.textContent = t('categories.busy');
      return;
    }
    busy = true;
    status.textContent = t('categories.applying');
    try {
      await ctx.settings.setExcluded(providerId, type, Array.from(excluded));
      if (excluded.size !== original.size || Array.from(excluded).some((id) => !original.has(id))) {
        await rebuildEntries({ db, type, excludedCategories: excluded });
        ctx.search.invalidate();
      }
      original = new Set(excluded);
      status.textContent = t('categories.done');
    } catch (err) {
      log.warn('Applying categories failed', err && err.message);
      status.textContent = t('error.STORAGE');
    } finally {
      busy = false;
    }
  }

  return {
    el: h('section', { class: 'page framed' }, h('div', { class: 'page-container' }, h('h1', { text: t('settings.categories') }), status, list)),
    mount() {
      ctx.focus.register(zone);
      ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
      loadType(type).then(() => ctx.focus.focus(ZONE_ID, 0));
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(ZONE_ID);
      if (ownDb && db) db.close();
    },
  };
}
