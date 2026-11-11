import { fetchJson } from '../core/http.js';
import { AppError, ErrorCode } from '../core/errors.js';

const API = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * The v4 "API Read Access Token" is a JWT sent as a Bearer header; the older v3 "API Key" is 32 hex characters
 * and goes in the query string. Both are accepted in the same settings field.
 */
export const isBearerToken = (key) => key.includes('.') || key.length > 40;

const titleField = (type) => (type === 'series' ? 'name' : 'title');
const originalField = (type) => (type === 'series' ? 'original_name' : 'original_title');

/**
 * TMDB answers a title it has no translation for in the asked language with its original title (Japanese, Korean...): the API has no
 * fallback, unlike the website. True when that happened: the title is the original one (or missing) and the original language is not
 * the asked one.
 */
export function needsLocalTitle(type, data, language) {
  if (!data) return false;
  const title = data[titleField(type)];
  const original = data[originalField(type)];
  const lang = String(language || '').slice(0, 2);
  return Boolean(original) && (!title || title === original) && Boolean(data.original_language) && data.original_language !== lang;
}

/**
 * A readable title from the translations and alternative titles of a title (append_to_response=translations,alternative_titles):
 * the asked language (its country first), the title it had in the asked country, English, the title it had in the US / UK. '' when none:
 * the app then keeps the provider's name.
 */
export function localTitle(type, data, language) {
  const lang = String(language || '').slice(0, 2);
  const country = String(language || '').slice(3, 5).toUpperCase();
  const field = titleField(type);
  const translations = (data && data.translations && data.translations.translations) || [];
  const translated = (iso, region) => {
    const found = translations.filter((tr) => tr && tr.iso_639_1 === iso && tr.data && tr.data[field]);
    const best = found.find((tr) => tr.iso_3166_1 === region) || found[0];
    return best ? String(best.data[field]).trim() : '';
  };
  const alternatives = (data && data.alternative_titles && (data.alternative_titles.titles || data.alternative_titles.results)) || []; // movies: titles; series: results
  const alternative = (region) => {
    const found = alternatives.find((a) => a && a.iso_3166_1 === region && a.title);
    return found ? String(found.title).trim() : '';
  };
  return translated(lang, country) || (country ? alternative(country) : '') || translated('en', 'US') || alternative('US') || alternative('GB') || '';
}

/** Thin TMDB wrapper. The key is typed in the settings; without it the feature is simply off. */
export function createTmdbClient({ getApiKey = () => '', fetcher = fetchJson } = {}) {
  async function get(path, params = {}) {
    const key = getApiKey();
    if (!key) throw new AppError(ErrorCode.UNKNOWN, 'TMDB is not configured');
    const bearer = isBearerToken(key);
    const query = new URLSearchParams({ ...(bearer ? {} : { api_key: key }), ...params });
    const options = { timeoutMs: 15000 };
    if (bearer) options.headers = { accept: 'application/json', Authorization: `Bearer ${key}` };
    return fetcher(`${API}${path}?${query.toString()}`, options);
  }

  const kind = (type) => (type === 'series' ? 'tv' : 'movie');
  return {
    /** Read on every use: the key can be typed in the settings at any time. */
    get enabled() {
      return Boolean(getApiKey());
    },
    /** `full: false` is the light answer the grids need (no cast, trailers or images); the detail page asks for everything. */
    // A title TMDB has only in its original language (see needsLocalTitle) gets a readable one from its translations: one more request,
    // only for those titles. Without one (or when that request fails) the title is left empty and the app shows the provider's name.
    details: async (type, id, language, { full = true } = {}) => {
      const data = await get(`/${kind(type)}/${id}`, full ? { language, append_to_response: 'credits,videos', include_video_language: `${String(language || 'en').slice(0, 2)},en,null` } : { language });
      if (!needsLocalTitle(type, data, language)) return data;
      const titles = await get(`/${kind(type)}/${id}`, { language, append_to_response: 'translations,alternative_titles' }).catch(() => null);
      return { ...data, [titleField(type)]: titles ? localTitle(type, titles, language) : '' };
    },
    search: (type, query, year, language) =>
      get(`/search/${kind(type)}`, { query, language, ...(year ? { [type === 'series' ? 'first_air_date_year' : 'year']: year } : {}) }),
    recommendations: (type, id, language, page = 1) => get(`/${kind(type)}/${id}/recommendations`, { language, page }),
    trending: (type, language, page = 1) => get(`/trending/${kind(type)}/week`, { language, page }),
  };
}

export const posterUrl = (path, size = 'w342') => (path ? `${IMAGE_BASE}/${size}${path}` : '');
