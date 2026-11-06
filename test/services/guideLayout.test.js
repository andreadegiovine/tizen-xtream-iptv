import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { openAppDb } from '../../src/db/appDb.js';
import { createGuideLayoutStore, readGuideLayout, saveGuideLayout, applyGuideLayout, moveInLayout, hideInLayout } from '../../src/services/guideLayout.js';

const rows = ['a', 'b', 'c', 'd'].map((key) => ({ key }));

test('removed rows go, moved rows keep their place, new rows follow', async () => {
  const db = await openProviderDb(`layout-${Math.random()}`);
  let layout = await readGuideLayout(db);
  expect(applyGuideLayout(rows, layout).map((r) => r.key)).toEqual(['a', 'b', 'c', 'd']);
  const moved = moveInLayout(rows, layout, 'c', -1);
  expect(moved.row).toBe(1);
  layout = hideInLayout(moved.layout, 'a');
  await saveGuideLayout(db, layout);
  const saved = await readGuideLayout(db);
  expect(applyGuideLayout(rows.concat([{ key: 'e' }]), saved).map((r) => r.key)).toEqual(['c', 'b', 'd', 'e']);
  expect(moveInLayout(rows, layout, 'a', -1)).toBeNull(); // the first one cannot go up
});

test('the shared guide layout: portable keys keep one place for every provider, own channels are per provider', async () => {
  const db = await openAppDb(`layout-shared-${Math.random()}`);
  const store = createGuideLayoutStore({ db });
  await store.save('p1', { order: ['live:ga', 'live:i1', 'live:gb'], hidden: ['live:gz', 'live:i9'] });
  expect(await store.read('p2')).toEqual({ order: ['live:ga', 'live:gb'], hidden: ['live:gz'] }); // p1's own channels are not p2's
  await store.save('p2', { order: ['live:i1', 'live:gb', 'live:ga'], hidden: [] }); // p2 has its own channel 1 and puts gb first
  expect(await store.read('p1')).toEqual({ order: ['live:i1', 'live:gb', 'live:ga'], hidden: ['live:i9'] }); // the shared groups follow p2's order; p1's own channel keeps its slot
  const p2 = await store.read('p2');
  expect(p2.order).toEqual(['live:i1', 'live:gb', 'live:ga']);
});

test('the old per-provider layout is added once to the shared one', async () => {
  const db = await openAppDb(`layout-old-${Math.random()}`);
  const providerDb = await openProviderDb(`layout-old-p-${Math.random()}`);
  await saveGuideLayout(providerDb, { order: ['live:gb', 'live:i3'], hidden: ['live:gz'] });
  const store = createGuideLayoutStore({ db });
  await store.save('p2', { order: ['live:ga'], hidden: [] });
  expect(await store.read('p1', providerDb)).toEqual({ order: ['live:ga', 'live:gb', 'live:i3'], hidden: ['live:gz'] });
  await saveGuideLayout(providerDb, { order: ['live:gx'], hidden: [] }); // read once: a later change of the old copy is ignored
  expect((await store.read('p1', providerDb)).order).toEqual(['live:ga', 'live:gb', 'live:i3']);
});
