import { createPagedGridModel, indexAfterPageChange, columnsFor, sidebarItems, indexOfFilter } from '../../src/ui/pages/browsePage.js';

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


describe('sidebar', () => {
  const labels = { all: 'Tutto', continue: 'Continua', favorites: 'Preferiti', suggestions: 'Suggerimenti', genres: 'Generi', categories: 'Categorie' };
  const cats = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }];

  test('movies: all, continue, favorites, suggestions, open genres group, collapsed categories toggle', () => {
    const items = sidebarItems({ type: 'movie', genres: [{ key: 'animation', name: 'Animazione' }], categories: cats, labels });
    expect(items.map((i) => i.kind)).toEqual(['all', 'continue', 'favorites', 'suggestions', 'genresToggle', 'genre', 'toggle']);
    expect(items[5].depth).toBe(1);
    const closed = sidebarItems({ type: 'movie', genres: [{ key: 'animation', name: 'Animazione' }], categories: cats, genresExpanded: false, labels });
    expect(closed.map((i) => i.kind)).toEqual(['all', 'continue', 'favorites', 'suggestions', 'genresToggle', 'toggle']);
    // while the genres load the group is there (placeholders are drawn under it); with none found it disappears
    expect(sidebarItems({ type: 'movie', genresLoading: true, categories: cats, labels }).map((i) => i.kind)).toContain('genresToggle');
    const open = sidebarItems({ type: 'movie', genres: [], categories: cats, expanded: true, labels });
    expect(open.map((i) => i.kind)).toEqual(['all', 'continue', 'favorites', 'suggestions', 'toggle', 'category', 'category']);
    expect(open.some((i) => i.kind === 'genresToggle')).toBe(false);
  });

  test('live: all plus flat categories', () => {
    expect(sidebarItems({ type: 'live', categories: cats, labels }).map((i) => i.kind)).toEqual(['all', 'category', 'category']);
  });

  test('filter lookup falls back to "show all"', () => {
    const items = sidebarItems({ type: 'movie', genres: [{ key: 'animation', name: 'X' }], categories: [], labels });
    expect(indexOfFilter(items, { kind: 'genre', id: 'animation' })).toBe(5);
    expect(indexOfFilter(items, { kind: 'genre', id: 'war' })).toBe(0);
    expect(indexOfFilter(items, null)).toBe(0);
  });
});
