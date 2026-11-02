import { runEpgForProvider, getEpgMeta, shouldSyncEpg } from './epgSync.js';
import { openProviderDb } from '../db/providerDb.js';
import { requestToPromise } from '../core/idb.js';
import { log } from '../core/logger.js';

const MAX = Number.MAX_SAFE_INTEGER;

/** Guide queries on the active provider's database. */
async function programmesFor(db, channelId, now) {
  const tx = db.transaction('epg', 'readonly');
  const all = await requestToPromise(tx.objectStore('epg').getAll(IDBKeyRange.bound([channelId, 0], [channelId, MAX])));
  return all.filter((p) => p.stop > now).sort((a, b) => a.start - b.start);
}

export function createEpgService({ active, providers, createWorker, runLocal = runEpgForProvider, now = Date.now, readyTimeoutMs = 4000 }) {
  let running = false;

  async function nowNext(channelId) {
    if (!channelId) return { now: null, next: null };
    const current = await active.get();
    if (!current) return { now: null, next: null };
    const t = now();
    const list = await programmesFor(current.db, channelId, t);
    const live = list.find((p) => p.start <= t && p.stop > t) || null;
    const next = list.find((p) => p.start >= (live ? live.stop : t)) || null;
    return { now: live, next };
  }

  async function upcoming(channelId, hours = 24) {
    if (!channelId) return [];
    const current = await active.get();
    if (!current) return [];
    const t = now();
    return (await programmesFor(current.db, channelId, t)).filter((p) => p.start < t + hours * 3600 * 1000);
  }

  /** Runs the sync in a worker, or on the main thread when no worker can be created. */
  function runJob(provider, force) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome) => {
        if (!settled) {
          settled = true;
          resolve(outcome);
        }
      };
      const local = () => runLocal({ provider, force, emit: (m) => m.event === 'done' && finish(m) }).then(finish);
      let worker = null;
      try {
        worker = createWorker();
      } catch {
        local();
        return;
      }
      const timer = setTimeout(() => {
        worker.terminate();
        local();
      }, readyTimeoutMs);
      worker.onmessage = (event) => {
        const m = event.data || {};
        if (m.event === 'ready') {
          clearTimeout(timer);
          worker.postMessage({ op: 'start', provider, force });
        } else if (m.event === 'done') {
          worker.terminate();
          finish(m);
        }
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        local();
      };
    });
  }

  return {
    nowNext,
    upcoming,
    /** Fills channel cards with "now playing" as the answers arrive. */
    decorate(entries, cards) {
      entries.forEach((entry, i) => {
        if (!entry.epgChannelId) return;
        nowNext(entry.epgChannelId)
          .then((n) => cards[i] && n.now && cards[i].update({ subtitle: n.now.title }))
          .catch(() => undefined);
      });
    },
    /** At most once a day (or when forced), after the catalog is in place. Resolves with the outcome or null. */
    async maybeSync({ force = false } = {}) {
      if (running) return null;
      const provider = await providers.getActive();
      if (!provider) return null;
      const db = await openProviderDb(provider.id);
      let due;
      try {
        due = force || shouldSyncEpg(await getEpgMeta(db), now());
      } finally {
        db.close();
      }
      if (!due) return null;
      running = true;
      try {
        const outcome = await runJob(provider, force);
        if (outcome.error) log.warn('EPG sync failed', outcome.error.code);
        return outcome;
      } finally {
        running = false;
      }
    },
  };
}
