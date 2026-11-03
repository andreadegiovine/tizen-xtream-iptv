/* Genre backfill worker: looks up the genres of titles whose catalog row has none (TMDB or the provider's
 * detail call) and stores them, a few at a time, without touching the UI thread. */
import { runGenreBackfillForProvider } from '../services/genreBackfill.js';
import { createGate } from '../core/gate.js';

const gate = createGate();
let controller = null;

self.onmessage = function (event) {
  const message = event.data || {};
  switch (message.op) {
    case 'start':
      controller = new AbortController();
      runGenreBackfillForProvider({
        provider: message.provider,
        tmdbKey: message.tmdbKey,
        language: message.language,
        signal: controller.signal,
        gate: gate.wait,
        emit: (payload) => self.postMessage(payload),
      }).catch(() => self.postMessage({ event: 'done', done: 0 }));
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
