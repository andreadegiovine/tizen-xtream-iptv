import { openAppDb } from '../../src/db/appDb.js';
import { createOperations } from '../../src/services/operations.js';
import { createSyncLog } from '../../src/services/syncLog.js';

describe('operations registry', () => {
  test('lists running operations with their start time and notifies on changes', () => {
    let clock = 1000;
    const ops = createOperations({ now: () => (clock += 1) });
    const seen = [];
    ops.onChange((list) => seen.push(list.map((o) => o.id)));
    const endA = ops.start('catalog');
    ops.start('genres');
    expect(ops.list().map((o) => o.id)).toEqual(['catalog', 'genres']);
    expect(ops.list()[0].startedAt).toBe(1001);
    endA();
    expect(ops.list().map((o) => o.id)).toEqual(['genres']);
    expect(seen).toEqual([['catalog'], ['catalog', 'genres'], ['genres']]);
  });

  test('cancel calls the stop handler and removes the entry', () => {
    const ops = createOperations();
    const cancel = jest.fn();
    ops.start('epg', { cancel });
    expect(ops.cancel('epg')).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(ops.list()).toEqual([]);
    expect(ops.cancel('epg')).toBe(false);
  });

  test('a tracked job is listed while it runs and gets an abort signal when stopped', async () => {
    const operations = createOperations();
    const log = createSyncLog({ db: await openAppDb('ops-test'), operations });
    let signal = null;
    let release = null;
    const run = log.track('tmdb', (s) => {
      signal = s;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    await Promise.resolve();
    expect(operations.list().map((o) => o.id)).toEqual(['tmdb']);
    operations.cancel('tmdb');
    expect(signal.aborted).toBe(true);
    release(3);
    await run;
    expect(operations.list()).toEqual([]);
  });
});
