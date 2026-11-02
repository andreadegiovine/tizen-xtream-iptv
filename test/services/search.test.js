import { searchRows } from '../../src/services/searchIndex.js';

const rows = [
  { key: 'movie:t1', type: 'movie', name: 'Heat', keys: ['heat'], added: 1 },
  { key: 'movie:t2', type: 'movie', name: 'The Heat', keys: ['the heat'], added: 5 },
  { key: 'movie:t3', type: 'movie', name: 'Wheat Field', keys: ['wheat field'], added: 9 },
  { key: 'series:t4', type: 'series', name: 'Heat Wave', keys: ['heat wave', 'onda di calore'], added: 3 },
];

describe('searchRows', () => {
  test('ignores very short queries', () => {
    expect(searchRows(rows, 'h')).toEqual([]);
  });
  test('ranks exact, then prefix, then word start, then substring', () => {
    expect(searchRows(rows, 'heat').map((r) => r.key)).toEqual(['movie:t1', 'series:t4', 'movie:t2', 'movie:t3']);
  });
  test('every word must match, accents ignored, any key counts', () => {
    expect(searchRows(rows, 'ONDA calore').map((r) => r.key)).toEqual(['series:t4']);
    expect(searchRows(rows, 'wave heat').map((r) => r.key)).toEqual(['series:t4']);
  });
  test('filters by type and limits', () => {
    expect(searchRows(rows, 'heat', { types: ['series'] })).toHaveLength(1);
    expect(searchRows(rows, 'heat', { limit: 2 })).toHaveLength(2);
  });
});
