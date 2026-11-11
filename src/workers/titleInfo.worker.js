/* Title details worker: reads the details of the titles listed without a TMDB id (and, when asked, looks them up on TMDB by title) and
 * keeps what they give, a few at a time, without touching the UI thread. The logic is in services/titleInfoRun.js. */
import { runTitleInfoForProvider } from '../services/titleInfoRun.js';
import { createGate } from '../core/gate.js';

const gate = createGate();
let controller = null;

self.onmessage = function (event) {
  const message = event.data || {};
  switch (message.op) {
    case 'start':
      controller = new AbortController();
      runTitleInfoForProvider({
        provider: message.provider,
        search: message.search || null,
        excluded: message.excluded || {},
        cleanTitles: message.cleanTitles !== false,
        grouping: message.grouping || undefined,
        mode: message.mode,
        signal: controller.signal,
        gate: gate.wait,
        emit: (payload) => self.postMessage(payload),
      }).catch(() => self.postMessage({ event: 'done', count: 0, byType: {} }));
      break;
    case 'pause':
      gate.pause();
      break;
    case 'resume':
      gate.resume();
      break;
    case 'cancel':
      if (controller) controller.abort();
      gate.resume();
      break;
    default:
  }
};

self.postMessage({ event: 'ready' });
