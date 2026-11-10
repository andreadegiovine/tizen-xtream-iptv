import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/db/appDb.js';
import { createNavCounts } from '../../src/services/navCounts.js';

test('the last known numbers per provider are kept in the database and read back at the next start', async () => {
  const db = await openAppDb(`nav-${Math.random()}`);
  const first = createNavCounts({ db, saveDelayMs: 0 });
  await first.load();
  expect(first.get('p', 'top:favorites')).toBeUndefined();
  first.set('p', 'top:favorites', 3);
  first.set('p', 'movie:suggestions', 0);
  first.set('q', 'top:favorites', 1);
  first.set(null, 'top:favorites', 9); // no provider: nothing kept
  await new Promise((resolve) => setTimeout(resolve, 20));
  const next = createNavCounts({ db });
  await next.load();
  expect(next.get('p', 'top:favorites')).toBe(3);
  expect(next.get('p', 'movie:suggestions')).toBe(0);
  expect(next.get('q', 'top:favorites')).toBe(1);
  expect(next.get('x', 'top:favorites')).toBeUndefined();
});
