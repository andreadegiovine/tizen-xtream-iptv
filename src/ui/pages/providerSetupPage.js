import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { XtreamClient, normalizeBaseUrl } from '../../services/xtreamClient.js';
import { AppError, ErrorCode, toAppError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';

const ZONE_ID = 'providerSetup';
// Samsung on-screen keyboard: "Done" and "Cancel" arrive as these key codes.
const IME_DONE = 65376;
const IME_CANCEL = 65385;

export function createProviderSetupPage(ctx, params = {}) {
  const fields = [
    { id: 'name', type: 'text', labelKey: 'setup.name' },
    { id: 'url', type: 'text', labelKey: 'setup.url' },
    { id: 'username', type: 'text', labelKey: 'setup.username' },
    { id: 'password', type: 'password', labelKey: 'setup.password' },
  ];
  const status = h('div', { class: 'status', role: 'status' });
  const rows = fields.map((field) => {
    const input = h('input', {
      type: field.type,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    });
    return { field, input, row: h('label', { class: 'field' }, h('span', { class: 'field-label', text: t(field.labelKey) }), input) };
  });
  const submit = h('button', { class: 'btn primary', type: 'button', text: t('setup.verify') });
  const cancel = params.firstRun ? null : h('button', { class: 'btn', type: 'button', text: t('setup.cancel') });
  const focusables = [...rows.map((r) => r.row), submit, ...(cancel ? [cancel] : [])];
  const editId = params.providerId || null;
  let editing = null;
  let busy = false;
  let destroyed = false;

  async function save() {
    if (busy) return;
    busy = true;
    submit.textContent = t('setup.verifying');
    status.textContent = '';
    try {
      const values = Object.fromEntries(rows.map((r) => [r.field.id, r.input.value.trim()]));
      if (!values.name || !values.username || !values.password) throw new AppError(ErrorCode.INVALID_INPUT);
      const baseUrl = normalizeBaseUrl(values.url);
      await new XtreamClient({ baseUrl, username: values.username, password: values.password }).authenticate();
      const data = { name: values.name, baseUrl, username: values.username, password: values.password };
      if (editing) {
        const changed = ['baseUrl', 'username', 'password'].some((key) => editing[key] !== data[key]);
        await ctx.providers.update(editing.id, data);
        // Different server or account: its catalog may differ, so refresh the active provider.
        if (changed && (await ctx.providers.getActiveId()) === editing.id) ctx.catalog.start({ force: true });
        if (!destroyed) ctx.router.reset('providers', { section: 'provider' });
      } else {
        const provider = await ctx.providers.add(data);
        await ctx.providers.setActiveId(provider.id);
        ctx.catalog.start({ force: true });
        if (!destroyed) {
          if (params.firstRun) ctx.router.reset('home', { section: 'home' });
          else ctx.router.reset('providers', { section: 'provider' });
        }
      }
    } catch (err) {
      const appError = toAppError(err);
      log.warn('Provider verification failed', appError.code, appError.message);
      status.textContent = t(appError.i18nKey);
    } finally {
      busy = false;
      submit.textContent = t('setup.verify');
    }
  }

  const zone = new FocusZone({
    id: ZONE_ID,
    model: new ListModel({ orientation: 'vertical', getCount: () => focusables.length }),
    onFocus: (i) => {
      focusables[i].classList.add('focused');
      ensureVisible(focusables[i], { first: i === 0 });
    },
    onBlur: (i) => focusables[i].classList.remove('focused'),
    onActivate: (i) => {
      if (i < rows.length) rows[i].input.focus();
      else if (focusables[i] === submit) save();
      else ctx.router.back();
    },
  });

  rows.forEach((r, i) => {
    r.input.addEventListener('keydown', (event) => {
      // The field owns its keys: stop them before the global InputService turns Enter into "activate".
      event.stopPropagation();
      if (event.keyCode === 13 || event.keyCode === IME_DONE) {
        event.preventDefault();
        r.input.blur();
        ctx.focus.focus(ZONE_ID, Math.min(i + 1, focusables.length - 1));
      } else if (event.keyCode === IME_CANCEL) {
        r.input.blur();
      }
    });
  });

  const el = h(
    'section',
    { class: 'page setup' },
    h('h1', { text: t(editId ? 'setup.editTitle' : 'setup.title') }),
    h('div', { class: 'form' }, rows.map((r) => r.row), submit, cancel, status),
  );

  return {
    el,
    mount() {
      ctx.focus.register(zone);
      ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
      ctx.focus.focus(ZONE_ID, 0);
      if (editId) {
        ctx.providers.get(editId).then((provider) => {
          if (!provider || destroyed) return;
          editing = provider;
          rows[0].input.value = provider.name;
          rows[1].input.value = provider.baseUrl;
          rows[2].input.value = provider.username;
          rows[3].input.value = provider.password;
        });
      }
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(ZONE_ID);
    },
  };
}
