import { dbGet, dbPut, dbGetAll, dbDelete } from '../core/idb.js';

export const WATCHED_RATIO = 0.9;
export const RESUME_MIN_SECONDS = 30;

export const isWatched = (position, duration) => duration > 0 && position / duration >= WATCHED_RATIO;
/** Resume only when meaningfully into the title and not finished. */
export const shouldResume = (position, duration) => position >= RESUME_MIN_SECONDS && !isWatched(position, duration);

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
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const rec of all) {
      if (providerId && rec.providerId !== providerId) continue;
      const group = rec.entryKey; // one row per title: the most recent episode wins
      if (seen.has(group)) continue;
      seen.add(group);
      if (onlyUnfinished && rec.watched && rec.type !== 'series') continue;
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
