import { toggleId, flipRange } from '../../src/ui/pages/categoriesPage.js';
import { optionRow } from '../../src/ui/pages/settingsPage.js';

test('toggleId does not mutate and flips membership', () => {
  const a = new Set(['1']);
  const b = toggleId(a, '2');
  expect([...a]).toEqual(['1']);
  expect([...b].sort()).toEqual(['1', '2']);
  expect([...toggleId(b, '1')]).toEqual(['2']);
});

test('option row shows the value, saves the choice made in the list', async () => {
  const store = { gridItems: 24 };
  const ctx = {
    settings: { get: async () => ({ ...store }), update: async (patch) => Object.assign(store, patch) },
    dialogs: { choose: jest.fn(async ({ options, selected }) => { expect(selected).toBe(24); return options[2].value; }) },
  };
  const row = optionRow({ ctx, labelKey: 'settings.gridItems', key: 'gridItems', options: [12, 24, 36] });
  await row.refresh();
  expect(row.el.textContent).toContain('24');
  await row.activate();
  expect(store.gridItems).toBe(36);
  expect(row.el.textContent).toContain('36');
});

test('option row ignores a dismissed list', async () => {
  const update = jest.fn();
  const ctx = { settings: { get: async () => ({ bufferSeconds: 10 }), update }, dialogs: { choose: async () => null } };
  await optionRow({ ctx, labelKey: 'settings.buffer', key: 'bufferSeconds', options: [2, 5, 10] }).activate();
  expect(update).not.toHaveBeenCalled();
});

test('flipRange flips the ids between two rows against the base, in either order', () => {
  const base = new Set(['b']);
  expect([...flipRange(base, ['a', 'b', 'c', 'd'], 0, 2)].sort()).toEqual(['a', 'c']);
  expect([...flipRange(base, ['a', 'b', 'c', 'd'], 2, 0)].sort()).toEqual(['a', 'c']);
  expect([...base]).toEqual(['b']);
});
