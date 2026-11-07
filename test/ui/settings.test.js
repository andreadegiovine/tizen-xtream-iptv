import { toggleId, flipRange } from '../../src/ui/pages/categoriesPage.js';
import { optionRow, textRow } from '../../src/ui/pages/settingsPage.js';

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
    notices: { success: jest.fn() },
    dialogs: { choose: jest.fn(async ({ options, selected }) => { expect(selected).toBe(24); return options[2].value; }) },
  };
  const row = optionRow({ ctx, labelKey: 'settings.gridItems', key: 'gridItems', options: [12, 24, 36] });
  await row.refresh();
  expect(row.el.textContent).toContain('24');
  await row.activate();
  expect(store.gridItems).toBe(36);
  expect(row.el.textContent).toContain('36');
  expect(ctx.notices.success).toHaveBeenCalledTimes(1);
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

test('h(): nested arrays of nodes are appended as elements, never printed as "[object HTMLDivElement]"', () => {
  const { h } = require('../../src/ui/dom.js');
  const el = h('div', {}, [[h('h2', { text: 'a' }), null, h('div', { text: 'b' })], [h('h2', { text: 'c' })]]);
  expect(el.children).toHaveLength(3);
  expect(el.textContent).toBe('abc');
  expect(el.textContent).not.toContain('object');
});

test('text row: its x is a row at its right; OK on it empties the field and opens the keyboard', async () => {
  const ctx = { apiKeys: { getStored: () => 'secret-key', set: jest.fn(async () => undefined) }, notices: { success() {} }, router: { reload() {} } };
  const row = textRow({ ctx, label: 'TMDB', field: 'tmdbKey' });
  await row.refresh();
  document.body.appendChild(row.root);
  const input = row.root.querySelector('input');
  expect(input.value).toBe('secret-key');
  expect(row.clearRow.secondary).toBe('right');
  expect(row.root.contains(row.clearRow.el)).toBe(true);
  await row.clearRow.activate();
  expect(input.value).toBe('');
  expect(document.activeElement).toBe(input);
  row.root.remove();
});
