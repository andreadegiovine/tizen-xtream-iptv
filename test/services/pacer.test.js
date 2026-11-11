import { createPacer } from '../../src/services/pacer.js';

const fakeClock = () => {
  let t = 0;
  return { now: () => t, advance: (ms) => (t += ms), wait: async () => undefined };
};

test('grows while the answers come back fine, never above max', async () => {
  const clock = fakeClock();
  const pace = createPacer({ start: 2, max: 4, growEvery: 3, now: clock.now, wait: clock.wait });
  for (let i = 0; i < 20; i += 1) await pace.run(async () => clock.advance(100));
  expect(pace.state().limit).toBe(4);
  expect(pace.state().delay).toBe(0);
});

test('a failure halves how many go at a time and adds a pause, doubled at each problem; fine answers shorten it again', async () => {
  const clock = fakeClock();
  const waits = [];
  const pace = createPacer({ start: 4, max: 8, firstDelayMs: 500, maxDelayMs: 4000, now: clock.now, wait: async (ms) => waits.push(ms) });
  await expect(pace.run(async () => { throw new Error('429'); })).rejects.toThrow('429');
  expect(pace.state()).toMatchObject({ limit: 2, delay: 500 });
  await expect(pace.run(async () => { throw new Error('429'); })).rejects.toThrow('429');
  expect(pace.state()).toMatchObject({ limit: 1, delay: 1000 });
  await pace.run(async () => clock.advance(100));
  expect(waits).toEqual([500, 1000]);
  expect(pace.state().delay).toBe(500);
  await pace.run(async () => clock.advance(100));
  expect(pace.state().delay).toBe(0);
});

test('an answer much slower than usual slows down too; never more at a time than allowed', async () => {
  const clock = fakeClock();
  const pace = createPacer({ start: 3, max: 3, slowFactor: 3, now: clock.now, wait: clock.wait });
  for (let i = 0; i < 5; i += 1) await pace.run(async () => clock.advance(400));
  await pace.run(async () => clock.advance(5000)); // more than 3 times the average and over a second
  expect(pace.state().limit).toBe(1);
  let peak = 0;
  let running = 0;
  const job = () => pace.run(async () => { running += 1; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running -= 1; });
  await Promise.all([job(), job(), job(), job()]);
  expect(peak).toBe(1);
});
