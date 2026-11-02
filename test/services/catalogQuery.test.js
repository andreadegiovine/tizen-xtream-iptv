import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPutMany } from '../../src/core/idb.js';
import { writeEntries } from '../../src/services/catalogSync.js';
import { buildEntries } from '../../src/services/grouping.js';
import { listCategories, pageEntries } from '../../src/services/catalogQuery.js';

let counter = 0;

async function seed() {
  const db = await openProviderDb(`query-test-${(counter += 1)}`);
  const items = [];
  for (let id = 1; id <= 25; id += 1) {
    items.push({ key: `movie:${id}`, type: 'movie', id, name: `Film ${id}`, categoryId: id % 2 ? '1' : '2', added: 1000 + id, tmdbId: null, ext: 'mkv' });
  }
  await writeEntries(db, 'movie', buildEntries('movie', items));
  await dbPutMany(db, 'categories', [
    { key: 'movie:2', type: 'movie', id: '2', name: 'Zeta' },
    { key: 'movie:1', type: 'movie', id: '1', name: 'Azione' },
    { key: 'series:9', type: 'series', id: '9', name: 'Other type' },
  ]);
  return db;
}

describe('catalogQuery', () => {
  test('categories of one type, alphabetical', async () => {
    const db = await seed();
    expect((await listCategories(db, 'movie')).map((c) => c.name)).toEqual(['Azione', 'Zeta']);
  });

  test('pages "all" newest first and reports whether more exist', async () => {
    const db = await seed();
    const first = await pageEntries(db, { type: 'movie', offset: 0, limit: 10 });
    expect(first.entries.map((e) => e.defaultId)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
    expect(first.hasMore).toBe(true);
    const last = await pageEntries(db, { type: 'movie', offset: 20, limit: 10 });
    expect(last.entries.map((e) => e.defaultId)).toEqual([5, 4, 3, 2, 1]);
    expect(last.hasMore).toBe(false);
  });

  test('pages one category, joining the entries', async () => {
    const db = await seed();
    const page = await pageEntries(db, { type: 'movie', categoryId: '1', offset: 0, limit: 5 });
    expect(page.entries.map((e) => e.defaultId)).toEqual([25, 23, 21, 19, 17]);
    expect(page.hasMore).toBe(true);
    const rest = await pageEntries(db, { type: 'movie', categoryId: '1', offset: 10, limit: 5 });
    expect(rest.entries.map((e) => e.defaultId)).toEqual([5, 3, 1]);
    expect(rest.hasMore).toBe(false);
  });

  test('an exactly-full last page has no next page', async () => {
    const db = await seed();
    const page = await pageEntries(db, { type: 'movie', offset: 15, limit: 10 });
    expect(page.entries).toHaveLength(10);
    expect(page.hasMore).toBe(false);
  });

  test('empty type gives an empty page', async () => {
    const db = await seed();
    expect(await pageEntries(db, { type: 'series', offset: 0, limit: 10 })).toEqual({ entries: [], hasMore: false });
  });
});
