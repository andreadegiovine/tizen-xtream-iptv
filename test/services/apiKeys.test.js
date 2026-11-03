import { openAppDb } from '../../src/db/appDb.js';
import { createApiKeys } from '../../src/services/apiKeys.js';
import { scrubTarget, positionFromPointer } from '../../src/services/playerController.js';

let n = 0;
const db = () => openAppDb(`apikeys-test-${(n += 1)}`);

describe('api keys', () => {
  test('typed values win over build defaults and persist; clearing restores the default', async () => {
    const d = await db();
    const keys = createApiKeys({ db: d, defaults: { tmdbKey: 'build' } });
    expect((await keys.load()).tmdbKey).toBe('build');
    await keys.set({ tmdbKey: '  mine ', traktId: 'id' });
    expect(keys.get()).toMatchObject({ tmdbKey: 'mine', traktId: 'id', traktSecret: '' });
    const again = createApiKeys({ db: d, defaults: { tmdbKey: 'build' } });
    expect((await again.load()).tmdbKey).toBe('mine');
    await again.set({ tmdbKey: '' });
    expect(again.get().tmdbKey).toBe('build');
    expect(again.getStored('tmdbKey')).toBe('');
  });
});

describe('progress bar helpers', () => {
  test('scrub is clamped to the stream', () => {
    expect(scrubTarget(10, -30, 100)).toBe(0);
    expect(scrubTarget(90, 30, 100)).toBe(100);
    expect(scrubTarget(50, 30, 100)).toBe(80);
  });
  test('pointer maps to a position', () => {
    expect(positionFromPointer(150, 100, 200, 1000)).toBe(250);
    expect(positionFromPointer(0, 100, 200, 1000)).toBe(0);
    expect(positionFromPointer(999, 100, 200, 1000)).toBe(1000);
    expect(positionFromPointer(150, 100, 0, 1000)).toBe(0);
  });
});
