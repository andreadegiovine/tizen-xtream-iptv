/* Catalog sync worker: all heavy work (download, JSON parse, projection, grouping, IndexedDB writes)
 * runs here so the TV's UI thread stays responsive. The logic itself lives in services/catalogSync.js,
 * shared with the main-thread fallback. */
import { runSyncForProvider } from '../services/catalogSync.js';
import { createGate } from '../core/gate.js';
import { runRebuild } from '../services/catalogRebuild.js';

const gate = createGate();
let controller = null;

const toSets = (excluded) =>
  Object.fromEntries(Object.entries(excluded || {}).map(([type, ids]) => [type, new Set(ids)]));

self.onmessage = function (event) {
  const message = event.data || {};
  switch (message.op) {
    case 'start':
      controller = new AbortController();
      runSyncForProvider({
        provider: message.provider,
        types: message.types,
        excluded: toSets(message.excluded),
        cleanTitles: message.cleanTitles !== false,
        grouping: message.grouping || undefined,
        force: message.force,
        rewrite: Boolean(message.rewrite),
        signal: controller.signal,
        emit: (payload) => self.postMessage(payload),
        gate: gate.wait,
      });
      break;
    case 'rebuild':
      // Entries worked out again from the stored lists (exclusions, title cleaning, Live grouping changed): no download.
      runRebuild({ providerId: message.providerId, types: message.types, excluded: message.excluded, cleanTitles: message.cleanTitles !== false, grouping: message.grouping || undefined })
        .then((counts) => self.postMessage({ event: 'rebuilt', counts }))
        .catch((err) => self.postMessage({ event: 'rebuilt', error: String((err && err.message) || err) }));
      break;
    case 'cancel':
      if (controller) controller.abort();
      gate.resume();
      break;
    case 'pause':
      gate.pause();
      break;
    case 'resume':
      gate.resume();
      break;
    default:
  }
};

self.postMessage({ event: 'ready' });
