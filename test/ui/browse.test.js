import { createPagedGridModel, indexAfterPageChange, GRID_COLUMNS, PAGE_SIZE } from '../../src/ui/pages/browsePage.js';
import { summarizeType } from '../../src/ui/pages/homePage.js';

function model({ count = PAGE_SIZE, next = false, prev = false } = {}) {
  const changes = [];
  const m = createPagedGridModel({
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
    expect(indexAfterPageChange('next', 17, PAGE_SIZE)).toBe(17 % GRID_COLUMNS);
    expect(indexAfterPageChange('previous', 3, PAGE_SIZE)).toBe(2 * GRID_COLUMNS + 3);
  });
});

describe('home summary', () => {
  test('shows title count or "not synced"', () => {
    expect(summarizeType(null, 'en-US')).toBe('Not synced yet');
    expect(summarizeType({ entryCount: 12345 }, 'en-US')).toBe('12,345 titles');
  });
});
