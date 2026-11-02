import { h } from '../dom.js';
import { t, i18n, detectLocale } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { LANGUAGE_OPTIONS } from '../../services/settings.js';
import { TOPBAR_ZONE } from '../components/topbar.js';

const ZONE_ID = 'settings';

export function createSettingsPage(ctx) {
  const languageValue = h('span', { class: 'value' });
  const languageRow = h('div', { class: 'row' }, h('span', { text: t('settings.language') }), languageValue);
  const diagnosticsRow = h('div', { class: 'row' }, h('span', { text: t('settings.diagnostics') }));
  const rows = [languageRow, diagnosticsRow];

  const label = (value) => (value === 'auto' ? t('settings.language.auto') : value);
  ctx.settings.get().then((s) => {
    languageValue.textContent = label(s.language);
  });

  async function cycleLanguage() {
    const { language } = await ctx.settings.get();
    const next = LANGUAGE_OPTIONS[(LANGUAGE_OPTIONS.indexOf(language) + 1) % LANGUAGE_OPTIONS.length];
    await ctx.settings.update({ language: next });
    i18n.setLocale(next === 'auto' ? detectLocale(navigator.language) : next);
  }

  const zone = new FocusZone({
    id: ZONE_ID,
    model: new ListModel({ orientation: 'vertical', getCount: () => rows.length }),
    onFocus: (i) => rows[i].classList.add('focused'),
    onBlur: (i) => rows[i].classList.remove('focused'),
    onActivate: (i) => {
      if (i === 0) cycleLanguage();
      else ctx.router.push('diagnostics');
    },
  });

  return {
    el: h('section', { class: 'page' }, h('h1', { text: t('settings.title') }), h('div', { class: 'list' }, rows)),
    mount() {
      ctx.focus.register(zone);
      ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
      ctx.focus.focus(ZONE_ID, 0);
    },
    destroy() {
      ctx.focus.unregister(ZONE_ID);
    },
    saveState: () => ({ index: zone.index }),
    restoreState(state) {
      ctx.focus.focus(ZONE_ID, state.index);
    },
  };
}
