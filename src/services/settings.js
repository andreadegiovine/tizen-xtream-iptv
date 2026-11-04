import { kvGet, kvSet } from '../db/kv.js';
import { TIME_FORMATS, DATE_FORMATS } from '../core/clock.js';

export const BUFFER_OPTIONS = [2, 5, 10, 20, 30];
export const CAROUSEL_OPTIONS = [10, 15, 20, 30];
// Multiples of 12 fill whole rows for both poster grids (6 columns) and channel grids (4 columns).
export const GRID_OPTIONS = [12, 24, 36];
export const LANGUAGE_OPTIONS = ['auto', 'en-US', 'it-IT'];
export const SUGGESTION_SOURCE_OPTIONS = ['tmdb', 'trakt'];

export const DEFAULT_SETTINGS = Object.freeze({
  language: 'auto',
  bufferSeconds: 10,
  carouselItems: 15,
  gridItems: 24,
  autoplayNext: true,
  suggestionSource: 'tmdb',
  timeFormat: 'auto',
  dateFormat: 'auto',
  excluded: {},
});

const pick = (value, options, fallback) => (options.includes(value) ? value : fallback);

function sanitize(raw) {
  return {
    language: pick(raw.language, LANGUAGE_OPTIONS, DEFAULT_SETTINGS.language),
    bufferSeconds: pick(raw.bufferSeconds, BUFFER_OPTIONS, DEFAULT_SETTINGS.bufferSeconds),
    carouselItems: pick(raw.carouselItems, CAROUSEL_OPTIONS, DEFAULT_SETTINGS.carouselItems),
    gridItems: pick(raw.gridItems, GRID_OPTIONS, DEFAULT_SETTINGS.gridItems),
    autoplayNext: typeof raw.autoplayNext === 'boolean' ? raw.autoplayNext : DEFAULT_SETTINGS.autoplayNext,
    suggestionSource: pick(raw.suggestionSource, SUGGESTION_SOURCE_OPTIONS, DEFAULT_SETTINGS.suggestionSource),
    timeFormat: pick(raw.timeFormat, TIME_FORMATS, DEFAULT_SETTINGS.timeFormat),
    dateFormat: pick(raw.dateFormat, DATE_FORMATS, DEFAULT_SETTINGS.dateFormat),
    excluded: raw.excluded && typeof raw.excluded === 'object' ? raw.excluded : {},
  };
}

export class SettingsService {
  constructor(db) {
    this.db = db;
  }

  async get() {
    const stored = await kvGet(this.db, 'settings', {});
    return sanitize({ ...DEFAULT_SETTINGS, ...stored });
  }

  async update(patch) {
    const next = sanitize({ ...(await this.get()), ...patch });
    await kvSet(this.db, 'settings', next);
    return next;
  }

  /** Excluded category ids for one provider and media type. */
  async getExcluded(providerId, type) {
    const { excluded } = await this.get();
    return new Set(((excluded[providerId] || {})[type] || []).map(String));
  }

  async setExcluded(providerId, type, categoryIds) {
    const { excluded } = await this.get();
    const forProvider = { ...(excluded[providerId] || {}), [type]: Array.from(new Set(categoryIds.map(String))) };
    return this.update({ excluded: { ...excluded, [providerId]: forProvider } });
  }
}
