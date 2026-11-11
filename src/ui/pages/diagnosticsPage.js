import { h } from '../dom.js';
import { createButton } from '../atoms/button.js';
import { createField } from '../atoms/field.js';
import { createHeading } from '../atoms/heading.js';
import { framedPage } from '../components/formPage.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { Dir, ListModel } from '../focus/models.js';
import { runDiagnostics } from '../../services/diagnostics.js';
import { platform } from '../../platform/index.js';
import { log } from '../../core/logger.js';
import { ensureVisible } from '../scroll.js';
import { dbGet } from '../../core/idb.js';
import { NETWORK_REPORT_KEY } from '../../services/catalogSync.js';
import { formatNetworkReport } from '../../services/liveNetworks.js';

const ZONE_ID = 'diagnostics';

export function createDiagnosticsPage(ctx) {
  const spike = platform.createDiagnosticPlayer(); // the player lab of the platform (AVPlay on Tizen)
  const results = h('div', { class: 'diag-results' });
  const logBox = h('pre', { class: 'diag-log scroll' });
  const runButton = createButton({ label: t('diag.run'), variant: 'primary' });
  // A text field like the others (it owns its keys: Enter / Done / Cancel close the keyboard).
  const urlField = createField({ label: t('diag.avplayUrl'), clearable: false });
  const urlInput = urlField.input;
  const urlRow = urlField.el;
  const playButton = createButton({ label: t('diag.play') });
  const stopButton = createButton({ label: t('operations.stop') });
  // The log is focusable too: it is the last stop, so Down scrolls the page all the way to it.
  // Subtitle lab: pick a text track, then try one way of showing it (see platforms/tizen/avplaySpike.js, selectText).
  let labTrack = 0;
  const subtitleOverlay = h('div', { class: 'diag-subtitle' });
  const modeButtons = ['events', 'native', 'before', 'late', 'off'].map((mode) => ({ mode, el: createButton({ label: t(`diag.sub.${mode}`) }) }));
  const trackButton = createButton({ label: t('diag.sub.track', { n: '…' }) });
  // How the Live networks were found (saved by the last Live sync): what was grouped, why, and what was left out.
  const reportButton = createButton({ label: t('diag.networks') });
  const reportBox = h('pre', { class: 'diag-log' });
  const focusables = [runButton, urlRow, playButton, stopButton, trackButton, ...modeButtons.map((b) => b.el), reportButton, logBox];
  const FIRST_MODE = 5;
  const REPORT = FIRST_MODE + modeButtons.length;

  // The log box scrolls by itself: Up / Down on it move through the whole log, and leave it only at its ends.
  const LOG_INDEX = focusables.length - 1;
  const atEnd = () => logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 4;
  function renderLog() {
    const follow = atEnd(); // staying at the bottom keeps showing the newest lines
    logBox.textContent = log
      .entries()
      .map((e) => `${new Date(e.ts).toISOString().slice(11, 19)} ${e.level} ${e.message}`)
      .join('\n');
    if (follow) logBox.scrollTop = logBox.scrollHeight;
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

  async function showReport() {
    reportBox.textContent = '…';
    const active = await ctx.active.get();
    const row = active ? await dbGet(active.db, 'meta', NETWORK_REPORT_KEY) : null;
    reportBox.textContent = row && row.report ? formatNetworkReport(row.report, (key, vars) => t(key, vars)) : t('diag.networks.none');
  }

  const listModel = new ListModel({ orientation: 'vertical', getCount: () => focusables.length });
  const model = {
    getCount: () => listModel.getCount(),
    navigate(dir, index) {
      if (index === LOG_INDEX && (dir === Dir.UP || dir === Dir.DOWN)) {
        const step = Math.max(40, Math.floor(logBox.clientHeight * 0.8));
        const canScroll = dir === Dir.DOWN ? !atEnd() : logBox.scrollTop > 0;
        if (canScroll) {
          logBox.scrollTop += dir === Dir.DOWN ? step : -step;
          return { type: 'move', index }; // same row: the focus stays on the log and no link is followed
        }
      }
      return listModel.navigate(dir, index);
    },
  };
  const zone = new FocusZone({
    id: ZONE_ID,
    nodes: () => focusables,
    model,
    onFocus: (i) => {
      focusables[i].classList.add('focused');
      ensureVisible(focusables[i], { first: i === 0 });
    },
    onBlur: (i) => focusables[i].classList.remove('focused'),
    onActivate: async (i) => {
      if (i === 0) run();
      else if (i === 1) urlInput.focus();
      else if (i === REPORT) showReport();
      else if (i === 4) {
        const tracks = spike.textTracks();
        labTrack = tracks.length ? (labTrack + 1) % tracks.length : 0;
        trackButton.textContent = t('diag.sub.track', { n: tracks.length ? tracks[labTrack].index : '-' });
        log.info('avplay', `subtitle lab: ${tracks.length} text tracks, using ${tracks.length ? tracks[labTrack].index : '-'}`);
      } else if (i >= FIRST_MODE && i < FIRST_MODE + modeButtons.length) {
        const tracks = spike.textTracks();
        spike.selectText(tracks.length ? tracks[labTrack % tracks.length].index : 0, modeButtons[i - FIRST_MODE].mode);
      } else if (i === 2) {
        const { bufferSeconds } = await ctx.settings.get();
        ctx.catalog.pause(); // background sync must not compete with the stream
        spike.play(urlInput.value.trim(), { bufferSeconds, onSubtitle: (text) => { subtitleOverlay.textContent = text; } });
      } else if (i === 3) {
        spike.stop();
        ctx.catalog.resume();
      }
    },
  });

  return {
    el: framedPage(
      subtitleOverlay,
      createHeading({ level: 1, text: t('settings.diagnostics') }),
      h('div', { class: 'form' }, runButton, results, urlRow, playButton, stopButton, trackButton, ...modeButtons.map((b) => b.el), reportButton, reportBox),
      createHeading({ text: t('diag.logs'), className: 'prefs-title' }),
      logBox,
    ),
    mount() {
      ctx.focus.register(zone);
      ctx.focus.focus(ZONE_ID, 0);
      renderLog();
      logBox.scrollTop = logBox.scrollHeight;
    },
    destroy() {
      spike.stop();
      ctx.catalog.resume();
      unsubscribe();
      ctx.focus.unregister(ZONE_ID);
    },
  };
}
