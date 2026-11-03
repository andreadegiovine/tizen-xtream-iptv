import { describeType } from '../../src/ui/components/syncPanel.js';
import { formatNumber, formatSeconds } from '../../src/core/format.js';

describe('home sync text', () => {
  test('live progress wins over stored data', () => {
    expect(describeType({ phase: 'write', done: 2000, total: 12000 }, { itemCount: 1 }, 'en-US')).toBe('Saving 2,000 / 12,000');
    expect(describeType({ phase: 'download' }, null, 'en-US')).toBe('Downloading the list…');
  });

  test('idle shows the last sync or "never run"', () => {
    expect(describeType({ phase: 'idle' }, null, 'en-US')).toBe('Never run');
    expect(describeType({ phase: 'done' }, { itemCount: 1500, entryCount: 1200, lastSync: Date.UTC(2026, 10, 2, 12, 0) }, 'en-US')).toMatch(/1,500 items · 1,200 titles · updated /);
  });

  test('errors use the translated message of their code', () => {
    expect(describeType({ phase: 'error', code: 'AUTH_FAILED' }, null, 'en-US')).toBe('The provider rejected these credentials.');
  });

  test('number and duration formatting', () => {
    expect(formatNumber(1234567, 'en-US')).toBe('1,234,567');
    expect(formatSeconds(12345)).toBe('12.3');
  });
});
