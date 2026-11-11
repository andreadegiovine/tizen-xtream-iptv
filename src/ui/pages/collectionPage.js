import { h } from '../dom.js';
import { createIconButton } from '../atoms/iconButton.js';
import { createChip, createChipLabel } from '../atoms/chip.js';
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
import { createImageRotator } from '../components/imageRotator.js';
import { getEntry, entryGenres } from '../../services/catalogQuery.js';
import { collectionGenres, collectionKey } from '../../services/collections.js';
import { log } from '../../core/logger.js';

/** "3 elementi · 2 generi" is built from these two; the line under the title. */
export const collectionCount = (count) => t('collections.items', { count });

/** Collection page: count, genres inherited from its members, favourite / edit / delete buttons and a carousel of its titles. params: { id } */
export function createCollectionPage(ctx, params) {
  let collection = null;
  let providerId = null;
  let db = null;
  let members = []; // catalog entries still in the catalog
  let genres = [];
  let favorite = false;
  let rows = [];
  let destroyed = false;
  let focusedOnce = false;
  let backdropToken = 0;

  const poster = h('div', { class: 'detail-poster' });
  const backdrop = h('div', { class: 'detail-backdrop' });
  const titleEl = createHeading({ level: 1, className: 'detail-title' });
  const metaEl = h('p', { class: 'detail-meta' });
  const actionsEl = h('div', { class: 'detail-actions' });
  const genresEl = h('div', { class: 'detail-categories' });
  const itemsEl = h('div', { class: 'detail-section' });
  const el = h('section', { class: 'page detail collection' }, backdrop, poster, h('div', { class: 'detail-body' }, titleEl, metaEl, actionsEl, genresEl, itemsEl));

  const posterRotator = createImageRotator({ host: poster });
  const backdropRotator = createImageRotator({ host: backdrop });

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
      id: 'collectionActions',
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
      favorite = await ctx.favorites.toggle(providerId, collectionKey(collection.id), 'collection');
      if (!destroyed) build();
      ctx.notices.success(t(favorite ? 'notice.added' : 'notice.removed'), { key: 'favorite' });
    } catch (err) {
      log.warn('Favorite failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'favorite' });
    }
  }

  /** Rename and take titles out, in one box. */
  async function edit() {
    const result = await ctx.dialogs.editCollection({
      title: t('collections.edit'),
      name: collection.name,
      nameLabel: t('collections.name'),
      items: members.map((entry) => ({ key: entry.key, name: entry.name })),
      saveLabel: t('collections.save'),
      cancelLabel: t('setup.cancel'),
    });
    if (!result || destroyed) return;
    try {
      collection = await ctx.collections.update(collection.id, result, providerId);
      await reload();
      ctx.notices.success(t('notice.saved'), { key: 'collection' });
    } catch (err) {
      log.warn('Collection edit failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'collection' });
    }
  }

  async function removeCollection() {
    const ok = await ctx.dialogs.confirm({ title: t('collections.delete'), message: t('collections.deleteConfirm', { name: collection.name }), confirmLabel: t('settings.confirmRemove'), cancelLabel: t('setup.cancel') });
    if (!ok || destroyed) return;
    try {
      await ctx.collections.remove(collection.id);
      if (favorite) await ctx.favorites.toggle(providerId, collectionKey(collection.id), 'collection');
      ctx.notices.success(t('notice.removed'), { key: 'collection' });
      ctx.router.back();
    } catch (err) {
      log.warn('Collection delete failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'collection' });
    }
  }

  function build() {
    if (!collection) return;
    const next = [];
    titleEl.textContent = collection.name;
    clear(metaEl);
    metaEl.appendChild(createMetaText(collectionCount(members.length)));
    next.push({
      id: 'collectionActions',
      zone: createActions([
        { icon: 'heart', active: favorite, label: favorite ? t('detail.unfavorite') : t('detail.favorite'), run: toggleFavorite },
        { icon: 'edit', label: t('collections.edit'), run: edit },
        { icon: 'remove', label: t('collections.delete'), run: removeCollection },
      ]),
    });
    clear(genresEl);
    if (genres.length) {
      genresEl.appendChild(createChipLabel(t('detail.genres')));
      genres.forEach((g) => genresEl.appendChild(createChip({ text: g.name })));
    }
    clear(itemsEl);
    if (members.length) {
      const carousel = createCarousel({
        id: 'collectionItems',
        title: '',
        items: members.map((entry) => ({ entry, type: entry.type })),
        onAdded: (list, made) => {
          if (!ctx.enrich) return;
          ['movie', 'series', 'live'].forEach((type) => {
            const at = list.map((item, i) => (item.type === type ? i : -1)).filter((i) => i >= 0);
            if (at.length) ctx.enrich(at.map((i) => list[i].entry), at.map((i) => made[i]), type, true);
          });
        },
        onOpen: (item) => ctx.openEntry(item.entry, { section: 'collections' }),
      });
      itemsEl.appendChild(carousel.el);
      next.push({ id: 'collectionItems', zone: carousel.zone });
      if (ctx.enrich) {
        ['movie', 'series', 'live'].forEach((type) => {
          const at = members.map((entry, i) => (entry.type === type && i < carousel.cards.length ? i : -1)).filter((i) => i >= 0);
          if (at.length) ctx.enrich(at.map((i) => members[i]), at.map((i) => carousel.cards[i]), type, true);
        });
      }
    } else {
      itemsEl.appendChild(createHint({ text: t('collections.emptyCollection') }));
    }
    setRows(next);
    updateImages();
  }

  /** Poster and backdrop each pick their own picture at random among those of the titles (channels have no poster worth showing here). */
  function updateImages() {
    const covers = members.filter((entry) => entry.type !== 'live' && entry.icon).map((entry) => entry.icon);
    const pictures = covers.length ? covers : members.filter((entry) => entry.icon).map((entry) => entry.icon);
    posterRotator.setUrls(pictures);
    posterRotator.start();
    poster.classList.toggle('empty', !pictures.length);
    if (!pictures.length && !poster.querySelector('.card-placeholder')) poster.appendChild(createPlaceholder({ icon: 'folder' }));
    if (pictures.length) {
      const placeholder = poster.querySelector('.card-placeholder');
      if (placeholder) placeholder.remove();
    }
    backdropRotator.setUrls(pictures);
    backdropRotator.start();
    loadBackdrops(pictures);
  }

  /** TMDB's wide pictures of the titles that have a TMDB id (those already known or fetched quietly), added to the backdrop pool as they arrive. */
  function loadBackdrops(fallback) {
    if (!ctx.tmdb || !ctx.tmdb.getMeta) return;
    backdropToken += 1;
    const mine = backdropToken;
    const wide = [];
    members
      .filter((entry) => entry.tmdbId && entry.type !== 'live')
      .slice(0, 12)
      .forEach((entry) => {
        Promise.resolve(ctx.tmdb.getMeta(entry.type, entry.tmdbId))
          .then((meta) => {
            if (destroyed || mine !== backdropToken || !meta || !meta.backdrop) return;
            wide.push(meta.backdrop);
            backdropRotator.setUrls(wide.concat(fallback));
          })
          .catch(() => undefined);
      });
  }

  async function reload() {
    members = (await Promise.all(collection.entryKeys.map((key) => getEntry(db, key).catch(() => null)))).filter(Boolean);
    genres = await collectionGenres(db, collection.entryKeys, entryGenres);
    if (!destroyed) build();
  }

  async function load() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    providerId = current.provider.id;
    db = current.db;
    collection = await ctx.collections.get(params.id, providerId);
    if (!collection || destroyed) return;
    favorite = await ctx.favorites.has(providerId, collectionKey(collection.id));
    await reload();
  }

  return {
    el,
    mount() {
      load().catch((err) => log.warn('Collection load failed', err && err.message));
    },
    destroy() {
      destroyed = true;
      posterRotator.stop();
      backdropRotator.stop();
      rows.forEach((r) => ctx.focus.unregister(r.id));
      rows = [];
    },
    saveState: () => ({}),
    restoreState() {
      /* nothing to restore */
    },
  };
}
