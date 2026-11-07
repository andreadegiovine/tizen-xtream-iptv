import { runEpgForProvider, getEpgMeta, shouldSyncEpg, clearEpg } from './epgSync.js';
import { openProviderDb } from '../db/providerDb.js';
import { requestToPromise, dbGet } from '../core/idb.js';
import { log } from '../core/logger.js';
import { isPlaceholderTitle } from './xmltv.js';
import { EPG_CHANNELS_KEY, summaryValid, channelsBetween } from './epgChannels.js';

const MAX = Number.MAX_SAFE_INTEGER;

/** A stored programme that is a real one: guides downloaded before the placeholders were dropped may still hold "EPG non disponibile". */
const isReal = (p) => !isPlaceholderTitle(p.title);

/** Guide queries on the active provider's database. */
async function programmesFor(db, channelId, now) {
  const tx = db.transaction('epg', 'readonly');
  const all = await requestToPromise(tx.objectStore('epg').getAll(IDBKeyRange.bound([channelId, 0], [channelId, MAX])));
  return all.filter((p) => p.stop > now && isReal(p)).sort((a, b) => a.start - b.start);
}

export function createEpgService({ active, providers, createWorker, runLocal = runEpgForProvider, now = Date.now, readyTimeoutMs = 4000, operations = null, customUrl = () => Promise.resolve('') }) {
  let running = false;
  let cancelJob = null;
  const updated = new Set();
  let summaryJob = null; // { db, promise }: the channel summary of the active provider's database, read once per guide download

  /** The stored channel summary (spans and genres) while the guide is valid, or null. */
  async function summary() {
    const current = await active.get();
    if (!current) return null;
    if (!summaryJob || summaryJob.db !== current.db) summaryJob = { db: current.db, promise: dbGet(current.db, 'meta', EPG_CHANNELS_KEY).catch(() => null) };
    const found = await summaryJob.promise;
    return summaryValid(found, now()) ? found : null;
  }

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

  /**
   * The programmes of several channels between two instants (the guide grid): Map channelId → list sorted by start. One read
   * transaction; programmes that started up to 12 hours before `from` are included when they are still on at `from`.
   */
  async function programmesBetween(channelIds, from, to) {
    const out = new Map();
    const current = await active.get();
    if (!current || !channelIds.length) return out;
    const store = current.db.transaction('epg', 'readonly').objectStore('epg');
    await Promise.all(
      channelIds.map(async (id) => {
        const list = await requestToPromise(store.getAll(IDBKeyRange.bound([id, from - 12 * 3600 * 1000], [id, to])));
        out.set(id, list.filter((p) => p.stop > from && isReal(p)).sort((a, b) => a.start - b.start));
      }),
    );
    return out;
  }

  /**
   * The channels that have at least one real programme on between two instants (the guide leaves out the ones without, and the ones
   * whose guide only says "not available"): one pass over the store, jumping from channel to channel.
   */
  async function channelsWithGuide(from, to) {
    // Read from the summary of the last download; a guide downloaded before it existed is walked as before.
    const known = await summary();
    if (known) return channelsBetween(known, from, to);
    const out = new Set();
    const current = await active.get();
    if (!current) return out;
    const back = from - 12 * 3600 * 1000;
    const store = current.db.transaction('epg', 'readonly').objectStore('epg');
    await new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const [id, start] = cursor.key;
        if (start < back) cursor.continue([id, back]); // to the part of this channel that can matter
        else if (start < to && cursor.value.stop > from && isReal(cursor.value)) {
          out.add(id);
          cursor.continue([id, []]); // an array sorts after every number: the next channel
        } else if (start >= to) cursor.continue([id, []]);
        else cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  }

  /** Runs the sync in a worker, or on the main thread when no worker can be created. */
  function runJob(provider, force, custom) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (outcome) => {
        if (!settled) {
          settled = true;
          resolve(outcome);
        }
      };
      const local = () => runLocal({ provider, customUrl: custom, force, emit: (m) => m.event === 'done' && finish(m) }).then(finish);
      let worker = null;
      cancelJob = () => {
        if (worker) worker.terminate();
        finish({ event: 'done', cancelled: true });
      };
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
          worker.postMessage({ op: 'start', provider, customUrl: custom, force });
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
    /** Called after every guide download that went well (the programme grid reads its programmes again). Returns the unsubscribe. */
    onUpdated(handler) {
      updated.add(handler);
      return () => updated.delete(handler);
    },
    /** The last download of the active provider's guide (`meta` record `epg`), or null. */
    async status() {
      const current = await active.get();
      return current ? getEpgMeta(current.db).catch(() => null) : null;
    },
    /** Deletes the active provider's guide (the next start, or the update button, downloads it again). */
    async clear() {
      if (cancelJob) cancelJob();
      const current = await active.get();
      if (!current) return;
      await clearEpg(current.db);
      summaryJob = null;
      updated.forEach((handler) => handler());
    },
    nowNext,
    programmesBetween,
    /**
     * Genres of the guide (XMLTV categories): `{ genres: [{ key, name }] by name, byChannel: Map(epgChannelId → [key]) }`, empty when the
     * guide has none or expired.
     */
    async genres() {
      const known = await summary();
      const byChannel = new Map();
      if (!known) return { genres: [], byChannel };
      Object.keys(known.channels).forEach((id) => {
        if (known.channels[id].genres) byChannel.set(id, known.channels[id].genres);
      });
      const genres = Object.keys(known.genres)
        .map((key) => ({ key, name: known.genres[key] }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      return { genres, byChannel };
    },
    channelsWithGuide,
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
      const startedAt = now();
      const end = operations ? operations.start('epg', { cancel: () => cancelJob && cancelJob() }) : () => undefined;
      try {
        const outcome = await runJob(provider, force, await customUrl().catch(() => ''));
        if (outcome.error) log.warn('EPG sync failed', outcome.error.code);
        else {
          log.info(`EPG sync done in ${now() - startedAt} ms`);
          summaryJob = null; // read again: the download wrote a new one
          if (!outcome.cancelled) updated.forEach((handler) => handler());
        }
        return outcome;
      } finally {
        running = false;
        cancelJob = null;
        end();
      }
    },
  };
}
