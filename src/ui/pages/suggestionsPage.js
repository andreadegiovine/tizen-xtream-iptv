import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createCard } from '../components/card.js';
import { log } from '../../core/logger.js';

const ZONE_ID = 'suggestions';
const COLUMNS = 6;

/** Suggested titles available in the provider catalog (TMDB recommendations from the watch history). */
export function createSuggestionsPage(ctx) {
  const status = h('p', { class: 'muted search-status', text: t('suggestions.loading') });
  const gridEl = h('div', { class: 'search-grid' });
  let entries = [];
  let cards = [];
  let destroyed = false;

  const zone = new FocusZone({
    id: ZONE_ID,
    model: new GridModel({ columns: COLUMNS, getCount: () => entries.length }),
    onFocus: (i) => {
      if (!cards[i]) return;
      cards[i].el.classList.add('focused');
      ensureVisible(cards[i].el, { first: i < COLUMNS });
    },
    onBlur: (i) => cards[i] && cards[i].el.classList.remove('focused'),
    onActivate: (i) => entries[i] && ctx.openEntry(entries[i], { section: 'suggestions' }),
  });

  async function load() {
    const result = await ctx.suggestions.build({ limit: 36 });
    if (destroyed) return;
    entries = result.entries;
    cards = entries.map((entry) => {
      const card = createCard(entry, entry.type, { subtitle: t(`search.type.${entry.type}`) });
      gridEl.appendChild(card.el);
      return card;
    });
    if (result.source === 'disabled') status.textContent = t('suggestions.disabled');
    else if (!entries.length) status.textContent = t('suggestions.none');
    else status.textContent = result.source === 'history' ? t('suggestions.fromHistory') : t('suggestions.trending');
    ['movie', 'series'].forEach((type) => {
      const idx = entries.map((e, i) => (e.type === type ? i : -1)).filter((i) => i >= 0);
      if (idx.length && ctx.enrich) ctx.enrich(idx.map((i) => entries[i]), idx.map((i) => cards[i]), type);
    });
    ctx.focus.focus(ZONE_ID, 0);
  }

  return {
    el: h('section', { class: 'page suggestions' }, h('h1', { text: t('nav.suggestions') }), status, gridEl),
    mount() {
      ctx.focus.register(zone);
      ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
      load().catch((err) => {
        log.warn('Suggestions failed', err && err.message);
        status.textContent = t('error.NETWORK');
      });
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(ZONE_ID);
    },
  };
}
