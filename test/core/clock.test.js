import { formatClockTime, formatClockDate } from '../../src/core/clock.js';

const date = new Date(2026, 10, 4, 14, 5); // 4 November 2026, 14:05

test('time formats', () => {
  expect(formatClockTime(date, '24h')).toBe('14:05');
  expect(formatClockTime(date, '12h')).toBe('2:05 PM');
  expect(formatClockTime(new Date(2026, 0, 1, 0, 9), '12h')).toBe('12:09 AM');
  expect(typeof formatClockTime(date, 'auto')).toBe('string');
});

test('date formats', () => {
  expect(formatClockDate(date, 'dmy')).toBe('04/11/2026');
  expect(formatClockDate(date, 'mdy')).toBe('11/04/2026');
  expect(formatClockDate(date, 'ymd')).toBe('2026-11-04');
  expect(formatClockDate(date, 'auto')).toMatch(/2026/);
});

test('"auto" follows the language given (the app language), not the one of the device', () => {
  const date = new Date(2026, 10, 4, 14, 5);
  expect(formatClockTime(date, 'auto', 'it-IT')).toBe('14:05');
  expect(formatClockTime(date, 'auto', 'en-US')).toMatch(/02:05\s?PM/);
  expect(formatClockDate(date, 'auto', 'it-IT')).toBe('04/11/2026');
  expect(formatClockDate(date, 'auto', 'en-US')).toBe('11/04/2026');
});
