import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel, ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { log } from '../../core/logger.js';
import { createSyncPanel } from '../components/syncPanel.js';

const ZONE_ID = 'providers';
const SYNC_ZONE = 'providerSync';
const COLUMNS = 3;
export const ProviderAction = Object.freeze({ USE: 'use', EDIT: 'edit', REMOVE: 'remove', ADD: 'add' });

/** Host part of a server URL, for display (never shows credentials). */
export function hostOf(baseUrl) {
  return String(baseUrl || '').replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
}

/**
 * Flat list of focusable cells: three actions per provider (use, edit, remove) followed by the
 * "add provider" cell. Cell index = row * 3 + column, which is what GridModel expects.
 */
export function buildCells(providers, activeId) {
  const cells = [];
  providers.forEach((provider) => {
    const active = provider.id === activeId;
    cells.push({ action: ProviderAction.USE, provider, disabled: active });
    cells.push({ action: ProviderAction.EDIT, provider });
    cells.push({ action: ProviderAction.REMOVE, provider });
  });
  cells.push({ action: ProviderAction.ADD });
  return cells;
}

export function createProvidersPage(ctx, params = {}) {
  const list = h('div', { class: 'provider-list' });
  const panel = createSyncPanel(ctx);
  let hasActive = false;
  let cells = [];
  let nodes = [];
  let destroyed = false;

  function render(focusIndex) {
    return Promise.all([ctx.providers.list(), ctx.providers.getActiveId()]).then(([providers, activeId]) => {
      if (destroyed) return;
      cells = buildCells(providers, activeId);
      hasActive = Boolean(activeId) && providers.some((p) => p.id === activeId);
      panel.el.style.display = hasActive ? '' : 'none';
      if (hasActive && panel.providerId !== activeId) {
        panel.providerId = activeId;
        panel.setProvider(activeId);
      }
      nodes = cells.map((cell) => {
        if (cell.action === ProviderAction.ADD) {
          return h('button', { class: 'btn primary provider-add', type: 'button', text: t('providers.add') });
        }
        const labelKey = cell.action === ProviderAction.USE && cell.disabled ? 'providers.active' : `providers.${cell.action}`;
        return h('button', {
          class: `btn provider-action${cell.disabled ? ' disabled' : ''}${cell.action === ProviderAction.REMOVE ? ' danger' : ''}`,
          type: 'button',
          text: t(labelKey),
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
              h('span', { class: 'provider-name', text: provider.name }),
              h('span', { class: 'provider-meta', text: `${hostOf(provider.baseUrl)} · ${provider.username}` })),
            h('div', { class: 'provider-actions' }, nodes[cursor], nodes[cursor + 1], nodes[cursor + 2]),
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
        ctx.catalog.start(); // cancels the running job and syncs the new provider if its list is stale
        await render(cells.indexOf(cell));
        break;
      case ProviderAction.EDIT:
        ctx.router.push('providerSetup', { providerId: provider.id, section: 'provider' });
        break;
      case ProviderAction.REMOVE: {
        const ok = await ctx.dialogs.confirm({
          title: t('providers.removeTitle'),
          message: t('providers.removeMessage', { name: provider.name }),
          confirmLabel: t('providers.remove'),
          cancelLabel: t('setup.cancel'),
        });
        if (!ok) return;
        const wasActive = (await ctx.providers.getActiveId()) === provider.id;
        await ctx.providers.remove(provider.id);
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
        break;
      }
      default:
        ctx.router.push('providerSetup', { section: 'provider' });
    }
  }

  const syncZone = new FocusZone({
    id: SYNC_ZONE,
    model: new ListModel({ orientation: 'vertical', getCount: () => (hasActive ? 1 : 0) }),
    onFocus: () => {
      panel.button.classList.add('focused');
      ensureVisible(panel.button, { first: true });
    },
    onBlur: () => panel.button.classList.remove('focused'),
    onActivate: () => panel.syncNow(),
  });

  const zone = new FocusZone({
    id: ZONE_ID,
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
    el: h('section', { class: 'page providers' }, h('h1', { text: t('providers.title') }), panel.el, list),
    mount() {
      ctx.focus.register(syncZone);
      ctx.focus.register(zone);
      // Top bar → sync button → provider list (the sync zone is skipped while there is no active provider).
      ctx.focus.link(SYNC_ZONE, 'up', TOPBAR_ZONE);
      ctx.focus.link(SYNC_ZONE, 'down', ZONE_ID);
      ctx.focus.link(ZONE_ID, 'up', SYNC_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', SYNC_ZONE);
      panel.mount();
      // Opens on the provider list: the first thing to do here is pick or edit a provider.
      render(params.focusIndex || 0);
    },
    destroy() {
      destroyed = true;
      panel.destroy();
      ctx.focus.unregister(SYNC_ZONE);
      ctx.focus.unregister(ZONE_ID);
    },
  };
}
