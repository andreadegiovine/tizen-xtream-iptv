/**
 * @jest-environment node
 */
import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPutMany } from '../../src/core/idb.js';

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const H = 3600000;

test('search worker: programme titles read and searched there, merge candidates from its rows, forget after a new guide', async () => {
  const db = await openProviderDb('worker-p1');
  await dbPutMany(db, 'entries', [
    { key: 'live:i1', type: 'live', added: 1, name: 'Rai 1', epgChannelId: 'a', defaultId: 1, members: [{ id: 1 }] },
    { key: 'live:i2', type: 'live', added: 2, name: 'Rai 2', epgChannelId: 'b', defaultId: 2, members: [{ id: 2 }] },
  ]);
  await dbPutMany(db, 'epg', [{ channelId: 'a', start: NOW - H, stop: NOW + H, title: 'Telegiornale' }]);
  db.close();

  const sent = [];
  global.self = { postMessage: (m) => sent.push(m) };
  jest.isolateModules(() => require('../../src/workers/search.worker.js'));
  const ask = async (message) => {
    const before = sent.length;
    await global.self.onmessage({ data: message });
    return sent.slice(before);
  };
  expect(sent[0]).toEqual({ event: 'started' });

  expect(await ask({ op: 'programmes-load', providerId: 'worker-p1', now: NOW, token: 1 })).toEqual([expect.objectContaining({ event: 'programmes-ready', token: 1, count: 1 })]);
  const [found] = await ask({ op: 'programmes-search', id: 7, providerId: 'worker-p1', query: 'telegiornale', options: { limit: 5, now: NOW } });
  expect(found).toMatchObject({ event: 'result', id: 7, rows: [{ title: 'Telegiornale', rowKey: 'live:i1' }] });

  // A new guide: the worker reads the titles again.
  const again = await openProviderDb('worker-p1');
  await dbPutMany(again, 'epg', [{ channelId: 'b', start: NOW, stop: NOW + H, title: 'Telegiornale sera' }]);
  again.close();
  await ask({ op: 'programmes-forget' });
  const [second] = await ask({ op: 'programmes-search', id: 8, providerId: 'worker-p1', query: 'telegiornale', options: { limit: 5, now: NOW } });
  expect(second.rows.map((r) => r.rowKey)).toEqual(['live:i1', 'live:i2']);

  // Merge candidates come from the rows loaded for the catalog search (the channel being merged left out).
  expect(await ask({ op: 'load', providerId: 'worker-p1', types: ['live'], token: 2 })).toEqual([expect.objectContaining({ event: 'ready', token: 2, count: 2 })]);
  const [merge] = await ask({ op: 'merge', id: 9, query: '', options: { limit: 10, skipId: 1 } });
  expect(merge.rows).toEqual([{ key: 'live:i2', name: 'Rai 2', icon: undefined, group: false, memberId: 2, count: 1 }]);
  delete global.self;
});
