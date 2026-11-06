import { kvGet, kvSet } from '../db/kv.js';
import { TIME_FORMATS, DATE_FORMATS } from '../core/clock.js';
import { TEXT_SIZES, DEFAULT_TEXT_SIZE } from '../core/textSize.js';
import { DEFAULT_SIMILARITY, DEFAULT_MAX_DIFF, DEFAULT_IGNORE_NUMBERS } from './liveNetworks.js';

export const BUFFER_OPTIONS = [2, 5, 10, 20, 30];
export const CAROUSEL_OPTIONS = [10, 15, 20, 30];
// Multiples of 12 fill whole rows for both poster grids (6 columns) and channel grids (4 columns).
export const GRID_OPTIONS = [12, 24, 36];
// Screensaver: minutes without a key before it starts; 0 = off.
export const SCREENSAVER_OPTIONS = [0, 1, 5, 15];
export const LANGUAGE_OPTIONS = ['auto', 'en-US', 'it-IT'];
export const SUGGESTION_SOURCE_OPTIONS = ['tmdb', 'trakt'];

export const DEFAULT_SETTINGS = Object.freeze({
  language: 'auto',
  bufferSeconds: 10,
  carouselItems: 15,
  gridItems: 24,
  autoplayNext: true,
  textSize: DEFAULT_TEXT_SIZE, // % of the base text size (75, 100, 125)
  screensaver: 15, // minutes without a key before the black screen with the moving logo (0 = off)
  suggestionSource: 'tmdb',
  cleanTitles: true, // movie / series titles without year in brackets, [tags] and language prefixes ("IT: Inception (2010) [4K]" → "Inception")
  timeFormat: 'auto',
  dateFormat: 'auto',
  liveGrouping: true, // Live TV: versions of the same channel shown as one
  liveNetworks: true, // Live TV: the channels of one broadcaster (Rai 1, Rai 2...) gathered in a network
  liveGroupPatterns: '', // words removed from channel names to compare them; empty = the defaults
  liveNetworkSimilarity: DEFAULT_SIMILARITY, // networks: least % of a name its common beginning must be
  liveNetworkMaxDiff: DEFAULT_MAX_DIFF, // networks: most characters a name can have beyond the common beginning
  liveNetworkIgnoreNumbers: DEFAULT_IGNORE_NUMBERS, // networks: numbers left out of the name comparison ("Dazn 11 Serie B" ~ "Dazn 12 Serie B")
  excluded: {},
});

/** A whole number inside the range, otherwise the fallback. */
const whole = (value, min, max, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback);

const pick = (value, options, fallback) => (options.includes(value) ? value : fallback);

function sanitize(raw) {
  return {
    language: pick(raw.language, LANGUAGE_OPTIONS, DEFAULT_SETTINGS.language),
    bufferSeconds: pick(raw.bufferSeconds, BUFFER_OPTIONS, DEFAULT_SETTINGS.bufferSeconds),
    carouselItems: pick(raw.carouselItems, CAROUSEL_OPTIONS, DEFAULT_SETTINGS.carouselItems),
    gridItems: pick(raw.gridItems, GRID_OPTIONS, DEFAULT_SETTINGS.gridItems),
    textSize: pick(raw.textSize, TEXT_SIZES, DEFAULT_SETTINGS.textSize),
    // Older versions stored on / off: on is the default delay.
    screensaver: typeof raw.screensaver === 'boolean' ? (raw.screensaver ? DEFAULT_SETTINGS.screensaver : 0) : pick(raw.screensaver, SCREENSAVER_OPTIONS, DEFAULT_SETTINGS.screensaver),
    autoplayNext: typeof raw.autoplayNext === 'boolean' ? raw.autoplayNext : DEFAULT_SETTINGS.autoplayNext,
    suggestionSource: pick(raw.suggestionSource, SUGGESTION_SOURCE_OPTIONS, DEFAULT_SETTINGS.suggestionSource),
    cleanTitles: typeof raw.cleanTitles === 'boolean' ? raw.cleanTitles : DEFAULT_SETTINGS.cleanTitles,
    timeFormat: pick(raw.timeFormat, TIME_FORMATS, DEFAULT_SETTINGS.timeFormat),
    dateFormat: pick(raw.dateFormat, DATE_FORMATS, DEFAULT_SETTINGS.dateFormat),
    liveGrouping: typeof raw.liveGrouping === 'boolean' ? raw.liveGrouping : DEFAULT_SETTINGS.liveGrouping,
    liveNetworks: typeof raw.liveNetworks === 'boolean' ? raw.liveNetworks : DEFAULT_SETTINGS.liveNetworks,
    liveGroupPatterns: typeof raw.liveGroupPatterns === 'string' ? raw.liveGroupPatterns.slice(0, 600) : '',
    liveNetworkSimilarity: whole(raw.liveNetworkSimilarity, 10, 100, DEFAULT_SETTINGS.liveNetworkSimilarity),
    liveNetworkMaxDiff: whole(raw.liveNetworkMaxDiff, 0, 50, DEFAULT_SETTINGS.liveNetworkMaxDiff),
    liveNetworkIgnoreNumbers: typeof raw.liveNetworkIgnoreNumbers === 'boolean' ? raw.liveNetworkIgnoreNumbers : DEFAULT_SETTINGS.liveNetworkIgnoreNumbers,
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
