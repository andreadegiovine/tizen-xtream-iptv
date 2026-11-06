/* EPG worker: downloads and parses the XMLTV guide off the UI thread (logic in services/epgSync.js). */
import { runEpgForProvider } from '../services/epgSync.js';

let controller = null;

self.onmessage = function (event) {
  const message = event.data || {};
  if (message.op === 'start') {
    controller = new AbortController();
    runEpgForProvider({ provider: message.provider, customUrl: message.customUrl, force: message.force, signal: controller.signal, emit: (payload) => self.postMessage(payload) });
  } else if (message.op === 'cancel' && controller) {
    controller.abort();
  }
};

self.postMessage({ event: 'ready' });
