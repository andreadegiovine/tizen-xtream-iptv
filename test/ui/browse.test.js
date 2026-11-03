import { createPagedGridModel, indexAfterPageChange, columnsFor } from '../../src/ui/pages/browsePage.js';

const GRID_COLUMNS = 6;
const PAGE_SIZE = 24;

function model({ count = PAGE_SIZE, next = false, prev = false } = {}) {
  const changes = [];
  const m = createPagedGridModel({
    columns: GRID_COLUMNS,
    getCount: () => count,
    hasNext: () => next,
    hasPrevious: () => prev,
    changePage: (direction, index) => changes.push([direction, index]),
  });
  return { m, changes };
}

describe('paged grid', () => {
  test('down from the last row changes page only when a next page exists', () => {
    const last = PAGE_SIZE - 1;
    let { m, changes } = model({ next: true });
    expect(m.navigate('down', last)).toEqual({ type: 'move', index: last });
    expect(changes).toEqual([['next', last]]);
    ({ m, changes } = model({ next: false }));
    expect(m.navigate('down', last)).toEqual({ type: 'exit', dir: 'down' });
    expect(changes).toEqual([]);
  });

  test('up from the first row goes to the previous page, or leaves the zone on page 0', () => {
    let { m, changes } = model({ prev: true });
    expect(m.navigate('up', 2)).toEqual({ type: 'move', index: 2 });
    expect(changes).toEqual([['previous', 2]]);
    ({ m, changes } = model({ prev: false }));
    expect(m.navigate('up', 2)).toEqual({ type: 'exit', dir: 'up' });
  });

  test('inside the page it is a normal grid', () => {
    const { m } = model({ next: true });
    expect(m.navigate('right', 0)).toEqual({ type: 'move', index: 1 });
    expect(m.navigate('down', 0)).toEqual({ type: 'move', index: GRID_COLUMNS });
    expect(m.navigate('left', 0)).toEqual({ type: 'exit', dir: 'left' });
  });

  test('landing index keeps the column', () => {
    expect(indexAfterPageChange('next', 17, PAGE_SIZE, GRID_COLUMNS)).toBe(17 % GRID_COLUMNS);
    expect(indexAfterPageChange('previous', 3, PAGE_SIZE, GRID_COLUMNS)).toBe(3 * GRID_COLUMNS + 3);
    expect(indexAfterPageChange('previous', 1, 12, 4)).toBe(2 * 4 + 1);
    expect(columnsFor('live')).toBe(6);
    expect(columnsFor('movie')).toBe(6);
  });
});

