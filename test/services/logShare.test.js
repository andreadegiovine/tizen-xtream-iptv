import { buildLogLink, LOGS_PAGE_URL } from '../../src/services/logShare.js';
import { decompressText } from '../../src/core/lzw.js';

const entries = Array.from({ length: 500 }, (_, i) => ({ ts: Date.UTC(2026, 10, 11, 21, 0, i % 60), level: i % 9 ? 'info' : 'warn', message: `Catalog movie: ${i} items, fetch ${i * 13} ms, provider http://example.org` }));

test('the newest lines that fit, after the header, compressed after # of the logs page', () => {
  const { url, lines } = buildLogLink(entries, { header: 'Xtream IPTV 2.0.1 · tizen' });
  expect(url.length).toBeLessThanOrEqual(2300);
  expect(url.indexOf(`${LOGS_PAGE_URL}#`)).toBe(0);
  expect(lines).toBeGreaterThan(40);
  expect(lines).toBeLessThan(500);
  const text = decompressText(url.slice(url.indexOf('#') + 1)).split('\n');
  expect(text[0]).toBe('Xtream IPTV 2.0.1 · tizen');
  expect(text[text.length - 1]).toContain('Catalog movie: 499 items'); // the newest
  expect(text).toHaveLength(lines + 1);
});

test('few lines: all of them', () => {
  const { lines } = buildLogLink(entries.slice(0, 3));
  expect(lines).toBe(3);
});
