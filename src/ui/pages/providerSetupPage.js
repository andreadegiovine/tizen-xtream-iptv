import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { XtreamClient, normalizeBaseUrl } from '../../services/xtreamClient.js';
import { AppError, ErrorCode, toAppError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { createForm, framedPage } from '../components/formPage.js';
import { createHomeSkeleton } from './homePage.js';

const ZONE_ID = 'providerSetup';

export function createProviderSetupPage(ctx, params = {}) {
  const editId = params.providerId || null;
  const submit = { label: t('setup.verify'), primary: true, run: () => save() };
  const actions = [submit];
  if (!params.firstRun) actions.push({ label: t('setup.cancel'), run: () => ctx.router.back() });
  const form = createForm({
    id: ZONE_ID,
    focus: ctx.focus,
    fields: [
      { label: t('setup.name') },
      { label: t('setup.url') },
      { label: t('setup.username') },
      { label: t('setup.password'), type: 'password' },
    ],
    actions,
  });
  const [nameField, urlField, userField, passwordField] = form.fields;
  const { status, zone } = form;
  const submitButton = form.actionButtons[0];
  let editing = null;
  let busy = false;
  let destroyed = false;

  async function save() {
    if (busy) return;
    busy = true;
    submitButton.textContent = t('setup.verifying');
    status.textContent = '';
    try {
      const values = { name: nameField.getValue().trim(), url: urlField.getValue().trim(), username: userField.getValue().trim(), password: passwordField.getValue().trim() };
      if (!values.name || !values.username || !values.password) throw new AppError(ErrorCode.INVALID_INPUT);
      const baseUrl = normalizeBaseUrl(values.url);
      const auth = await new XtreamClient({ baseUrl, username: values.username, password: values.password }).authenticate();
      const data = { name: values.name, baseUrl, username: values.username, password: values.password, expiresAt: auth.user.expiresAt || null };
      if (editing) {
        const changed = ['baseUrl', 'username', 'password'].some((key) => editing[key] !== data[key]);
        await ctx.providers.update(editing.id, data);
        // Different server or account: its catalog may differ, so refresh the active provider.
        if (changed && (await ctx.providers.getActiveId()) === editing.id) ctx.catalog.start({ force: true });
        ctx.notices.success(t('notice.saved'), { key: 'provider' });
        if (!destroyed) ctx.router.reset('providers', { section: 'provider' });
      } else {
        const provider = await ctx.providers.add(data);
        await ctx.providers.setActiveId(provider.id);
        await ctx.refreshAdult();
        ctx.catalog.start({ force: true });
        ctx.notices.success(t('notice.added'), { key: 'provider' });
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
      submitButton.textContent = t('setup.verify');
    }
  }

  const title = h('h1', { text: t(editId ? 'setup.editTitle' : 'setup.title') });
  // First start: the bar (logo + placeholders) is above; the form sits at the left, in a square box, over the Home skeleton.
  const el = params.firstRun
    ? h('section', { class: 'page setup first-run' }, h('div', { class: 'setup-backdrop home-skeleton', 'aria-hidden': 'true' }, createHomeSkeleton()), h('div', { class: 'setup-box' }, title, form.el))
    : framedPage(title, form.el);

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
          nameField.setValue(provider.name);
          urlField.setValue(provider.baseUrl);
          userField.setValue(provider.username);
          passwordField.setValue(provider.password);
        });
      }
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(ZONE_ID);
    },
  };
}
