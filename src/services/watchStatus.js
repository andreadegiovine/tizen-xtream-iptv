import { watchKey } from './watchStore.js';

/** Groups watch records per title: { watchedMovie, watchedEpisodes, started }. Keys follow watchKey(). */
export function summarizeWatch(records) {
  const map = new Map();
  records.forEach((rec) => {
    const key = watchKey(rec.providerId, rec.entryKey);
    const item = map.get(key) || { watchedMovie: false, watchedEpisodes: 0, started: false };
    if (rec.episodeKey) {
      if (rec.watched) item.watchedEpisodes += 1;
      else if (rec.position > 0) item.started = true;
    } else if (rec.watched) item.watchedMovie = true;
    else if (rec.position > 0) item.started = true;
    map.set(key, item);
  });
  return map;
}

/**
 * Badge for a card: 'watched' | 'partial' | null.
 * Movies: watched only. Series: partial as soon as something was watched, watched when every
 * episode is known to be watched (`totalEpisodes` comes from TMDB; unknown total → never "watched").
 */
export function watchStatus(type, summary, totalEpisodes = null) {
  if (!summary) return null;
  if (type === 'movie') return summary.watchedMovie ? 'watched' : null;
  if (type === 'series') {
    if (totalEpisodes && summary.watchedEpisodes >= totalEpisodes) return 'watched';
    return summary.watchedEpisodes > 0 || summary.started ? 'partial' : null;
  }
  return null;
}
