import { openProviderDb } from '../db/providerDb.js';
import { rebuildEntries } from './catalogSync.js';

/**
 * Works out the entries (and the Live groups / networks) of some media types again from the stored lists, with no download.
 * Shared by the catalog worker and the main-thread fallback: `excluded` is { type: [category ids] }.
 */
export async function runRebuild({ providerId, types, excluded = {}, cleanTitles = true, grouping, db: given = null }) {
  const db = given || (await openProviderDb(providerId));
  const counts = {};
  try {
    for (const type of types) {
      counts[type] = await rebuildEntries({ db, type, excludedCategories: new Set(excluded[type] || []), cleanTitles, grouping: type === 'live' ? grouping : undefined });
    }
  } finally {
    if (!given) db.close();
  }
  return counts;
}

/**
 * Runs `runRebuild` in a catalog worker (the UI thread stays free: rebuilding 30 000 titles blocks it for seconds on a TV), or on the
 * main thread when no worker can be made. Resolves with { type: entries }; `cancel()` on the returned handle stops a worker run.
 */
export function startRebuild(payload, { createWorker = null, readyTimeoutMs = 4000 } = {}) {
  let worker = null;
  let cancelled = false;
  const handle = {
    cancel() {
      cancelled = true;
      if (worker) worker.terminate();
    },
  };
  const inWorker = () =>
    new Promise((resolve, reject) => {
      try {
        worker = createWorker();
      } catch (err) {
        reject(err);
        return;
      }
      const timer = setTimeout(() => reject(new Error('worker did not report ready')), readyTimeoutMs);
      handle.cancel = () => {
        cancelled = true;
        clearTimeout(timer);
        worker.terminate();
        resolve(null);
      };
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.event === 'ready') {
          clearTimeout(timer);
          worker.postMessage({ op: 'rebuild', ...payload });
        } else if (message.event === 'rebuilt') {
          worker.terminate();
          if (message.error) reject(new Error(message.error));
          else resolve(message.counts);
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error((event && event.message) || 'worker error'));
      };
    });
  handle.promise = (async () => {
    if (createWorker) {
      try {
        return await inWorker();
      } catch {
        if (cancelled) return null;
        if (worker) worker.terminate();
        worker = null;
      }
    }
    return cancelled ? null : runRebuild(payload);
  })();
  return handle;
}
