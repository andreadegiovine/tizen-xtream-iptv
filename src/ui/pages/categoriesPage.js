import { h } from '../dom.js';
import { createHint } from '../atoms/hint.js';
import { createListRow } from '../atoms/listRow.js';
import { createButton } from '../atoms/button.js';
import { createHeading } from '../atoms/heading.js';
import { framedPage } from '../components/formPage.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { ensureVisible } from '../scroll.js';
import { listCategories } from '../../services/catalogQuery.js';
import { markStale } from '../../services/catalogSync.js';
import { openProviderDb } from '../../db/providerDb.js';
import { icon } from '../icons.js';
import { log } from '../../core/logger.js';

const ZONE_ID = 'categories';
const MULTI_ZONE = 'categoriesMulti';
const SAVE_DELAY_MS = 2000; // changes are saved this long after the last one
const TYPES = ['movie', 'series', 'live'];
const TYPE_LABEL = { movie: 'nav.movies', series: 'nav.series', live: 'nav.live' };

/** Pure: toggles an id in a set copy. */
export function toggleId(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Pure: the ids between two row positions (inclusive, either order) flipped against `base`. */
export function flipRange(base, ids, from, to) {
  let next = new Set(base);
  for (let k = Math.min(from, to); k <= Math.max(from, to); k += 1) if (k >= 0 && k < ids.length) next = toggleId(next, ids[k]);
  return next;
}

/** Choose the categories to hide per media type; changes are saved 2 s after the last one and rebuild the grids without re-downloading. */
export function createCategoriesPage(ctx, params = {}) {
  const status = createHint({ className: 'search-status' });
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
  let saveTimer = null;
  let armed = false; // multiple selection switched on
  let anchor = null; // row where the selection started
  let base = null; // excluded set when the selection started

  const zone = new FocusZone({
    id: ZONE_ID,
    nodes: () => rows.map((row) => row.el),
    model: new ListModel({ orientation: 'vertical', getCount: () => rows.length }),
    onFocus: (i) => {
      if (anchor !== null && i >= 1) preview(i);
      rows[i].el.classList.add('focused');
      ensureVisible(rows[i].el, { first: i === 0 });
    },
    onBlur: (i) => rows[i] && rows[i].el.classList.remove('focused'),
    onActivate: (i) => rows[i] && rows[i].activate(),
  });


  function build(focusIndex = 0) {
    while (list.firstChild) list.removeChild(list.firstChild);
    const typeRow = { el: createListRow({ label: t('categories.type'), value: t(TYPE_LABEL[type]) }).el, activate: chooseType };
    const catRows = categories.map((c) => {
      // Eye = shown in the app, crossed-out eye = hidden (row dimmed).
      const mark = h('span', { class: 'cat-mark' });
      const { el } = createListRow({ label: c.name, lead: mark, className: 'cat-row' });
      const show = () => {
        const hidden = excluded.has(c.id);
        el.classList.toggle('hidden', hidden);
        while (mark.firstChild) mark.removeChild(mark.firstChild);
        mark.appendChild(icon(hidden ? 'hidden' : 'seen'));
      };
      show();
      return {
        el,
        show,
        activate() {
          if (armed) {
            multiClick(rows.findIndex((r) => r.el === el));
            return;
          }
          excluded = toggleId(excluded, c.id);
          show();
          scheduleSave();
        },
      };
    });
    rows = [typeRow, ...catRows];
    rows.forEach((r) => list.appendChild(r.el));
    if (ctx.focus.activeId === ZONE_ID) ctx.focus.focus(ZONE_ID, Math.min(focusIndex, rows.length - 1));
  }

  /** Multiple selection: the first OK on a category starts it, moving down flips the ones passed, the second OK confirms. */
  function multiClick(i) {
    if (anchor === null) {
      anchor = i;
      base = new Set(excluded);
      preview(i);
      return;
    }
    anchor = null;
    base = null;
    armed = false;
    showMulti();
    scheduleSave();
  }

  function preview(i) {
    excluded = flipRange(base, categories.map((c) => c.id), anchor - 1, i - 1);
    rows.forEach((r) => r.show && r.show());
  }

  function cancelMulti() {
    if (anchor !== null) {
      excluded = base;
      rows.forEach((r) => r.show && r.show());
    }
    anchor = null;
    base = null;
    armed = false;
    showMulti();
    ctx.notices.info(t('common.cancelled'), { key: 'multi' });
  }

  const multiButton = createButton({ label: t('categories.multi'), icon: 'checkDouble', iconOnly: true, className: 'categories-multi' });
  let multiFocused = false;
  /** Focused look (white background, dark icon) when it holds the focus and for as long as the multiple selection is on. */
  const showMulti = () => multiButton.classList.toggle('focused', armed || multiFocused);
  const multiZone = new FocusZone({
    id: MULTI_ZONE,
    nodes: () => [multiButton],
    model: new ListModel({ orientation: 'vertical', getCount: () => 1 }),
    onFocus: () => {
      multiFocused = true;
      showMulti();
    },
    onBlur: () => {
      multiFocused = false;
      showMulti();
    },
    onActivate() {
      if (armed) {
        cancelMulti();
        return;
      }
      armed = true;
      showMulti();
      ctx.notices.info(t('common.active'), { key: 'multi' });
    },
  });

  function scheduleSave() {
    status.textContent = '';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      applyChanges();
    }, SAVE_DELAY_MS);
  }

  /** Saves at once what is waiting for the timer. */
  async function flush() {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    await applyChanges();
  }

  async function loadType(nextType) {
    await flush();
    armed = false;
    showMulti();
    anchor = null;
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
    if (busy || (ctx.catalog.getState().running && ctx.catalog.getState().providerId === providerId)) {
      scheduleSave(); // try again later
      status.textContent = t('categories.busy');
      return;
    }
    busy = true;
    try {
      await ctx.settings.setExcluded(providerId, type, Array.from(excluded));
      if (excluded.size !== original.size || Array.from(excluded).some((id) => !original.has(id))) {
        await ctx.rebuildCatalog([type], { providerId }); // in the catalog worker: the exclusions were saved just above
        // A category shown again: its items were not kept, so the type is downloaded again (now if this is the active provider).
        if (Array.from(original).some((id) => !excluded.has(id))) {
          await markStale(db, type);
          if ((await ctx.providers.getActiveId()) === providerId) ctx.catalog.start({ types: [type], force: true });
        }
      }
      original = new Set(excluded);
      status.textContent = '';
      if (!destroyed) ctx.notices.success(t('notice.saved'), { key: 'categories' });
    } catch (err) {
      log.warn('Applying categories failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'categories' });
    } finally {
      busy = false;
    }
  }

  return {
    el: framedPage(createHeading({ level: 1, text: t('settings.categories') }), status, h('div', { class: 'categories-body' }, h('div', { class: 'categories-side' }, multiButton), list)),
    /** Back cancels the multiple selection instead of leaving the page. */
    onBack() {
      if (!armed) return false;
      cancelMulti();
      return true;
    },
    mount() {
      ctx.focus.register(zone);
      ctx.focus.register(multiZone);
      ctx.focus.link(ZONE_ID, 'left', MULTI_ZONE);
      ctx.focus.link(MULTI_ZONE, 'right', ZONE_ID);
      loadType(type).then(() => ctx.focus.focus(ZONE_ID, 0));
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(ZONE_ID);
      ctx.focus.unregister(MULTI_ZONE);
      // Leaving with a save waiting: do it now, the database is closed afterwards.
      flush().finally(() => {
        if (ownDb && db) db.close();
      });
    },
  };
}
