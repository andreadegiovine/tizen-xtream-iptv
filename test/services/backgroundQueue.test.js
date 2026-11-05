import { createBackgroundQueue, Priority } from '../../src/services/backgroundQueue.js';

test('runs by priority, one at a time', async () => {
  const q = createBackgroundQueue();
  const order = [];
  q.block();
  q.add({ name: 'search', priority: Priority.SEARCH, run: async () => order.push('search') });
  q.add({ name: 'cards', priority: Priority.VISIBLE, run: async () => order.push('cards') });
  q.add({ name: 'sidebar', priority: Priority.SIDEBAR, run: async () => order.push('sidebar') });
  q.unblock();
  await q.idle();
  expect(order).toEqual(['cards', 'sidebar', 'search']);
});

test('a block holds the queue and a name is not queued twice', async () => {
  const q = createBackgroundQueue();
  const seen = [];
  q.block();
  q.add({ name: 'a', priority: 2, run: async () => seen.push(1) });
  q.add({ name: 'a', priority: 2, run: async () => seen.push(2) });
  await Promise.resolve();
  expect(seen).toEqual([]);
  q.unblock();
  await q.idle();
  expect(seen).toEqual([2]);
});

test('promote runs a task first and a failing task does not stop the queue', async () => {
  const errors = [];
  const q = createBackgroundQueue({ onError: (name) => errors.push(name) });
  const order = [];
  q.block();
  q.add({ name: 'trakt', priority: Priority.TRAKT, run: async () => order.push('trakt') });
  q.add({ name: 'search', priority: Priority.SEARCH, run: async () => { order.push('search'); } });
  q.add({ name: 'bad', priority: Priority.METADATA, run: async () => { throw new Error('x'); } });
  q.promote('search');
  q.unblock();
  await q.idle();
  expect(order).toEqual(['search', 'trakt']);
  expect(errors).toEqual(['bad']);
});
