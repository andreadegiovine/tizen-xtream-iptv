/*
 * What the title page (src/ui/pages/detailPage.js) works out from its data, apart from the page: the episodes in order and the next
 * one to watch, the line of facts under the title, cast and tags, the season choice, where the programme list lands.
 */
import { t } from '../../../i18n/index.js';
import { formatRating } from '../../components/card.js';

/** Flat, ordered episode list across seasons. */
export function flattenEpisodes(seasons) {
  return seasons.flatMap((s) => s.episodes);
}

/** Next up for a series: the most recently watched unfinished episode, otherwise the first unwatched, otherwise the first. */
export function pickNextEpisode(episodes, records) {
  const byKey = new Map(records.map((r) => [r.episodeKey, r]));
  const keyOf = (ep) => `s${ep.season}e${ep.number}`;
  const unfinished = records
    .filter((r) => !r.watched && episodes.some((ep) => keyOf(ep) === r.episodeKey))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (unfinished) return { episode: episodes.find((ep) => keyOf(ep) === unfinished.episodeKey), record: unfinished };
  const firstNew = episodes.find((ep) => !(byKey.get(keyOf(ep)) || {}).watched);
  return { episode: firstNew || episodes[0], record: null };
}

/** "112" → "1h 52m", "45" → "45 min". */
export function formatRuntime(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (total <= 0) return '';
  if (total < 60) return t('detail.minutes', { count: total });
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

export const seasonsLabel = (count) => t('detail.seasons', { count });
export const episodesLabel = (count) => t('detail.episodes', { count });

/**
 * Line under the title: year, rating, then duration (movies) or seasons + episodes (series).
 * Returns [{ kind: 'text' | 'rating', text }] so the rating can get its star icon.
 */
export function detailMetaParts({ type, year, rating, runtime, seasons, episodes }) {
  const parts = [];
  if (year) parts.push({ kind: 'text', text: String(year) });
  const stars = formatRating(rating);
  if (stars) parts.push({ kind: 'rating', text: stars });
  if (type === 'movie') {
    const text = formatRuntime(runtime);
    if (text) parts.push({ kind: 'text', text });
  } else if (type === 'series') {
    if (seasons) parts.push({ kind: 'text', text: seasonsLabel(seasons) });
    if (episodes) parts.push({ kind: 'text', text: episodesLabel(episodes) });
  }
  return parts;
}

/** Cast cards: TMDB credits when available, otherwise the provider's comma separated names. */
export function castFrom(meta, info) {
  if (meta && meta.castList && meta.castList.length) return meta.castList;
  const names = String((info && info.cast) || '')
    .split(/[,;]/)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.slice(0, 20).map((name) => ({ name, character: '', photo: '' }));
}

/** Genres as separate tags: "Action, Drama / Thriller" → ['Action', 'Drama', 'Thriller']. */
export function tagsFrom(meta, info) {
  const raw = (meta && meta.genre) || (info && info.genre) || '';
  return Array.from(new Set(String(raw).split(/[,/|]/).map((tag) => tag.trim()).filter(Boolean))).slice(0, 8);
}

/** "Stagione 1 (10 episodi)" */
export const seasonOptionLabel = (season) => t('detail.seasonOption', { season: season.season, count: episodesLabel(season.episodes.length) });

/** Season index to show first: the one holding the episode that plays next. */
export function seasonIndexOf(seasons, episode) {
  const index = episode ? seasons.findIndex((s) => s.season === episode.season) : 0;
  return Math.max(0, index);
}

/** Movie / series / channel page. params: { entryKey, type, live?: { categoryId, offset } } */
/** Index of the programme to focus when the page is opened from the guide on the one starting at `start`: that one, else the one on at that time, else the first after it, else the first. */
export function landingIndex(list, start) {
  const exact = list.findIndex((p) => p.start === start);
  if (exact >= 0) return exact;
  const after = list.findIndex((p) => p.stop > start);
  return after >= 0 ? after : 0;
}

