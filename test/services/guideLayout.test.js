import 'fake-indexeddb/auto';
import { openProviderDb } from '../../src/db/providerDb.js';
import { readGuideLayout, saveGuideLayout, applyGuideLayout, moveInLayout, hideInLayout } from '../../src/services/guideLayout.js';

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
