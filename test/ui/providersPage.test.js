import { buildCells, hostOf, ProviderAction } from '../../src/ui/pages/providersPage.js';
import { GridModel } from '../../src/ui/focus/models.js';

const providers = [
  { id: 'a', name: 'A', baseUrl: 'http://one.example:8080', username: 'u' },
  { id: 'b', name: 'B', baseUrl: 'https://two.example/path', username: 'v' },
];

describe('providers list', () => {
  test('four action cells per provider then "add"', () => {
    const cells = buildCells(providers, 'b');
    expect(cells.map((c) => c.action)).toEqual([
      ProviderAction.USE, ProviderAction.CATEGORIES, ProviderAction.EDIT, ProviderAction.REMOVE,
      ProviderAction.USE, ProviderAction.CATEGORIES, ProviderAction.EDIT, ProviderAction.REMOVE,
      ProviderAction.ADD,
    ]);
  });

  test('only the active provider has its "use" cell disabled', () => {
    const cells = buildCells(providers, 'b');
    expect(cells[0].disabled).toBe(false);
    expect(cells[4].disabled).toBe(true);
  });

  test('with no provider only "add" remains', () => {
    expect(buildCells([], null)).toEqual([{ action: ProviderAction.ADD }]);
  });

  test('grid navigation reaches "add" from any row and comes back', () => {
    const model = new GridModel({ columns: 4, getCount: () => 9 });
    expect(model.navigate('down', 5)).toEqual({ type: 'move', index: 8 });
    expect(model.navigate('up', 8)).toEqual({ type: 'move', index: 4 });
    expect(model.navigate('right', 8)).toEqual({ type: 'exit', dir: 'right' });
  });

  test('hostOf hides scheme, path and credentials', () => {
    expect(hostOf('http://one.example:8080')).toBe('one.example:8080');
    expect(hostOf('https://two.example/path')).toBe('two.example');
  });
});
