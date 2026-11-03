import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { runDiagnostics } from '../../services/diagnostics.js';
import { createAvPlaySpike } from '../../services/avplaySpike.js';
import { log } from '../../core/logger.js';
import { ensureVisible } from '../scroll.js';

const ZONE_ID = 'diagnostics';
const IME_DONE = 65376;

export function createDiagnosticsPage(ctx) {
  const spike = createAvPlaySpike();
  const results = h('div', { class: 'diag-results' });
  const logBox = h('pre', { class: 'diag-log' });
  const runButton = h('button', { class: 'btn primary', type: 'button', text: t('diag.run') });
  const urlInput = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const urlRow = h('label', { class: 'field' }, h('span', { class: 'field-label', text: t('diag.avplayUrl') }), urlInput);
  const playButton = h('button', { class: 'btn', type: 'button', text: t('diag.play') });
  const stopButton = h('button', { class: 'btn', type: 'button', text: t('operations.stop') });
  // The log is focusable too: it is the last stop, so Down scrolls the page all the way to it.
  const focusables = [runButton, urlRow, playButton, stopButton, logBox];

  function renderLog() {
    logBox.textContent = log
      .entries()
      .slice(-40)
      .map((e) => `${new Date(e.ts).toISOString().slice(11, 19)} ${e.level} ${e.message}`)
      .join('\n');
  }
  const unsubscribe = log.subscribe(renderLog);

  async function run() {
    results.textContent = '…';
    const provider = await ctx.providers.getActive();
    const list = await runDiagnostics({ provider });
    while (results.firstChild) results.removeChild(results.firstChild);
    list.forEach((r) =>
      results.appendChild(h('div', { class: `diag-row ${r.status}` }, h('span', { class: 'diag-id', text: r.id }), h('span', { text: r.detail }))),
    );
  }

  const zone = new FocusZone({
    id: ZONE_ID,
    model: new ListModel({ orientation: 'vertical', getCount: () => focusables.length }),
    onFocus: (i) => {
      focusables[i].classList.add('focused');
      ensureVisible(focusables[i], { first: i === 0 });
    },
    onBlur: (i) => focusables[i].classList.remove('focused'),
    onActivate: async (i) => {
      if (i === 0) run();
      else if (i === 1) urlInput.focus();
      else if (i === 2) {
        const { bufferSeconds } = await ctx.settings.get();
        ctx.catalog.pause(); // background sync must not compete with the stream
        spike.play(urlInput.value.trim(), { bufferSeconds });
      } else if (i === 3) {
        spike.stop();
        ctx.catalog.resume();
      }
    },
  });
  urlInput.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.keyCode === 13 || event.keyCode === IME_DONE || event.keyCode === 65385) {
      event.preventDefault();
      urlInput.blur();
    }
  });

  return {
    el: h(
      'section',
      { class: 'page' },
      h('h1', { text: t('settings.diagnostics') }),
      h('div', { class: 'form' }, runButton, results, urlRow, playButton, stopButton),
      h('h2', { text: t('diag.logs') }),
      logBox,
    ),
    mount() {
      ctx.focus.register(zone);
      ctx.focus.focus(ZONE_ID, 0);
      renderLog();
    },
    destroy() {
      spike.stop();
      ctx.catalog.resume();
      unsubscribe();
      ctx.focus.unregister(ZONE_ID);
    },
  };
}
