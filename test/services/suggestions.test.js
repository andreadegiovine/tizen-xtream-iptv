import { rankCandidates, createSuggestionsService } from '../../src/services/suggestions.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPutMany } from '../../src/core/idb.js';

test('ranking: more seeds agreeing first, then popularity', () => {
  const ranked = rankCandidates([
    { type: 'movie', items: [{ id: 1, popularity: 5 }, { id: 2, popularity: 50 }] },
    { type: 'movie', items: [{ id: 1, popularity: 9 }, { id: 3, popularity: 1 }] },
  ]);
  expect(ranked.map((r) => r.id)).toEqual([1, 2, 3]);
});

describe('suggestions service', () => {
  const setup = async (name) => {
    const db = await openProviderDb(name);
    await dbPutMany(db, 'entries', [10, 11, 12].map((id) => ({ key: `movie:t${id}`, type: 'movie', added: id, name: `M${id}` })));
    return db;
  };

  test('intersects recommendations with the catalog, skipping watched titles', async () => {
    const db = await setup('sugg-1');
    const tmdb = { enabled: true, recommendations: jest.fn(async (type, id) => (id === 10 ? [{ id: 11, popularity: 1 }, { id: 99, popularity: 9 }, { id: 10, popularity: 2 }] : [])) };
    const svc = createSuggestionsService({ active: { get: async () => ({ db }) }, watch: { seeds: async () => [{ type: 'movie', tmdbId: 10 }], seenKeys: async () => new Set(['movie:t10']) }, tmdb });
    const result = await svc.build({ limit: 5 });
    expect(result.entries.map((e) => e.key)).toEqual(['movie:t11']); // 99 not in catalog, 10 already watched
    expect(result.source).toBe('history');
  });

  test('no history → trending', async () => {
    const db = await setup('sugg-2');
    const tmdb = { enabled: true, recommendations: jest.fn(async (type, id) => (id === null && type === 'movie' ? [{ id: 12, popularity: 3 }] : [])) };
    const svc = createSuggestionsService({ active: { get: async () => ({ db }) }, watch: { seeds: async () => [], seenKeys: async () => new Set(['movie:t11']) }, tmdb });
    const result = await svc.build();
    expect(result.entries.map((e) => e.key)).toEqual(['movie:t12']);
    expect(result.source).toBe('trending');
  });

  test('anything with a watch record is left out, not only the seeds', async () => {
    const db = await setup('sugg-3');
    const tmdb = { enabled: true, recommendations: jest.fn(async () => [{ id: 11, popularity: 5 }, { id: 12, popularity: 4 }]) };
    const watch = { seeds: async () => [{ type: 'movie', tmdbId: 10 }], seenKeys: async () => new Set(['movie:t10', 'movie:t11']) };
    const svc = createSuggestionsService({ active: { get: async () => ({ db }) }, watch, tmdb });
    expect((await svc.build({ limit: 5 })).entries.map((e) => e.key)).toEqual(['movie:t12']);
    expect((await svc.forEntry({ type: 'movie', key: 'movie:t10', tmdbId: 10 })).map((e) => e.key)).toEqual(['movie:t12']);
  });

  test('disabled without TMDB', async () => {
    const svc = createSuggestionsService({ active: {}, watch: {}, tmdb: { enabled: false } });
    expect(await svc.build()).toEqual({ entries: [], source: 'disabled' });
  });
});
