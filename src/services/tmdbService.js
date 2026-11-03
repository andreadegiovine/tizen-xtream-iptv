import { dbGet, dbPut, dbClear } from '../core/idb.js';
import { makeSearchKey } from './titleNormalizer.js';
import { posterUrl } from './tmdbClient.js';

export const META_TTL_MS = 30 * 24 * 3600 * 1000;
export const NOT_FOUND_TTL_MS = 7 * 24 * 3600 * 1000;
export const RECOMMENDATIONS_TTL_MS = 24 * 3600 * 1000;

const yearOf = (date) => Number.parseInt(String(date || '').slice(0, 4), 10) || null;

/** TMDB payload → what the UI needs. */
export function normalizeMeta(type, data) {
  const date = type === 'series' ? data.first_air_date : data.release_date;
  return {
    tmdbId: data.id,
    title: (type === 'series' ? data.name : data.title) || '',
    overview: data.overview || '',
    poster: posterUrl(data.poster_path),
    backdrop: posterUrl(data.backdrop_path, 'w780'),
    rating: Number(data.vote_average) || null,
    genre: Array.isArray(data.genres) ? data.genres.map((g) => g.name).join(', ') : '',
    genreList: Array.isArray(data.genres) ? data.genres.map((g) => ({ id: g.id, name: g.name })) : [],
    runtime: type === 'movie' ? Number(data.runtime) || null : (Array.isArray(data.episode_run_time) && data.episode_run_time[0]) || null,
    year: yearOf(date),
    seasons: Number(data.number_of_seasons) || null,
    episodes: Number(data.number_of_episodes) || null,
    castList: ((data.credits && data.credits.cast) || [])
      .slice(0, 20)
      .map((c) => ({ name: c.name || '', character: c.character || '', photo: posterUrl(c.profile_path, 'w185') }))
      .filter((c) => c.name),
  };
}

/**
 * Conservative title match for entries the provider gave no tmdb id: accept only when exactly one
 * result has the same normalized title (and the same year when the year is known).
 */
export function pickMatch(type, results, name, year) {
  const wanted = makeSearchKey(name);
  const hits = (results || []).filter((r) => {
    const titles = [type === 'series' ? r.name : r.title, type === 'series' ? r.original_name : r.original_title].map(makeSearchKey);
    if (!titles.includes(wanted)) return false;
    if (!year) return true;
    return yearOf(type === 'series' ? r.first_air_date : r.release_date) === year;
  });
  return hits.length === 1 ? hits[0].id : null;
}

/** Runs async jobs with a concurrency cap; `clear()` drops jobs that have not started yet. */
export function createQueue(concurrency = 3) {
  let running = 0;
  let waiting = [];
  function pump() {
    while (running < concurrency && waiting.length) {
      const job = waiting.shift();
      running += 1;
      job().finally(() => {
        running -= 1;
        pump();
      });
    }
  }
  return {
    add(fn) {
      return new Promise((resolve) => {
        waiting.push(() => Promise.resolve().then(fn).then(resolve, () => resolve(null)));
        pump();
      });
    },
    clear() {
      waiting = [];
    },
  };
}

export function createTmdbService({ db, client, getLanguage, now = Date.now }) {
  const queue = createQueue(3);
  const memory = new Map();
  let metaListener = null;

  async function cached(store, key, ttlFor, fetcher) {
    const hit = await dbGet(db, store, key);
    if (hit && now() - hit.fetchedAt < ttlFor(hit)) return hit;
    try {
      const value = await fetcher();
      const record = { key, value, fetchedAt: now() };
      await dbPut(db, store, record);
      return record;
    } catch (err) {
      if (hit) return hit;
      throw err;
    }
  }

  const ttl = (record) => (record.value ? META_TTL_MS : NOT_FOUND_TTL_MS);

  async function getMeta(type, tmdbId) {
    if (!client.enabled || !tmdbId) return null;
    const language = getLanguage();
    const key = `${type}:${tmdbId}:${language}`;
    if (memory.has(key)) return memory.get(key);
    const record = await cached('tmdb', key, ttl, async () => {
      try {
        return normalizeMeta(type, await client.details(type, tmdbId, language));
      } catch (err) {
        if (err && err.details && err.details.status === 404) return null; // cached as "not found" for a week
        throw err;
      }
    });
    memory.set(key, record.value);
    if (metaListener && record.value) Promise.resolve(metaListener(type, tmdbId, record.value)).catch(() => undefined);
    return record.value;
  }

  async function matchTmdbId(type, name, year) {
    if (!client.enabled || type === 'live') return null;
    const key = `${type}:${makeSearchKey(name)}:${year || 0}`;
    const record = await cached('tmdb_match', key, ttl, async () => {
      const data = await client.search(type, name, year, getLanguage());
      return pickMatch(type, data && data.results, name, year);
    });
    return record.value || null;
  }

  /** TMDB ids recommended for a title, or this week's trending titles when `id` is null. */
  async function recommendations(type, id) {
    if (!client.enabled) return [];
    const language = getLanguage();
    const key = `rec:${type}:${id || 'trending'}:${language}`;
    const record = await cached('tmdb', key, () => RECOMMENDATIONS_TTL_MS, async () => {
      const data = id ? await client.recommendations(type, id, language) : await client.trending(type, language);
      return ((data && data.results) || []).map((r) => ({ id: r.id, popularity: Number(r.popularity) || 0 }));
    });
    return record.value || [];
  }

  return {
    get enabled() {
      return client.enabled;
    },
    getMeta,
    /** Called with (type, tmdbId, meta) for every metadata answer; used to index genres. */
    setMetaListener(fn) {
      metaListener = fn;
    },
    /** Forgets every cached answer (metadata, matches, genres, recommendations). */
    async clearAll() {
      memory.clear();
      await dbClear(db, 'tmdb');
      await dbClear(db, 'tmdb_match');
    },
    /** Drops cached metadata and downloads it again for `items` ([{ type, tmdbId }]); resolves with how many were refreshed. */
    async refresh(items) {
      memory.clear();
      await dbClear(db, 'tmdb');
      const done = await Promise.all(items.map((item) => queue.add(() => getMeta(item.type, item.tmdbId))));
      return done.filter(Boolean).length;
    },
    recommendations,
    matchTmdbId,
    /** Metadata for a detail page: provider tmdb id first, otherwise a conservative title match. */
    async forEntry(entry) {
      if (!client.enabled || entry.type === 'live') return null;
      const id = entry.tmdbId || (await matchTmdbId(entry.type, entry.name, entry.year));
      return id ? getMeta(entry.type, id) : null;
    },
    /** Fills visible cards with TMDB title / poster / series counts as the answers arrive. */
    enrich(entries, cards, type, onMeta, keepQueue = false) {
      if (!keepQueue) queue.clear();
      if (!client.enabled || type === 'live') return;
      entries.forEach((entry, i) => {
        if (!entry.tmdbId) return;
        queue.add(async () => {
          const meta = await getMeta(type, entry.tmdbId);
          if (!meta || !cards[i]) return;
          cards[i].update({
            title: meta.title || undefined,
            poster: meta.poster,
            year: entry.year || meta.year || undefined,
            seasons: type === 'series' ? meta.seasons : undefined,
            episodes: type === 'series' ? meta.episodes : undefined,
            rating: entry.rating ? undefined : meta.rating,
          });
          if (onMeta) onMeta(entry, i, meta);
        });
      });
    },
    queue,
  };
}
