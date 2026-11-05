import { MediaType } from './mediaType.js';

function toInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** Providers disagree on the field name ("tmdb", "tmdb_id") and on "no value" ("", "0", null). */
export function readTmdbId(raw) {
  const id = toInt(raw && (raw.tmdb ?? raw.tmdb_id));
  return id !== null && id > 0 ? id : null;
}

export function readRating(raw) {
  const ten = Number.parseFloat(raw && raw.rating);
  if (Number.isFinite(ten) && ten > 0) return Math.min(10, ten);
  const five = Number.parseFloat(raw && raw.rating_5based);
  if (Number.isFinite(five) && five > 0) return Math.min(10, five * 2);
  return null;
}

export function readYear(raw) {
  const candidates = [raw.year, raw.releaseDate, raw.release_date, raw.releasedate];
  for (const value of candidates) {
    const match = /(?:19|20)\d{2}/.exec(String(value ?? ''));
    if (match) return Number(match[0]);
  }
  return null;
}

function toSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readCategoryId(raw) {
  const direct = raw.category_id ?? (Array.isArray(raw.category_ids) ? raw.category_ids[0] : '');
  return direct === null || direct === undefined ? '' : String(direct);
}

/** The provider's own flag (`is_adult`: "1", 1 or true) marks an adult title. */
export const readAdult = (raw) => Boolean(raw) && (raw.is_adult === 1 || raw.is_adult === true || String(raw.is_adult).trim() === '1');

/** Keeps only the fields the app needs from a raw provider list row. Returns null for unusable rows. */
export function projectItem(type, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = toInt(type === MediaType.SERIES ? raw.series_id : raw.stream_id);
  if (id === null) return null;
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  return {
    key: `${type}:${id}`,
    type,
    id,
    name,
    categoryId: readCategoryId(raw),
    added: toSeconds(type === MediaType.SERIES ? raw.last_modified : raw.added),
    tmdbId: type === MediaType.LIVE ? null : readTmdbId(raw),
    rating: type === MediaType.LIVE ? null : readRating(raw),
    year: type === MediaType.LIVE ? null : readYear(raw),
    icon: String(raw.stream_icon || raw.cover || ''),
    ext: String(raw.container_extension || ''),
    genre: type === MediaType.LIVE ? '' : String(raw.genre || ''),
    epgChannelId: raw.epg_channel_id ? String(raw.epg_channel_id) : null,
    ...(readAdult(raw) ? { adult: true } : {}),
  };
}
