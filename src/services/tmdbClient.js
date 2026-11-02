import { fetchJson } from '../core/http.js';
import { AppError, ErrorCode } from '../core/errors.js';

const API = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export const TMDB_API_KEY = typeof __TMDB_API_KEY__ !== 'undefined' ? __TMDB_API_KEY__ : '';

/** Thin TMDB v3 wrapper. `apiKey` comes from the build (see README); without it the feature is simply off. */
export function createTmdbClient({ apiKey = TMDB_API_KEY, fetcher = fetchJson } = {}) {
  const enabled = Boolean(apiKey);

  async function get(path, params = {}) {
    if (!enabled) throw new AppError(ErrorCode.UNKNOWN, 'TMDB is not configured');
    const query = new URLSearchParams({ api_key: apiKey, ...params });
    return fetcher(`${API}${path}?${query.toString()}`, { timeoutMs: 15000 });
  }

  const kind = (type) => (type === 'series' ? 'tv' : 'movie');
  return {
    enabled,
    details: (type, id, language) => get(`/${kind(type)}/${id}`, { language }),
    search: (type, query, year, language) =>
      get(`/search/${kind(type)}`, { query, language, ...(year ? { [type === 'series' ? 'first_air_date_year' : 'year']: year } : {}) }),
    recommendations: (type, id, language) => get(`/${kind(type)}/${id}/recommendations`, { language }),
    trending: (type, language) => get(`/trending/${kind(type)}/week`, { language }),
  };
}

export const posterUrl = (path, size = 'w342') => (path ? `${IMAGE_BASE}/${size}${path}` : '');
