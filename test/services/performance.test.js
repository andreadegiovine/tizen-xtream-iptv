import { createPageCache } from '../../src/services/pageCache.js';
import { createSearchService } from '../../src/services/searchIndex.js';
import { createSearchHistory, HISTORY_MAX } from '../../src/services/searchHistory.js';
import { watchConnectivity } from '../../src/core/connectivity.js';
import { projectItem } from '../../src/services/itemProjector.js';
import { buildEntries } from '../../src/services/grouping.js';
import { createParentalService } from '../../src/services/parental.js';
import { openAppDb } from '../../src/db/appDb.js';

test('page cache: stores until cleared; suspended it reads and stores nothing', () => {
  const cache = createPageCache();
  cache.set('a', { n: 1 });
  expect(cache.get('a')).toEqual({ n: 1 });
  cache.suspend(true);
  expect(cache.get('a')).toBeNull();
  cache.set('b', 2);
  cache.suspend(false);
  expect(cache.get('b')).toBeNull(); // nothing is stored while the catalog changes
  cache.set('c', 3);
  cache.clear();
  expect(cache.size()).toBe(0);
});

test('page cache: past the limit the least recently used entry goes', () => {
  const cache = createPageCache({ limit: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  expect(cache.get('a')).toBe(1); // a is now the most recent
  cache.set('c', 3);
  expect(cache.get('b')).toBeNull();
  expect(cache.get('a')).toBe(1);
  expect(cache.get('c')).toBe(3);
  expect(cache.size()).toBe(2);
});

test('search history: 10 at most, newest first, no duplicates, short texts ignored', async () => {
  const history = createSearchHistory({ db: await openAppDb('history-test') });
  for (let i = 0; i < 12; i += 1) await history.add(`film ${i}`);
  await history.add('FILM 5'); // the same search (any case) moves to the top
  await history.add('a');
  const list = await history.list();
  expect(list).toHaveLength(HISTORY_MAX);
  expect(list[0]).toBe('FILM 5');
  expect(list.filter((x) => x.toLowerCase() === 'film 5')).toHaveLength(1);
  await history.clear();
  expect(await history.list()).toEqual([]);
});

class FakeWorker {
  constructor(rows) {
    this.rows = rows;
    this.sent = [];
  }
  postMessage(message) {
    this.sent.push(message);
    setTimeout(() => {
      if (message.op === 'load') this.onmessage({ data: { event: 'ready', token: message.token } });
      else if (message.op === 'search') this.onmessage({ data: { event: 'result', id: message.id, rows: this.rows } });
    }, 0);
  }
  terminate() {}
}

test('search service: the worker loads the index once (warm) and answers every search; invalidate reloads', async () => {
  const worker = new FakeWorker([{ key: 'movie:t1', type: 'movie' }, { key: 'live:n1', type: 'live', isNetwork: true }]);
  const active = { get: async () => ({ provider: { id: 'p' }, db: null }) };
  const service = createSearchService({ active, createWorker: () => worker });
  await service.warm();
  expect(worker.sent.filter((m) => m.op === 'load')).toHaveLength(1);
  const found = await service.search('heat', { limit: 5 });
  expect(found.map((r) => r.type)).toEqual(['movie', 'live']); // several kinds of entity come back
  expect(worker.sent.filter((m) => m.op === 'load')).toHaveLength(1); // no second load
  service.invalidate();
  await service.search('heat');
  expect(worker.sent.filter((m) => m.op === 'load')).toHaveLength(2);
});

test('search service: a worker that cannot be created falls back to the page', async () => {
  const active = { get: async () => null };
  const service = createSearchService({ active, createWorker: () => { throw new Error('no workers'); } });
  expect(await service.search('heat')).toEqual([]);
  await service.warm();
});

test('connectivity: reports offline at start, then every change', () => {
  const listeners = {};
  const win = { navigator: { onLine: false }, addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener: jest.fn() };
  const seen = [];
  const stop = watchConnectivity({ win, onChange: (online) => seen.push(online) });
  listeners.online();
  listeners.offline();
  expect(seen).toEqual([false, true, false]);
  stop();
  expect(win.removeEventListener).toHaveBeenCalledTimes(2);
});

test('adult flag from the provider: kept on the item, the entry and checked first', () => {
  expect(projectItem('movie', { stream_id: 1, name: 'A', is_adult: '1' }).adult).toBe(true);
  expect(projectItem('movie', { stream_id: 2, name: 'B', is_adult: '0' }).adult).toBeUndefined();
  const items = [projectItem('movie', { stream_id: 1, name: 'A', is_adult: 1 }), projectItem('movie', { stream_id: 2, name: 'B' })];
  const [a, b] = buildEntries('movie', items).sort((x, y) => x.defaultId - y.defaultId);
  expect(a.adult).toBe(true);
  expect(b.adult).toBeUndefined();
  const parental = createParentalService({ db: null });
  expect(parental.isAdult(a)).toBe(true); // no category needed
  expect(parental.isAdult(b)).toBe(false);
});
