import en from './locales/en-US.json';
import it from './locales/it-IT.json';

export const DEFAULT_LOCALE = 'en-US';
export const SUPPORTED_LOCALES = ['en-US', 'it-IT'];

export function detectLocale(language) {
  return String(language ?? '').toLowerCase().startsWith('it') ? 'it-IT' : 'en-US';
}

export function createI18n({ locales, fallback = DEFAULT_LOCALE, locale = fallback } = {}) {
  let current = locales[locale] ? locale : fallback;
  const listeners = new Set();

  const lookup = (key, loc) => (locales[loc] ? locales[loc][key] : undefined);
  const format = (text, params) =>
    text.replace(/\{(\w+)\}/g, (match, name) =>
      params && params[name] !== undefined ? String(params[name]) : match,
    );

  function resolve(key, loc, params) {
    if (params && typeof params.count === 'number') {
      const rule = new Intl.PluralRules(loc).select(params.count);
      const plural = lookup(`${key}_${rule}`, loc) ?? lookup(`${key}_other`, loc);
      if (plural !== undefined) return plural;
    }
    return lookup(key, loc);
  }

  return {
    t(key, params) {
      const text = resolve(key, current, params) ?? resolve(key, fallback, params) ?? key;
      return format(text, params);
    },
    getLocale: () => current,
    setLocale(next) {
      const target = locales[next] ? next : fallback;
      if (target === current) return;
      current = target;
      listeners.forEach((fn) => fn(current));
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const i18n = createI18n({ locales: { 'en-US': en, 'it-IT': it } });
export const t = (key, params) => i18n.t(key, params);
