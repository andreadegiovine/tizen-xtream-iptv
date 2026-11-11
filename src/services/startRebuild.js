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
    // The main-thread fallback: its code (the whole catalog logic) is loaded only now, it stays out of the start-up bundle.
    return cancelled ? null : import(/* webpackChunkName: "catalog-local" */ './catalogRebuild.js').then((m) => m.runRebuild(payload));
  })();
  return handle;
}
