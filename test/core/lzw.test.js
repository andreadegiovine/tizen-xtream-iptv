import { compressText, decompressText } from '../../src/core/lzw.js';

const roundTrip = (text) => expect(decompressText(compressText(text))).toBe(text);

test('round trip: empty, short, repeated, unicode (accents, emoji, CJK)', () => {
  ['', 'a', 'abababababababab', 'TOBEORNOTTOBEORTOBEORNOT', 'Così è — perché? 🎬 千と千尋 ✓', '\n\t  '].forEach(roundTrip);
});

test('logs compress to a fraction, URL-safe; long inputs past the 16-bit dictionary', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `21:${String(i % 60).padStart(2, '0')}:07 info Catalog movie: ${i * 7} items, ${i} entries, 3 categories; fetch ${i * 13} ms`);
  const text = lines.join('\n');
  const packed = compressText(text);
  expect(packed.length).toBeLessThan(text.length / 2);
  expect(/^[0-9a-z]+\.[A-Za-z0-9_-]*$/.test(packed)).toBe(true);
  roundTrip(text);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const noisy = Array.from({ length: 200000 }, () => String.fromCharCode(32 + Math.floor(rnd() * 90))).join('');
  roundTrip(noisy);
});
