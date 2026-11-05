import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { runRebuild, startRebuild } from '../../src/services/catalogRebuild.js';
import { dbGetAllKeys, dbPutMany } from '../../src/core/idb.js';

const item = (id, categoryId = '1') => ({ key: `movie:${id}`, type: 'movie', id, name: `Film ${id} (2001)`, categoryId, added: 100 + id, tmdbId: null, ext: 'mkv', genre: '' });

async function setup() {
  const name = `rebuild-${Math.random()}`;
  const db = await openProviderDb(name);
  await dbPutMany(db, 'items', [item(1), item(2, '2'), item(3)]);
  return { db, name };
}

test('rebuilds the entries from the stored items, without the hidden categories', async () => {
  const { db } = await setup();
  const counts = await runRebuild({ db, types: ['movie'], excluded: { movie: ['2'] } });
  expect(counts).toEqual({ movie: 2 });
  expect(await dbGetAllKeys(db, 'entries')).toHaveLength(2);
});

test('without a worker it runs on the main thread; with one it asks the worker', async () => {
  const { db } = await setup();
  const local = startRebuild({ db, types: ['movie'] });
  expect(await local.promise).toEqual({ movie: 3 });

  const posted = [];
  const fake = {
    postMessage: (m) => {
      posted.push(m);
      setTimeout(() => fake.onmessage({ data: { event: 'rebuilt', counts: { movie: 7 } } }), 0);
    },
    terminate: jest.fn(),
  };
  const handle = startRebuild({ providerId: 'p', types: ['movie'] }, { createWorker: () => { setTimeout(() => fake.onmessage({ data: { event: 'ready' } }), 0); return fake; } });
  expect(await handle.promise).toEqual({ movie: 7 });
  expect(posted[0]).toMatchObject({ op: 'rebuild', providerId: 'p', types: ['movie'] });
  expect(fake.terminate).toHaveBeenCalled();
});

test('a worker that cannot be made falls back to the main thread; cancel ends a worker run', async () => {
  const { db } = await setup();
  const fallback = startRebuild({ db, types: ['movie'] }, { createWorker: () => { throw new Error('no workers'); } });
  expect(await fallback.promise).toEqual({ movie: 3 });
  const silent = { postMessage: () => undefined, terminate: jest.fn() };
  const handle = startRebuild({ providerId: 'p', types: ['movie'] }, { createWorker: () => { setTimeout(() => silent.onmessage({ data: { event: 'ready' } }), 0); return silent; } });
  setTimeout(() => handle.cancel(), 5);
  expect(await handle.promise).toBeNull();
});
