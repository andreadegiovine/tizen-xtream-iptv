import { dbGet, dbPut, dbGetAll, dbDelete } from '../core/idb.js';

export const WATCHED_RATIO = 0.9;
export const STARTED_RATIO = 0.1;

export const isWatched = (position, duration) => duration > 0 && position / duration >= WATCHED_RATIO;
/** A title counts as started (and so as one to continue) once more than 10 % of it was seen. */
export const isStarted = (position, duration) => duration > 0 && position / duration > STARTED_RATIO;
/** Resume only when meaningfully into the title and not finished. */
export const shouldResume = (position, duration) => isStarted(position, duration) && !isWatched(position, duration);

/**
 * Watch key: tmdb-based entries are shared across providers (history survives deleting a provider),
 * other entries are tied to their provider. Series progress is per episode: `<entry>|s1e2`.
 */
export function watchKey(providerId, entryKey, episodeKey = null) {
  const base = /:t\d+$/.test(entryKey) ? entryKey : `${providerId}:${entryKey}`;
  return episodeKey ? `${base}|${episodeKey}` : base;
}

/** Local watch-state adapter (the Trakt adapter wraps this one). */
export class WatchStore {
  constructor(db) {
    this.db = db;
    this.writes = Promise.resolve(); // reads wait for saves still in flight (e.g. saved on leaving the player)
  }

  async get(key) {
    await this.writes;
    return dbGet(this.db, 'watch', key);
  }

  /** record: { key, providerId, entryKey, type, title, icon, episodeKey?, position, duration } */
  async save(record, now = Date.now()) {
    const next = { ...record, watched: isWatched(record.position, record.duration), updatedAt: now };
    const write = dbPut(this.db, 'watch', next);
    this.writes = this.writes.then(() => write).catch(() => undefined);
    await write;
    return next;
  }

  /** All records of one title (its episodes), newest first. */
  async recentForEntry(entryKey) {
    await this.writes;
    const all = await dbGetAll(this.db, 'watch');
    return all.filter((r) => r.entryKey === entryKey).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async recent({ providerId = null, limit = 20, onlyUnfinished = true } = {}) {
    await this.writes;
    const all = await dbGetAll(this.db, 'watch');
    const seen = new Set();
    const result = [];
    // Per title: its records, newest first (the first one is the row shown).
    const groups = new Map();
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const rec of all) {
      if (providerId && rec.providerId !== providerId) continue;
      if (!groups.has(rec.entryKey)) groups.set(rec.entryKey, []);
      groups.get(rec.entryKey).push(rec);
    }
    for (const records of groups.values()) {
      const rec = records[0]; // one row per title: the most recent episode wins
      if (seen.has(rec.entryKey)) continue;
      seen.add(rec.entryKey);
      if (onlyUnfinished) {
        // A movie stays once started (> 10 %) and not finished. A series stays while an episode was started or finished
        // (it may have a next one; see continueWatching.js for the finished ones).
        const keep = rec.type === 'series' ? records.some((r) => r.watched || isStarted(r.position, r.duration)) : !rec.watched && isStarted(rec.position, rec.duration);
        if (!keep) continue;
      }
      result.push(rec);
      if (result.length >= limit) break;
    }
    return result;
  }

  /** Forgets every record of one title (all its episodes). */
  async clearEntry(providerId, entryKey) {
    await this.writes;
    const base = watchKey(providerId, entryKey);
    const all = await dbGetAll(this.db, 'watch');
    const mine = all.filter((r) => r.key === base || r.key.indexOf(`${base}|`) === 0);
    await Promise.all(mine.map((r) => dbDelete(this.db, 'watch', r.key)));
    return mine.length;
  }

  /** Changes some fields of a record without touching `watched` or `updatedAt`. */
  async patch(key, fields) {
    await this.writes;
    const record = await dbGet(this.db, 'watch', key);
    if (!record) return null;
    const next = { ...record, ...fields };
    await dbPut(this.db, 'watch', next);
    return next;
  }

  async remove(key) {
    await this.writes;
    await dbDelete(this.db, 'watch', key);
  }

  /** Deletes the records that were imported from an external service. */
  async removeBySource(source) {
    await this.writes;
    const all = await dbGetAll(this.db, 'watch');
    const mine = all.filter((r) => r.source === source);
    await Promise.all(mine.map((r) => dbDelete(this.db, 'watch', r.key)));
    return mine.length;
  }

  /** Every record, for badges (one read per rendered page). */
  async all() {
    await this.writes;
    return dbGetAll(this.db, 'watch');
  }

  /** Titles with any watch record (finished or started), as `movie:t123` / `series:t456`: never suggested again. */
  async seenKeys() {
    await this.writes;
    const out = new Set();
    for (const rec of await dbGetAll(this.db, 'watch')) {
      const match = /^(movie|series):t(\d+)/.exec(rec.entryKey || '');
      if (match) out.add(`${match[1]}:t${match[2]}`);
    }
    return out;
  }

  /** Most recently watched tmdb ids, used to seed suggestions. */
  async seeds(limit = 10) {
    await this.writes;
    const all = await dbGetAll(this.db, 'watch');
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    const out = [];
    const seen = new Set();
    for (const rec of all) {
      const match = /^(movie|series):t(\d+)/.exec(rec.entryKey || '');
      if (!match || seen.has(`${match[1]}:${match[2]}`)) continue;
      seen.add(`${match[1]}:${match[2]}`);
      out.push({ type: match[1], tmdbId: Number(match[2]) });
      if (out.length >= limit) break;
    }
    return out;
  }
}
