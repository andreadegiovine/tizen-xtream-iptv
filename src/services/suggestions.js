import { getEntry } from './catalogQuery.js';

const TYPES = ['movie', 'series'];

/** Merges recommendation lists: a title recommended by several seeds ranks higher, popularity breaks ties. */
export function rankCandidates(lists) {
  const scores = new Map();
  for (const { type, items } of lists) {
    for (const item of items) {
      const key = `${type}:${item.id}`;
      const current = scores.get(key) || { type, id: item.id, score: 0, popularity: 0 };
      current.score += 1;
      current.popularity = Math.max(current.popularity, item.popularity || 0);
      scores.set(key, current);
    }
  }
  return Array.from(scores.values()).sort((a, b) => b.score - a.score || b.popularity - a.popularity);
}

/**
 * "Suggestions": TMDB recommendations for what was watched recently (trending as the fallback),
 * kept only when the provider catalog has the title (same tmdb id) and it has not been watched yet.
 */
export function createSuggestionsService({ active, watch, tmdb, seedCount = 6 }) {
  async function inCatalog(db, candidates, exclude, limit) {
    const out = [];
    for (const candidate of candidates) {
      if (out.length >= limit) break;
      const key = `${candidate.type}:t${candidate.id}`;
      if (exclude.has(key)) continue;
      const entry = await getEntry(db, key);
      if (entry) out.push(entry);
    }
    return out;
  }

  return {
    enabled: tmdb.enabled,
    async build({ limit = 36 } = {}) {
      if (!tmdb.enabled) return { entries: [], source: 'disabled' };
      const current = await active.get();
      if (!current) return { entries: [], source: 'none' };
      const seeds = await watch.seeds(seedCount);
      const exclude = new Set(seeds.map((s) => `${s.type}:t${s.tmdbId}`));
      const lists = [];
      for (const seed of seeds) lists.push({ type: seed.type, items: await tmdb.recommendations(seed.type, seed.tmdbId).catch(() => []) });
      let entries = await inCatalog(current.db, rankCandidates(lists), exclude, limit);
      let source = seeds.length ? 'history' : 'trending';
      if (entries.length < Math.min(12, limit)) {
        const trending = [];
        for (const type of TYPES) trending.push({ type, items: await tmdb.recommendations(type, null).catch(() => []) });
        const seen = new Set(entries.map((e) => e.key));
        const more = await inCatalog(current.db, rankCandidates(trending), new Set([...exclude, ...seen]), limit - entries.length);
        entries = entries.concat(more);
        if (!seeds.length || !entries.length) source = 'trending';
      }
      return { entries, source };
    },
  };
}
