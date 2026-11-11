import { h } from '../dom.js';
import { createHeading } from '../atoms/heading.js';
import { createHint } from '../atoms/hint.js';
import { t } from '../../i18n/index.js';
import { XtreamClient, normalizeBaseUrl } from '../../services/xtreamClient.js';
import { M3uClient } from '../../services/m3uClient.js';
import { ProviderType, providerType } from '../../services/providerTypes.js';
import { AppError, ErrorCode, toAppError } from '../../core/errors.js';
import { log } from '../../core/logger.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { createForm, framedPage } from '../components/formPage.js';
import { createHomeSkeleton } from './homePage.js';

const ZONE_ID = 'providerSetup';

/** An http(s) address typed by hand ("host/list.m3u" → "http://host/list.m3u"); '' stays ''. */
export function normalizeAddress(input, { required = true } = {}) {
  let value = String(input || '').trim();
  if (!value) {
    if (required) throw new AppError(ErrorCode.INVALID_INPUT, 'Address is empty');
    return '';
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new AppError(ErrorCode.INVALID_INPUT, 'Invalid address', { cause });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError(ErrorCode.INVALID_INPUT, 'Only http and https are supported');
  return url.href;
}

/**
 * Adding (or editing) a provider in two steps: first its kind (Xtream Codes API, or an M3U playlist with an XMLTV guide), then its data.
 * Editing opens on the data of the provider's kind.
 */
export function createProviderSetupPage(ctx, params = {}) {
  const editId = params.providerId || null;
  const title = createHeading({ level: 1, text: t(editId ? 'setup.editTitle' : 'setup.title') });
  const body = h('div', { class: 'setup-step' });
  let form = null;
  let kind = null; // chosen provider type (null: the choice is on screen)
  let editing = null;
  let busy = false;
  let destroyed = false;

  function show(next) {
    if (form) ctx.focus.unregister(ZONE_ID);
    while (body.firstChild) body.removeChild(body.firstChild);
    form = next;
    body.appendChild(form.el);
    ctx.focus.register(form.zone);
    ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
    ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
    ctx.focus.focus(ZONE_ID, 0);
  }

  /** Step 1: the kind of provider. */
  function chooseKind() {
    kind = null;
    const actions = [
      { label: t('setup.type.xtream'), primary: true, run: () => fillIn(ProviderType.XTREAM) },
      { label: t('setup.type.m3u'), primary: true, run: () => fillIn(ProviderType.M3U) },
    ];
    if (!params.firstRun) actions.push({ label: t('setup.cancel'), run: () => ctx.router.back() });
    const next = createForm({ id: ZONE_ID, focus: ctx.focus, fields: [], actions });
    next.el.insertBefore(createHint({ text: t('setup.type.hint'), className: 'setup-hint' }), next.el.firstChild);
    next.el.classList.add('setup-types');
    show(next);
  }

  /** Step 2: the data of the chosen kind. */
  function fillIn(type) {
    kind = type;
    const m3u = type === ProviderType.M3U;
    const actions = [{ label: t('setup.verify'), primary: true, run: () => save() }];
    if (!editId) actions.push({ label: t('setup.back'), run: () => chooseKind() });
    else actions.push({ label: t('setup.cancel'), run: () => ctx.router.back() });
    const fields = m3u
      ? [{ label: t('setup.name') }, { label: t('setup.playlistUrl'), inputmode: 'url' }, { label: t('setup.epgUrl'), placeholder: t('setup.epgUrlHint'), inputmode: 'url' }]
      : [{ label: t('setup.name') }, { label: t('setup.url') }, { label: t('setup.username') }, { label: t('setup.password'), type: 'password' }];
    show(createForm({ id: ZONE_ID, focus: ctx.focus, fields, actions }));
    if (editing) {
      const values = m3u ? [editing.name, editing.playlistUrl, editing.epgUrl] : [editing.name, editing.baseUrl, editing.username, editing.password];
      form.fields.forEach((field, i) => field.setValue(values[i] || ''));
    }
  }

  /** What a provider of the chosen kind is saved with, once its server or playlist answered. */
  async function verified() {
    const value = (i) => form.fields[i].getValue().trim();
    if (kind === ProviderType.M3U) {
      const name = value(0);
      const playlistUrl = normalizeAddress(value(1));
      const typedGuide = normalizeAddress(value(2), { required: false });
      if (!name) throw new AppError(ErrorCode.INVALID_INPUT);
      const auth = await new M3uClient({ playlistUrl, epgUrl: typedGuide }).authenticate();
      // No guide typed: the one the playlist names (url-tvg), if any.
      return { type: ProviderType.M3U, name, playlistUrl, epgUrl: typedGuide || auth.playlist.epgUrl || '', baseUrl: playlistUrl, username: '', password: '' };
    }
    const values = { name: value(0), url: value(1), username: value(2), password: value(3) };
    if (!values.name || !values.username || !values.password) throw new AppError(ErrorCode.INVALID_INPUT);
    const baseUrl = normalizeBaseUrl(values.url);
    const auth = await new XtreamClient({ baseUrl, username: values.username, password: values.password }).authenticate();
    return { name: values.name, baseUrl, username: values.username, password: values.password, expiresAt: auth.user.expiresAt || null };
  }

  async function save() {
    if (busy) return;
    busy = true;
    const button = form.actionButtons[0];
    button.textContent = t('setup.verifying');
    form.status.textContent = '';
    try {
      const data = await verified();
      if (editing) {
        const changed = ['baseUrl', 'username', 'password', 'playlistUrl', 'epgUrl'].some((key) => (editing[key] || '') !== (data[key] || ''));
        await ctx.providers.update(editing.id, data);
        // Different server, account or playlist: its catalog may differ, so refresh the active provider.
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
      if (form) form.status.textContent = t(appError.i18nKey);
    } finally {
      busy = false;
      if (form && form.actionButtons[0]) form.actionButtons[0].textContent = t('setup.verify');
    }
  }

  // First start: the bar (logo + placeholders) is above; the form sits at the left, in a square box, over the Home skeleton.
  const el = params.firstRun
    ? h('section', { class: 'page setup first-run' }, h('div', { class: 'setup-backdrop home-skeleton', 'aria-hidden': 'true' }, createHomeSkeleton()), h('div', { class: 'setup-box' }, title, body))
    : framedPage(title, body);

  return {
    el,
    mount() {
      if (!editId) {
        chooseKind();
        return;
      }
      ctx.providers.get(editId).then((provider) => {
        if (!provider || destroyed) return;
        editing = provider;
        fillIn(providerType(provider));
      });
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(ZONE_ID);
    },
    /** Tests: the step on screen ('type' or the provider kind). */
    step: () => kind || 'type',
  };
}
