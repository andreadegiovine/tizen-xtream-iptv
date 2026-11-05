import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { writeEntries } from '../../src/services/catalogSync.js';
import { buildEntries } from '../../src/services/grouping.js';
import { dbGetAll } from '../../src/core/idb.js';
import { markUnavailable, unavailableKeys, isEmptySeries, UNAVAILABLE_TTL_MS } from '../../src/services/unavailable.js';

const series = (id, genre = 'Dramma') => ({ key: `series:${id}`, type: 'series', id, name: `S ${id}`, categoryId: '1', added: 100 + id, tmdbId: null, ext: '', genre });

test('a series without episodes leaves the catalog and the next syncs leave it out for a while', async () => {
  const db = await openProviderDb(`unavailable-${Math.random()}`);
  await writeEntries(db, 'series', buildEntries('series', [series(1), series(2)]));
  await markUnavailable(db, 'series:i1', 1000);
  expect((await dbGetAll(db, 'entries')).map((e) => e.key)).toEqual(['series:i2']);
  expect((await dbGetAll(db, 'entry_cat')).every((r) => !r.key.startsWith('series:i1|'))).toBe(true);
  expect((await dbGetAll(db, 'entry_genre')).every((r) => !r.key.startsWith('series:i1|'))).toBe(true);
  expect(await unavailableKeys(db, 2000)).toEqual(new Set(['series:i1']));
  expect(await unavailableKeys(db, 1000 + UNAVAILABLE_TTL_MS)).toEqual(new Set()); // listed again after a week
  await markUnavailable(db, 'series:i2'); // now
  await writeEntries(db, 'series', buildEntries('series', [series(1), series(2)])); // a sync: the provider still lists both
  expect((await dbGetAll(db, 'entries')).map((e) => e.key)).toEqual(['series:i1']); // the old mark expired, the new one holds
});

test('only a series whose details came back with no episode counts as not served', () => {
  expect(isEmptySeries({ type: 'series' }, { seasons: [], episodeCount: 0 })).toBe(true);
  expect(isEmptySeries({ type: 'series' }, { seasons: [{}], episodeCount: 3 })).toBe(false);
  expect(isEmptySeries({ type: 'series' }, {})).toBe(false); // details not read (network): nothing decided
  expect(isEmptySeries({ type: 'movie' }, { seasons: [], episodeCount: 0 })).toBe(false);
});
