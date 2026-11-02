import { buildCells, hostOf, ProviderAction } from '../../src/ui/pages/providersPage.js';
import { GridModel } from '../../src/ui/focus/models.js';

const providers = [
  { id: 'a', name: 'A', baseUrl: 'http://one.example:8080', username: 'u' },
  { id: 'b', name: 'B', baseUrl: 'https://two.example/path', username: 'v' },
];

describe('providers list', () => {
  test('three action cells per provider then "add"', () => {
    const cells = buildCells(providers, 'b');
    expect(cells.map((c) => c.action)).toEqual([
      ProviderAction.USE, ProviderAction.EDIT, ProviderAction.REMOVE,
      ProviderAction.USE, ProviderAction.EDIT, ProviderAction.REMOVE,
      ProviderAction.ADD,
    ]);
  });

  test('only the active provider has its "use" cell disabled', () => {
    const cells = buildCells(providers, 'b');
    expect(cells[0].disabled).toBe(false);
    expect(cells[3].disabled).toBe(true);
  });

  test('with no provider only "add" remains', () => {
    expect(buildCells([], null)).toEqual([{ action: ProviderAction.ADD }]);
  });

  test('grid navigation reaches "add" from any row and comes back', () => {
    const model = new GridModel({ columns: 3, getCount: () => 7 });
    expect(model.navigate('down', 4)).toEqual({ type: 'move', index: 6 });
    expect(model.navigate('up', 6)).toEqual({ type: 'move', index: 3 });
    expect(model.navigate('right', 6)).toEqual({ type: 'exit', dir: 'right' });
  });

  test('hostOf hides scheme, path and credentials', () => {
    expect(hostOf('http://one.example:8080')).toBe('one.example:8080');
    expect(hostOf('https://two.example/path')).toBe('two.example');
  });
});
