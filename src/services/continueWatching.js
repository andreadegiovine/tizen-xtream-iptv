import { summarizeWatch } from './watchStatus.js';
import { watchKey } from './watchStore.js';

/**
 * A series is finished when Trakt has every aired episode watched (`traktComplete`), when every episode TMDB knows is watched, or when it
 * was marked as seen by hand (`seriesDone` = the episode total known at that moment). New episodes (a bigger TMDB total) bring it back.
 */
export function isSeriesFinished(record, watchedEpisodes, total) {
  // Trakt has every aired episode watched (set at each alignment with Trakt; a new aired episode clears it).
  if (record.traktComplete) return true;
  if (record.seriesDone) return !total || total <= record.seriesDone;
  return Boolean(total && watchedEpisodes >= total);
}

/** "Continue watching": unfinished movies and series that still have something to watch, newest first. */
export async function continueWatching(ctx, { providerId, limit = 20 } = {}) {
  const recent = await ctx.watch.recent({ providerId, limit: limit * 3 + 20, onlyUnfinished: true });
  if (!recent.some((r) => r.type === 'series')) return recent.slice(0, limit);
  const summaries = summarizeWatch(await ctx.watch.all());
  const result = [];
  for (const rec of recent) {
    if (rec.type === 'series') {
      const tmdbId = /^series:t(\d+)$/.exec(rec.entryKey);
      let total = null;
      if (tmdbId && ctx.tmdb) {
        const meta = await ctx.tmdb.getMeta('series', Number(tmdbId[1])).catch(() => null);
        total = meta && meta.episodes ? meta.episodes : null;
      }
      const summary = summaries.get(watchKey(rec.providerId, rec.entryKey));
      if (isSeriesFinished(rec, summary ? summary.watchedEpisodes : 0, total)) continue;
    }
    result.push(rec);
    if (result.length >= limit) break;
  }
  return result;
}
