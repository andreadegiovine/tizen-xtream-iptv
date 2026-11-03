import { kvGet, kvSet } from '../db/kv.js';

const KEY = 'syncLog';

/**
 * When each metadata sync last ran and how long it took ("Metadata" table in the settings):
 * tmdb (metadata refresh), genres (background genre search) and trakt (watch state).
 */
export function createSyncLog({ db, now = Date.now, operations = null }) {
  return {
    get: () => kvGet(db, KEY, {}),
    /**
     * Runs `job` (resolving with the number of items it handled) and records the time, duration and count.
     * The run is listed as an operation in progress; stopping it aborts the `signal` given to `job`
     * (and calls `cancel`, for jobs that run elsewhere, e.g. in a worker).
     */
    async track(name, job, { cancel = null } = {}) {
      const started = now();
      const controller = new AbortController();
      const end = operations
        ? operations.start(name, {
            startedAt: started,
            cancel: () => {
              controller.abort();
              if (cancel) cancel();
            },
          })
        : () => undefined;
      let count = 0;
      let failed = false;
      try {
        const result = await job(controller.signal);
        count = Number(result) || 0;
        return result;
      } catch (err) {
        failed = true;
        throw err;
      } finally {
        // The table reads the log when the operation disappears: write it first.
        const log = await kvGet(db, KEY, {});
        log[name] = { lastSync: now(), durationMs: now() - started, count, failed };
        await kvSet(db, KEY, log);
        end();
      }
    },
    async clear(name) {
      const log = await kvGet(db, KEY, {});
      delete log[name];
      await kvSet(db, KEY, log);
    },
  };
}
