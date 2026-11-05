import { createJobQueue } from '../../src/services/jobQueue.js';
import { createOperations } from '../../src/services/operations.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('jobs asked while something runs are listed as queued and run one at a time, in order', async () => {
  const operations = createOperations();
  let busy = true;
  const order = [];
  let release;
  const queue = createJobQueue({ operations, isBusy: () => busy, wait: () => tick() });
  queue.add('catalog:movie', 'Catalog · Movies', async () => {
    order.push('movie');
    await new Promise((resolve) => { release = resolve; });
  });
  expect(queue.add('tmdb', 'TMDB', async () => order.push('tmdb'))).toBe(true);
  expect(queue.add('tmdb', 'TMDB', async () => order.push('again'))).toBe(false); // the same job stays one
  expect(operations.list().map((op) => [op.id, op.queued, op.label])).toEqual([
    ['queue:catalog:movie', true, 'Catalog · Movies'],
    ['queue:tmdb', true, 'TMDB'],
  ]);
  await tick();
  expect(order).toEqual([]); // something else runs: everything waits
  busy = false;
  await tick();
  await tick();
  expect(order).toEqual(['movie']);
  expect(operations.list().map((op) => op.id)).toEqual(['queue:tmdb']);
  release();
  await tick();
  await tick();
  expect(order).toEqual(['movie', 'tmdb']);
  expect(operations.list()).toEqual([]);
});

test('a queued job removed from the operations does not run', async () => {
  const operations = createOperations();
  let busy = true;
  const ran = [];
  const queue = createJobQueue({ operations, isBusy: () => busy, wait: () => tick() });
  queue.add('genres', 'Genres', async () => ran.push('genres'));
  operations.cancel('queue:genres');
  busy = false;
  await tick();
  await tick();
  expect(ran).toEqual([]);
  expect(queue.pending()).toEqual([]);
});
