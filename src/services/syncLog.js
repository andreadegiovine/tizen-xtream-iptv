import { kvGet, kvSet } from '../db/kv.js';

const KEY = 'syncLog';

/**
 * When each metadata sync last ran and how long it took ("Metadata" table in the settings):
 * tmdb (metadata refresh), genres (background genre search) and trakt (watch state).
 */
export function createSyncLog({ db, now = Date.now }) {
  return {
    get: () => kvGet(db, KEY, {}),
    /** Runs `job` (resolving with the number of items it handled) and records the time, duration and count. */
    async track(name, job) {
      const started = now();
      let count = 0;
      let failed = false;
      try {
        const result = await job();
        count = Number(result) || 0;
        return result;
      } catch (err) {
        failed = true;
        throw err;
      } finally {
        const log = await kvGet(db, KEY, {});
        log[name] = { lastSync: now(), durationMs: now() - started, count, failed };
        await kvSet(db, KEY, log);
      }
    },
    async clear(name) {
      const log = await kvGet(db, KEY, {});
      delete log[name];
      await kvSet(db, KEY, log);
    },
  };
}
