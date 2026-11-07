import { createGrowingGridModel, wantedCount, firstKeptRow, PREFETCH_ROWS, columnsFor, sidebarItems, indexOfFilter } from '../../src/ui/pages/browsePage.js';

const GRID_COLUMNS = 6;

describe('growing grid (no pages)', () => {
  test('the cards down to 3 rows below the screen are wanted', () => {
    expect(PREFETCH_ROWS).toBe(3);
    expect(wantedCount(0, GRID_COLUMNS, 3)).toBe((0 + 3 + 3) * GRID_COLUMNS);
    expect(wantedCount(13, GRID_COLUMNS, 3)).toBe((2 + 3 + 3) * GRID_COLUMNS); // focus on the third row
    expect(columnsFor('live')).toBe(6);
    expect(columnsFor('movie')).toBe(6);
  });

  test('the pictures are kept from 3 rows above the screen down', () => {
    expect(firstKeptRow(0, GRID_COLUMNS, 3)).toBe(0);
    expect(firstKeptRow(12 * GRID_COLUMNS, GRID_COLUMNS, 3)).toBe(12 - 3 + 1 - 3); // focus on row 12, the last on screen
  });

  test('down from the last loaded row waits for the next cards when the view has more, otherwise leaves', () => {
    const asked = [];
    let more = true;
    const m = createGrowingGridModel({ columns: GRID_COLUMNS, getCount: () => 12, hasMore: () => more, more: () => asked.push(1) });
    expect(m.navigate('down', 8)).toEqual({ type: 'move', index: 8 });
    expect(asked).toHaveLength(1);
    more = false;
    expect(m.navigate('down', 8)).toEqual({ type: 'exit', dir: 'down' });
    expect(m.navigate('down', 0)).toEqual({ type: 'move', index: GRID_COLUMNS }); // inside: a normal grid
    expect(m.navigate('up', 2)).toEqual({ type: 'exit', dir: 'up' });
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

  test('live: the guide first (where the page opens), then all, favourites and a categories group', () => {
    expect(sidebarItems({ type: 'live', categories: cats, labels }).map((i) => i.kind)).toEqual(['guide', 'all', 'favorites', 'toggle']);
    expect(sidebarItems({ type: 'live', categories: cats, expanded: true, labels }).map((i) => i.kind)).toEqual(['guide', 'all', 'favorites', 'toggle', 'category', 'category']);
    expect(indexOfFilter(sidebarItems({ type: 'live', categories: cats, labels }), null)).toBe(0);
  });

  test('live: the guide genres (open) come before the networks, only when the guide has some', () => {
    const genres = [{ key: 'sport', name: 'Sport' }, { key: 'news', name: 'News' }];
    const networks = [{ key: 'live:n1', name: 'Rai' }];
    const items = sidebarItems({ type: 'live', epgGenres: genres, networks, categories: cats, labels: { ...labels, networks: 'Reti' } });
    expect(items.map((i) => i.kind)).toEqual(['guide', 'all', 'favorites', 'epgGenresToggle', 'epgGenre', 'epgGenre', 'networksToggle', 'network', 'toggle']);
    expect(items[3].name).toBe('Generi');
    expect(items[4]).toMatchObject({ id: 'sport', name: 'Sport', depth: 1 });
    expect(sidebarItems({ type: 'live', epgGenres: genres, epgGenresExpanded: false, categories: cats, labels }).map((i) => i.kind)).toEqual(['guide', 'all', 'favorites', 'epgGenresToggle', 'toggle']);
    expect(sidebarItems({ type: 'live', epgGenres: [], categories: cats, labels }).some((i) => i.kind === 'epgGenresToggle')).toBe(false);
  });

  test('filter lookup falls back to "show all"', () => {
    const items = sidebarItems({ type: 'movie', genres: [{ key: 'animation', name: 'X' }], categories: [], labels });
    expect(indexOfFilter(items, { kind: 'genre', id: 'animation' })).toBe(5);
    expect(indexOfFilter(items, { kind: 'genre', id: 'war' })).toBe(0);
    expect(indexOfFilter(items, null)).toBe(0);
  });
});

test('sidebar: pinned entries sit between suggestions and genres', () => {
  const labels = { all: 'All', continue: 'C', favorites: 'F', suggestions: 'S', genres: 'G', categories: 'Cat' };
  const items = sidebarItems({ type: 'movie', genres: [{ key: 'drama', name: 'Drama' }], pinned: [{ kind: 'genre', id: 'drama', name: 'Drama' }, { kind: 'category', id: 7, name: 'Premiere' }], labels });
  expect(items.map((i) => i.kind)).toEqual(['all', 'continue', 'favorites', 'suggestions', 'genre', 'category', 'genresToggle', 'genre']);
  expect(items[4]).toMatchObject({ pinned: true, id: 'drama' });
  expect(items[5]).toMatchObject({ pinned: true, id: '7' });
});

test('sidebar: pinned categories sit after the favourites on Live TV', () => {
  const labels = { all: 'All', favorites: 'F', categories: 'Cat' };
  const items = sidebarItems({ type: 'live', categories: [{ id: 3, name: 'Sport' }], pinned: [{ kind: 'category', id: 3, name: 'Sport' }], labels });
  expect(items.map((i) => i.kind)).toEqual(['guide', 'all', 'favorites', 'category', 'toggle']);
  expect(items[3]).toMatchObject({ pinned: true, id: '3' });
});
