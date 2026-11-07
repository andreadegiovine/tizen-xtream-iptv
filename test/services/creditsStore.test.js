import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/db/appDb.js';
import { createCreditsStore } from '../../src/services/creditsStore.js';

test('credits start per series: shared key for every provider, own key only for its provider; kept after reopening', async () => {
  const db = await openAppDb('credits-test');
  const store = createCreditsStore({ db });
  expect(await store.get('p1', 'series:t1396')).toBeNull();
  await store.set('p1', 'series:t1396', 95.4);
  await store.set('p1', 'series:i7', 60);
  expect(await store.get('p2', 'series:t1396')).toBe(95); // same series in another provider
  expect(await store.get('p2', 'series:i7')).toBeNull(); // another provider's own number
  expect(await createCreditsStore({ db }).get('p1', 'series:i7')).toBe(60);
  await store.remove('p2', 'series:t1396');
  expect(await createCreditsStore({ db }).get('p1', 'series:t1396')).toBeNull();
});
