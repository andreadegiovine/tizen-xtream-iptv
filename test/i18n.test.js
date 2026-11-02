import en from '../src/i18n/locales/en-US.json';
import it from '../src/i18n/locales/it-IT.json';
import { createI18n, detectLocale } from '../src/i18n/index.js';

describe('i18n', () => {
  test('both locales define exactly the same keys', () => {
    expect(Object.keys(it).sort()).toEqual(Object.keys(en).sort());
  });

  test('every error code has a message', () => {
    ['AUTH_FAILED', 'NETWORK', 'TIMEOUT', 'UNKNOWN', 'ACCOUNT_EXPIRED'].forEach((code) => {
      expect(en[`error.${code}`]).toBeTruthy();
      expect(it[`error.${code}`]).toBeTruthy();
    });
  });

  test('plurals and interpolation', () => {
    const i18n = createI18n({ locales: { 'en-US': en, 'it-IT': it } });
    expect(i18n.t('series.seasons', { count: 1 })).toBe('1 season');
    expect(i18n.t('series.seasons', { count: 3 })).toBe('3 seasons');
    i18n.setLocale('it-IT');
    expect(i18n.t('series.episodes', { count: 1 })).toBe('1 episodio');
    expect(i18n.t('series.episodes', { count: 12 })).toBe('12 episodi');
  });

  test('falls back to en-US and then to the key', () => {
    const i18n = createI18n({ locales: { 'en-US': { a: 'A' }, 'it-IT': {} }, locale: 'it-IT' });
    expect(i18n.t('a')).toBe('A');
    expect(i18n.t('missing.key')).toBe('missing.key');
  });

  test('notifies listeners and detects the TV language', () => {
    const i18n = createI18n({ locales: { 'en-US': en, 'it-IT': it } });
    const seen = [];
    i18n.onChange((l) => seen.push(l));
    i18n.setLocale('it-IT');
    i18n.setLocale('it-IT');
    expect(seen).toEqual(['it-IT']);
    expect(detectLocale('it')).toBe('it-IT');
    expect(detectLocale('de-DE')).toBe('en-US');
  });
});
