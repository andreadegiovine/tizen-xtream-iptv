import { h } from '../dom.js';
import { createIconButton } from '../atoms/iconButton.js';
import { createHint } from '../atoms/hint.js';
import { createHeading } from '../atoms/heading.js';
import { createPlaceholder } from '../atoms/placeholder.js';
import { createMetaText } from '../atoms/metaParts.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createCarousel } from '../components/carousel.js';
import { addToCollection } from '../components/collectionFlows.js';
import { getEntry } from '../../services/catalogQuery.js';
import { rebuildLive } from '../../services/rebuildLive.js';
import { log } from '../../core/logger.js';

/** Streams behind a Live TV card: all the versions of a group, or the channel itself. */
export const streamIdsOf = (entry) => (entry.isGroup ? entry.memberIds || (entry.members || []).map((m) => m.id) : [entry.defaultId]);

/** Network page: its channels and groups in a carousel; favourite, add to a collection and (when some were added by hand) edit. params: { key } */
export function createNetworkPage(ctx, params) {
  let network = null;
  let providerId = null;
  let db = null;
  let members = [];
  let favorite = false;
  let rows = [];
  let destroyed = false;
  let focusedOnce = false;

  const poster = h('div', { class: 'detail-poster square' });
  const titleEl = createHeading({ level: 1, className: 'detail-title' });
  const metaEl = h('p', { class: 'detail-meta' });
  const actionsEl = h('div', { class: 'detail-actions' });
  const itemsEl = h('div', { class: 'detail-section' });
  const el = h('section', { class: 'page detail network' }, poster, h('div', { class: 'detail-body' }, titleEl, metaEl, actionsEl, itemsEl));

  const clear = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  function setRows(next) {
    const keep = ctx.focus.activeId && rows.some((r) => r.id === ctx.focus.activeId) ? { id: ctx.focus.activeId, index: ctx.focus.active.index } : null;
    rows.forEach((r) => ctx.focus.unregister(r.id));
    rows = next;
    rows.forEach((r, i) => {
      ctx.focus.register(r.zone);
      ctx.focus.link(r.id, 'up', i === 0 ? TOPBAR_ZONE : rows[i - 1].id);
      if (i < rows.length - 1) ctx.focus.link(r.id, 'down', rows[i + 1].id);
    });
    if (rows.length) ctx.focus.link(TOPBAR_ZONE, 'down', rows[0].id);
    const target = keep && rows.find((r) => r.id === keep.id);
    if (target) ctx.focus.focus(target.id, keep.index);
    else if (rows.length && !focusedOnce) {
      focusedOnce = true;
      ctx.focus.focus(rows[0].id, 0);
    }
  }

  function createActions(buttons) {
    const nodes = buttons.map((b) => createIconButton({ icon: b.icon, label: b.label, active: b.active }));
    clear(actionsEl);
    nodes.forEach((n) => actionsEl.appendChild(n));
    return new FocusZone({
      id: 'networkActions',
      nodes: () => nodes,
      model: new ListModel({ orientation: 'horizontal', getCount: () => nodes.length }),
      onFocus: (i) => {
        nodes[i].classList.add('focused');
        ensureVisible(actionsEl, { margin: 24 });
      },
      onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
      onActivate: (i) => buttons[i].run(),
    });
  }

  async function toggleFavorite() {
    try {
      favorite = await ctx.favorites.toggle(providerId, network.key, 'live');
      if (!destroyed) build();
      ctx.notices.success(t(favorite ? 'notice.added' : 'notice.removed'), { key: 'favorite' });
    } catch (err) {
      log.warn('Favorite failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'favorite' });
    }
  }

  /** Only the channels and groups added by hand can be taken out; the rest follows the names. */
  async function edit() {
    const manual = new Set(network.manualKeys || []);
    const result = await ctx.dialogs.editCollection({
      title: t('networks.edit'),
      items: members.filter((entry) => manual.has(entry.key)).map((entry) => ({ key: entry.key, name: entry.name })),
      saveLabel: t('collections.save'),
      cancelLabel: t('setup.cancel'),
    });
    if (!result || destroyed || !result.remove.length) return;
    try {
      const gone = members.filter((entry) => result.remove.includes(entry.key));
      await ctx.liveGrouping.unlinkNetwork(providerId, gone.flatMap(streamIdsOf));
      await rebuildLive(ctx);
      ctx.notices.success(t('notice.saved'), { key: 'network' });
      await reload();
    } catch (err) {
      log.warn('Network edit failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'network' });
    }
  }

  function build() {
    if (!network) return;
    const next = [];
    titleEl.textContent = network.name;
    clear(metaEl);
    metaEl.appendChild(createMetaText(t('collections.items', { count: (network.memberKeys || []).length })));
    const buttons = [
      { icon: 'heart', active: favorite, label: favorite ? t('detail.unfavorite') : t('detail.favorite'), run: toggleFavorite },
      { icon: 'collectionAdd', label: t('collections.add'), run: () => addToCollection(ctx, { providerId, entry: network }) },
    ];
    if ((network.manualKeys || []).length) buttons.push({ icon: 'edit', label: t('networks.edit'), run: edit });
    next.push({ id: 'networkActions', zone: createActions(buttons) });
    clear(itemsEl);
    if (members.length) {
      const carousel = createCarousel({
        id: 'networkItems',
        title: '',
        items: members.map((entry) => ({ entry, type: 'live', meta: { square: true } })),
        onAdded: (list, made) => ctx.enrich && ctx.enrich(list.map((item) => item.entry), made, 'live', true),
        onOpen: (item) => ctx.openEntry(item.entry, { section: params.section }),
      });
      itemsEl.appendChild(carousel.el);
      next.push({ id: 'networkItems', zone: carousel.zone });
      if (ctx.enrich) ctx.enrich(members.slice(0, carousel.cards.length), carousel.cards, 'live', true);
    } else {
      itemsEl.appendChild(createHint({ text: t('networks.empty') }));
    }
    setRows(next);
    clear(poster);
    poster.classList.remove('loading');
    if (network.icon) poster.appendChild(h('img', { src: network.icon, alt: '', referrerpolicy: 'no-referrer' }));
    else poster.appendChild(createPlaceholder({ icon: 'network' }));
  }

  async function reload() {
    const fresh = await getEntry(db, params.key);
    if (!fresh) {
      if (!destroyed) ctx.router.back(); // the network is gone (too few channels left)
      return;
    }
    network = fresh;
    members = (await Promise.all(network.memberKeys.map((key) => getEntry(db, key).catch(() => null)))).filter(Boolean);
    if (!destroyed) build();
  }

  async function load() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    providerId = current.provider.id;
    db = current.db;
    favorite = await ctx.favorites.has(providerId, params.key);
    await reload();
  }

  return {
    el,
    mount() {
      load().catch((err) => log.warn('Network load failed', err && err.message));
    },
    destroy() {
      destroyed = true;
      rows.forEach((r) => ctx.focus.unregister(r.id));
      rows = [];
    },
    saveState: () => ({}),
    restoreState() {
      /* nothing to restore */
    },
  };
}
