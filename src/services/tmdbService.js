import { dbGet, dbPut, dbClear, dbGetAllKeys } from '../core/idb.js';
import { makeSearchKey } from './titleNormalizer.js';
import { posterUrl } from './tmdbClient.js';

export const META_TTL_MS = 120 * 24 * 3600 * 1000;
export const NOT_FOUND_TTL_MS = 7 * 24 * 3600 * 1000;
export const RECOMMENDATIONS_TTL_MS = 24 * 3600 * 1000;

/** Cache key of the metadata of one title in one language: independent of the provider. */
export const metaKey = (type, tmdbId, language) => `meta:${type}:${tmdbId}:${language}`;

const yearOf = (date) => Number.parseInt(String(date || '').slice(0, 4), 10) || null;

/** YouTube key of the best trailer: the UI language first, then English, then any; trailers before teasers. */
export function trailerKeyOf(videos, language = '') {
  const list = ((videos && videos.results) || []).filter((v) => v && v.site === 'YouTube' && v.key && (v.type === 'Trailer' || v.type === 'Teaser'));
  const lang = String(language).slice(0, 2);
  const rank = (v) => (v.type === 'Trailer' ? 0 : 4) + (v.iso_639_1 === lang ? 0 : v.iso_639_1 === 'en' ? 1 : 2);
  const best = list.slice().sort((a, b) => rank(a) - rank(b))[0];
  return best ? best.key : '';
}

/**
 * What is kept in the database for every title of the catalog: only what the grids and the genre lists need.
 * Backdrop, plot, cast, companies and trailer are fetched when the title page opens (see `getFull`).
 */
export function gridMeta(meta) {
  return {
    tmdbId: meta.tmdbId,
    title: meta.title,
    poster: meta.poster,
    rating: meta.rating,
    genre: meta.genre,
    genreList: meta.genreList,
    year: meta.year,
    seasons: meta.seasons,
    episodes: meta.episodes,
  };
}

/** Movie directors (crew job "Director"); for series the creators, falling back to directors of the crew. */
function directorsOf(data) {
  const crew = ((data.credits && data.credits.crew) || []).filter((c) => c.job === 'Director' && c.name).map((c) => c.name);
  const creators = (Array.isArray(data.created_by) ? data.created_by : []).map((c) => c.name).filter(Boolean);
  const names = creators.length ? creators : crew;
  return names.filter((n, i) => names.indexOf(n) === i).slice(0, 4);
}

/** TMDB payload → what the UI needs. */
export function normalizeMeta(type, data, language = '') {
  const date = type === 'series' ? data.first_air_date : data.release_date;
  return {
    tmdbId: data.id,
    title: (type === 'series' ? data.name : data.title) || '',
    originalTitle: (type === 'series' ? data.original_name : data.original_title) || '',
    overview: data.overview || '',
    poster: posterUrl(data.poster_path),
    backdrop: posterUrl(data.backdrop_path, 'w1280'),
    rating: Number(data.vote_average) || null,
    genre: Array.isArray(data.genres) ? data.genres.map((g) => g.name).join(', ') : '',
    genreList: Array.isArray(data.genres) ? data.genres.map((g) => ({ id: g.id, name: g.name })) : [],
    runtime: type === 'movie' ? Number(data.runtime) || null : (Array.isArray(data.episode_run_time) && data.episode_run_time[0]) || null,
    year: yearOf(date),
    seasons: Number(data.number_of_seasons) || null,
    episodes: Number(data.number_of_episodes) || null,
    trailerKey: trailerKeyOf(data.videos, language),
    companies: (Array.isArray(data.production_companies) ? data.production_companies : [])
      .map((c) => ({ id: c.id, name: c.name || '', logo: posterUrl(c.logo_path, 'w185') }))
      .filter((c) => c.name),
    directors: directorsOf(data),
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
export function createQueue(concurrency = 3, onChange = null) {
  let running = 0;
  let waiting = [];
  const changed = () => onChange && onChange(running + waiting.length);
  function pump() {
    while (running < concurrency && waiting.length) {
      const job = waiting.shift();
      running += 1;
      job().finally(() => {
        running -= 1;
        pump();
        changed();
      });
    }
  }
  return {
    add(fn) {
      return new Promise((resolve) => {
        waiting.push(() => Promise.resolve().then(fn).then(resolve, () => resolve(null)));
        pump();
        changed();
      });
    },
    clear() {
      waiting = [];
      changed();
    },
    size: () => running + waiting.length,
  };
}

/**
 * TMDB metadata, cached by tmdb id and language (not by provider) for 120 days. A background job fills the
 * cache for the whole catalog; what the user is looking at (visible cards, an open page) is requested at
 * once by this service, and `onActivity(count)` tells the background job to wait while that goes on.
 */
export function createTmdbService({ db, client, getLanguage, now = Date.now, onActivity = null }) {
  let inFlight = 0;
  const report = () => onActivity && onActivity(inFlight + queue.size());
  const queue = createQueue(3, report);
  const memory = new Map();
  const fullMemory = new Map(); // detail-page metadata: kept for the session only, not in the database

  /** Runs a request the user is waiting for; while any is pending the background job holds back. */
  async function priority(fn) {
    inFlight += 1;
    report();
    try {
      return await fn();
    } finally {
      inFlight -= 1;
      report();
    }
  }

  async function cached(store, key, ttlFor, fetcher) {
    const hit = await dbGet(db, store, key);
    if (hit && (hit.expiresAt || 0) > now()) return hit;
    try {
      const value = await fetcher();
      const stamp = now();
      const record = { key, value, fetchedAt: stamp, expiresAt: stamp + ttlFor(value) };
      await dbPut(db, store, record);
      return record;
    } catch (err) {
      if (hit) return hit; // offline: an expired answer is better than none
      throw err;
    }
  }

  const ttl = (value) => (value ? META_TTL_MS : NOT_FOUND_TTL_MS);

  async function getMeta(type, tmdbId) {
    if (!client.enabled || !tmdbId) return null;
    const language = getLanguage();
    const key = metaKey(type, tmdbId, language);
    if (memory.has(key)) return memory.get(key);
    const record = await cached('tmdb', key, ttl, async () => {
      try {
        return gridMeta(normalizeMeta(type, await client.details(type, tmdbId, language, { full: false }), language));
      } catch (err) {
        if (err && err.details && err.details.status === 404) return null; // cached as "not found" for a week
        throw err;
      }
    });
    memory.set(key, record.value);
    return record.value;
  }

  /** Everything TMDB knows about a title (plot, cast, companies, backdrop, trailer), fetched when its page opens. */
  async function getFull(type, tmdbId) {
    if (!client.enabled || !tmdbId) return null;
    const language = getLanguage();
    const key = metaKey(type, tmdbId, language);
    if (fullMemory.has(key)) return fullMemory.get(key);
    try {
      const value = normalizeMeta(type, await client.details(type, tmdbId, language), language);
      fullMemory.set(key, value);
      return value;
    } catch (err) {
      if (err && err.details && err.details.status === 404) return null;
      return getMeta(type, tmdbId).catch(() => null); // offline: the light record of the grids is better than nothing
    }
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

  /**
   * TMDB ids recommended for a title, or this week's trending titles when `id` is null: every page TMDB has (20 titles each; recommendations
   * rarely go past 2 pages), up to MAX_PAGES for the trending list. The rows show them lazily, so there is no reason to stop at 20.
   */
  const MAX_PAGES = 5;
  async function recommendations(type, id) {
    if (!client.enabled) return [];
    const language = getLanguage();
    const key = `rec:${type}:${id || 'trending'}:${language}`;
    const record = await cached('tmdb', key, () => RECOMMENDATIONS_TTL_MS, async () => {
      const page = (n) => (id ? client.recommendations(type, id, language, n) : client.trending(type, language, n));
      const first = await page(1);
      const results = ((first && first.results) || []).slice();
      const pages = Math.min(MAX_PAGES, Number(first && first.total_pages) || 1);
      for (let n = 2; n <= pages; n += 1) {
        const more = await page(n).catch(() => null);
        if (!more || !more.results || !more.results.length) break;
        results.push(...more.results);
      }
      const seen = new Set();
      return results.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({ id: r.id, popularity: Number(r.popularity) || 0 }));
    });
    return record.value || [];
  }

  return {
    get enabled() {
      return client.enabled;
    },
    getMeta,
    getFull,
    /** How many titles have their metadata downloaded (all languages). */
    async countMeta() {
      return (await dbGetAllKeys(db, 'tmdb', { range: IDBKeyRange.bound('meta:', 'meta:\uffff') })).length;
    },
    /** Forgets every cached answer (metadata, matches, genres, recommendations). */
    async clearAll() {
      memory.clear();
      fullMemory.clear();
      await dbClear(db, 'tmdb');
      await dbClear(db, 'tmdb_match');
    },
    recommendations,
    matchTmdbId,
    /** Metadata for a detail page: provider tmdb id first, otherwise a conservative title match. */
    forEntry(entry) {
      if (!client.enabled || entry.type === 'live') return Promise.resolve(null);
      return priority(async () => {
        const id = entry.tmdbId || (await matchTmdbId(entry.type, entry.name, entry.year));
        return id ? getFull(entry.type, id) : null;
      });
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
            year: meta.year || entry.year || undefined,
            seasons: type === 'series' ? meta.seasons : undefined,
            episodes: type === 'series' ? meta.episodes : undefined,
            rating: meta.rating || undefined,
          });
          if (onMeta) onMeta(entry, i, meta);
        });
      });
    },
    queue,
  };
}
