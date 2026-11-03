import { fetchJson } from '../core/http.js';
import { AppError, ErrorCode } from '../core/errors.js';

const API = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * The v4 "API Read Access Token" is a JWT sent as a Bearer header; the older v3 "API Key" is 32 hex characters
 * and goes in the query string. Both are accepted in the same settings field.
 */
export const isBearerToken = (key) => key.includes('.') || key.length > 40;

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
    details: (type, id, language) => get(`/${kind(type)}/${id}`, { language, append_to_response: 'credits' }),
    search: (type, query, year, language) =>
      get(`/search/${kind(type)}`, { query, language, ...(year ? { [type === 'series' ? 'first_air_date_year' : 'year']: year } : {}) }),
    recommendations: (type, id, language) => get(`/${kind(type)}/${id}/recommendations`, { language }),
    trending: (type, language) => get(`/trending/${kind(type)}/week`, { language }),
  };
}

export const posterUrl = (path, size = 'w342') => (path ? `${IMAGE_BASE}/${size}${path}` : '');
