import { dbGet, dbPut } from '../core/idb.js';
import { decodeBase64Utf8 } from './xtreamClient.js';

export const DETAILS_TTL_MS = 24 * 60 * 60 * 1000;

/** Episodes grouped by season: [{ season, episodes: [{ id, season, number, title, ext, duration, plot }] }]. */
export function parseSeriesInfo(data) {
  const info = (data && data.info) || {};
  const bySeason = (data && data.episodes) || {};
  const seasons = Object.keys(Array.isArray(bySeason) ? { 1: bySeason } : bySeason)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .map((season) => {
      const list = (Array.isArray(bySeason) ? bySeason : bySeason[season]) || [];
      const episodes = list
        .map((ep) => ({
          id: Number(ep.id),
          season,
          number: Number(ep.episode_num) || 0,
          title: String(ep.title || '').trim(),
          ext: String(ep.container_extension || ''),
          duration: Number(ep.info && ep.info.duration_secs) || 0,
          plot: String((ep.info && ep.info.plot) || ''),
          icon: String((ep.info && ep.info.movie_image) || ''),
        }))
        .filter((ep) => Number.isFinite(ep.id))
        .sort((a, b) => a.number - b.number);
      return { season, episodes };
    })
    .filter((s) => s.episodes.length);
  return {
    plot: String(info.plot || ''),
    genre: String(info.genre || ''),
    cast: String(info.cast || ''),
    cover: String(info.cover || ''),
    backdrop: firstBackdrop(info.backdrop_path),
    trailer: String(info.youtube_trailer || info.trailer || ''),
    seasons,
    episodeCount: seasons.reduce((n, s) => n + s.episodes.length, 0),
  };
}

/** Providers send `backdrop_path` as a list (sometimes a single string): the first usable address. */
export function firstBackdrop(value) {
  const list = Array.isArray(value) ? value : [value];
  return String(list.find((item) => typeof item === 'string' && /^https?:/i.test(item)) || '');
}

export function parseVodInfo(data) {
  const info = (data && data.info) || {};
  return {
    plot: String(info.plot || info.description || ''),
    genre: String(info.genre || ''),
    cast: String(info.cast || info.actors || ''),
    director: String(info.director || ''),
    trailer: String(info.youtube_trailer || info.trailer || ''),
    duration: Number(info.duration_secs) || 0,
    cover: String(info.movie_image || info.cover_big || ''),
    backdrop: firstBackdrop(info.backdrop_path),
    year: Number.parseInt(String(info.releasedate || info.release_date || '').slice(0, 4), 10) || null,
  };
}

/** Provider detail calls cached in the provider DB (`details`). */
export function createDetailsService({ active, now = Date.now, ttlMs = DETAILS_TTL_MS }) {
  async function cached(db, key, fetcher, parse) {
    const hit = await dbGet(db, 'details', key);
    if (hit && now() - hit.fetchedAt < ttlMs) return hit.data;
    try {
      const data = parse(await fetcher());
      await dbPut(db, 'details', { key, data, fetchedAt: now() });
      return data;
    } catch (err) {
      if (hit) return hit.data; // stale beats nothing when the provider is unreachable
      throw err;
    }
  }
  return {
    async series(seriesId) {
      const { db, client } = await active.get();
      return cached(db, `series:${seriesId}`, () => client.getSeriesInfo(seriesId), parseSeriesInfo);
    },
    async vod(vodId) {
      const { db, client } = await active.get();
      return cached(db, `movie:${vodId}`, () => client.getVodInfo(vodId), parseVodInfo);
    },
  };
}

export { decodeBase64Utf8 };
