import { searchRows, createSearchService } from '../../src/services/searchIndex.js';

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

test('search service: programmes and merge candidates are asked to the worker; null without a worker (the caller works in the page)', async () => {
  const posted = [];
  const fakeWorker = {
    postMessage(message) {
      posted.push(message.op);
      const reply = (data) => setTimeout(() => fakeWorker.onmessage({ data }), 0);
      if (message.op === 'load') reply({ event: 'ready', token: message.token, count: 0, ms: 1 });
      if (message.op === 'programmes-load') reply({ event: 'programmes-ready', token: message.token, count: 3, ms: 1 });
      if (message.op === 'programmes-search') reply({ event: 'result', id: message.id, rows: [{ title: `${message.query}@${message.options.now}` }] });
      if (message.op === 'merge') reply({ event: 'result', id: message.id, rows: [{ key: 'live:x', skip: message.options.skipId }] });
    },
    terminate() {},
  };
  const active = { get: async () => ({ provider: { id: 'p' }, db: null }) };
  const svc = createSearchService({ active, createWorker: () => fakeWorker });
  await svc.warmProgrammes();
  expect(await svc.searchProgrammes('news', { limit: 5, now: 42 })).toEqual([{ title: 'news@42' }]);
  expect(await svc.mergeCandidates('', { limit: 5, skipId: 7 })).toEqual([{ key: 'live:x', skip: 7 }]);
  svc.invalidateProgrammes();
  expect(posted).toEqual(['programmes-load', 'programmes-search', 'load', 'merge', 'programmes-forget']);
  const none = createSearchService({ active });
  expect(await none.searchProgrammes('news')).toBeNull();
  expect(await none.mergeCandidates('')).toBeNull();
});
