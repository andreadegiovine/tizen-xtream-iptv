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

export const SUGGESTION_SOURCES = ['tmdb', 'trakt'];

/**
 * "Suggestions": recommendations for what was watched recently (trending as the fallback), kept only when
 * the provider catalog has the title (same tmdb id) and it has not been watched yet.
 * The source is a setting (`getSource()` → 'tmdb' | 'trakt'); when the chosen one is not usable the other is tried.
 */
export function createSuggestionsService({ active, watch, tmdb, trakt = null, getSource = async () => 'tmdb', seedCount = 6 }) {
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

  /** Source to use: the preferred one if usable (Trakt for personal picks also needs a login), otherwise the other, otherwise null. */
  async function resolveSource({ needsLogin }) {
    const preferred = await getSource();
    const usable = {
      tmdb: Boolean(tmdb.enabled),
      trakt: Boolean(trakt && trakt.enabled && (!needsLogin || (await trakt.isConnected()))),
    };
    if (usable[preferred]) return preferred;
    const other = preferred === 'tmdb' ? 'trakt' : 'tmdb';
    return usable[other] ? other : null;
  }

  return {
    get enabled() {
      return Boolean(tmdb.enabled || (trakt && trakt.enabled));
    },
    resolveSource,
    async build({ limit = 36 } = {}) {
      const source = await resolveSource({ needsLogin: true });
      if (!source) return { entries: [], source: 'disabled' };
      const current = await active.get();
      if (!current) return { entries: [], source: 'none' };
      const seeds = await watch.seeds(seedCount);
      const exclude = new Set(seeds.map((s) => `${s.type}:t${s.tmdbId}`));
      if (source === 'trakt') {
        const entries = await inCatalog(current.db, rankCandidates(await trakt.recommendations().catch(() => [])), exclude, limit);
        if (entries.length || !tmdb.enabled) return { entries, source: 'trakt' };
      }
      const lists = [];
      for (const seed of seeds) lists.push({ type: seed.type, items: await tmdb.recommendations(seed.type, seed.tmdbId).catch(() => []) });
      let entries = await inCatalog(current.db, rankCandidates(lists), exclude, limit);
      let from = seeds.length ? 'history' : 'trending';
      if (entries.length < Math.min(12, limit)) {
        const trending = [];
        for (const type of TYPES) trending.push({ type, items: await tmdb.recommendations(type, null).catch(() => []) });
        const seen = new Set(entries.map((e) => e.key));
        const more = await inCatalog(current.db, rankCandidates(trending), new Set([...exclude, ...seen]), limit - entries.length);
        entries = entries.concat(more);
        if (!seeds.length || !entries.length) from = 'trending';
      }
      return { entries, source: from };
    },
    /** "You might also like" for one title: up to `limit` catalog entries related to it. */
    async forEntry(entry, { tmdbId = null, limit = 20 } = {}) {
      if (!entry || entry.type === 'live') return [];
      const id = tmdbId || entry.tmdbId;
      if (!id) return [];
      const source = await resolveSource({ needsLogin: false });
      if (!source) return [];
      const current = await active.get();
      if (!current) return [];
      const items = source === 'trakt' ? await trakt.related(entry.type, id).catch(() => []) : await tmdb.recommendations(entry.type, id).catch(() => []);
      return inCatalog(current.db, items.map((item) => ({ type: entry.type, id: item.id })), new Set([`${entry.type}:t${id}`, entry.key]), limit);
    },
  };
}
