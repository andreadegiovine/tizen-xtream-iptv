import { h } from '../dom.js';
import { createButton } from '../atoms/button.js';
import { createHeading } from '../atoms/heading.js';
import { t, i18n } from '../../i18n/index.js';
import { formatDate } from '../../core/format.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel } from '../focus/models.js';
import { ensureVisible } from '../scroll.js';
import { log } from '../../core/logger.js';
import { openProviderDialog } from './providerSetupPage.js';

const ZONE_ID = 'providers';
const COLUMNS = 4;
export const ProviderAction = Object.freeze({ USE: 'use', CATEGORIES: 'categories', EDIT: 'edit', REMOVE: 'remove', ADD: 'add' });

/** Host part of a server URL, for display (never shows credentials). */
export function hostOf(baseUrl) {
  return String(baseUrl || '').replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
}

/**
 * Flat list of focusable cells: four actions per provider (use, categories, edit, remove) followed by the
 * "add provider" cell. Cell index = row * 4 + column, which is what GridModel expects.
 */
export function buildCells(providers, activeId) {
  const cells = [];
  providers.forEach((provider) => {
    const active = provider.id === activeId;
    cells.push({ action: ProviderAction.USE, provider, disabled: active });
    cells.push({ action: ProviderAction.CATEGORIES, provider });
    cells.push({ action: ProviderAction.EDIT, provider });
    cells.push({ action: ProviderAction.REMOVE, provider });
  });
  cells.push({ action: ProviderAction.ADD });
  return cells;
}

/** "Expires on 22/10/2026" / "Expired on ..." from the expiry date saved with the provider, or null when unknown. */
export function validity(provider, now = Date.now()) {
  const at = provider && Number(provider.expiresAt);
  if (!at) return null;
  const date = formatDate(at, i18n.getLocale());
  const expired = at < now;
  return { expired, text: t(expired ? 'providers.expired' : 'providers.validUntil', { date }) };
}

export function createProvidersPage(ctx, params = {}) {
  const list = h('div', { class: 'provider-list' });
  let cells = [];
  let nodes = [];
  let destroyed = false;

  function render(focusIndex) {
    return Promise.all([ctx.providers.list(), ctx.providers.getActiveId()]).then(([providers, activeId]) => {
      if (destroyed) return;
      cells = buildCells(providers, activeId);
      nodes = cells.map((cell) => {
        if (cell.action === ProviderAction.ADD) {
          return createButton({ label: t('setup.title'), icon: 'add', variant: 'primary', iconOnly: true, className: 'provider-add' });
        }
        const labelKey = cell.action === ProviderAction.USE && cell.disabled ? 'providers.current' : `providers.${cell.action}`;
        // Use / Active keep their label; the others are icons only (categories: the one of the sidebar).
        const iconName = { [ProviderAction.CATEGORIES]: 'categories', [ProviderAction.EDIT]: 'edit', [ProviderAction.REMOVE]: 'remove' }[cell.action];
        return createButton({
          label: t(labelKey),
          icon: iconName || null,
          iconOnly: Boolean(iconName),
          ariaLabel: t(labelKey),
          variant: cell.action === ProviderAction.REMOVE ? 'danger' : '',
          className: `provider-action${cell.disabled ? ' is-current' : ''}`,
        });
      });
      while (list.firstChild) list.removeChild(list.firstChild);
      let cursor = 0;
      providers.forEach((provider) => {
        const active = provider.id === activeId;
        list.appendChild(
          h(
            'div',
            { class: `provider-row${active ? ' is-active' : ''}` },
            h('div', { class: 'provider-info' },
              h('span', { class: 'provider-name', text: provider.name }, validity(provider) ? h('span', { class: `provider-valid${validity(provider).expired ? ' expired' : ''}`, text: validity(provider).text }) : null),
              h('span', { class: 'provider-meta', text: provider.type === 'm3u' ? `${hostOf(provider.playlistUrl)} · M3U` : `${hostOf(provider.baseUrl)} · ${provider.username}` })),
            h('div', { class: 'provider-actions' }, nodes[cursor], nodes[cursor + 1], nodes[cursor + 2], nodes[cursor + 3]),
          ),
        );
        cursor += COLUMNS;
      });
      list.appendChild(nodes[nodes.length - 1]);
      if (typeof focusIndex === 'number') ctx.focus.focus(ZONE_ID, Math.min(focusIndex, cells.length - 1));
    });
  }

  async function activate(cell) {
    const { provider } = cell;
    switch (cell.action) {
      case ProviderAction.USE:
        if (cell.disabled) return;
        await ctx.providers.setActiveId(provider.id);
        await ctx.refreshAdult();
        ctx.catalog.start(); // cancels the running job and syncs the new provider if its list is stale
        await render(cells.indexOf(cell));
        ctx.notices.success(t('notice.done'), { key: 'provider' });
        break;
      case ProviderAction.CATEGORIES:
        ctx.router.push('categories', { providerId: provider.id, section: 'provider' });
        break;
      case ProviderAction.EDIT:
        if (await openProviderDialog(ctx, { providerId: provider.id })) await render(cells.indexOf(cell));
        break;
      case ProviderAction.REMOVE: {
        const ok = await ctx.dialogs.confirm({
          title: t('providers.removeTitle'),
          message: t('providers.removeMessage', { name: provider.name }),
          confirmLabel: t('settings.confirmRemove'),
          cancelLabel: t('setup.cancel'),
        });
        if (!ok) return;
        const wasActive = (await ctx.providers.getActiveId()) === provider.id;
        ctx.active.release(); // an open connection would block deleting the provider's database
        await ctx.providers.remove(provider.id);
        if (ctx.favorites) await ctx.favorites.removeProvider(provider.id);
        if (ctx.liveGrouping) await ctx.liveGrouping.removeProvider(provider.id);
        if (ctx.pins) await ctx.pins.removeProvider(provider.id);
        if (ctx.collections) await ctx.collections.removeProvider(provider.id);
        if (wasActive) {
          const next = await ctx.providers.getActive();
          if (next) ctx.catalog.start();
          else {
            ctx.catalog.cancel();
            ctx.router.reset('providerSetup', { firstRun: true });
            return;
          }
        }
        await render(0);
        ctx.notices.success(t('notice.removed'), { key: 'provider' });
        break;
      }
      default:
        // Added: it is the provider in use now (its row is the last one, before "add").
        if (await openProviderDialog(ctx)) await render(cells.length - 1);
    }
  }

  const zone = new FocusZone({
    id: ZONE_ID,
    nodes: () => nodes,
    model: new GridModel({ columns: COLUMNS, getCount: () => cells.length }),
    onFocus: (i) => {
      if (!nodes[i]) return;
      nodes[i].classList.add('focused');
      ensureVisible(nodes[i], { first: i < COLUMNS });
    },
    onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
    onActivate: (i) => {
      if (cells[i]) activate(cells[i]).catch((err) => log.warn('Provider action failed', err && err.message));
    },
  });

  return {
    el: h('section', { class: 'page framed providers' }, h('div', { class: 'page-container' }, createHeading({ level: 1, text: t('nav.provider') }), list)),
    mount() {
      ctx.focus.register(zone);
      // Opens on the provider list: the first thing to do here is pick or edit a provider.
      render(params.focusIndex || 0);
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(ZONE_ID);
    },
  };
}
