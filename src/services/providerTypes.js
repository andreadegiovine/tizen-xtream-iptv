import { XtreamClient } from './xtreamClient.js';
import { M3uClient } from './m3uClient.js';

/** Kinds of provider: an Xtream Codes account, or an M3U playlist with an optional XMLTV guide. */
export const ProviderType = Object.freeze({ XTREAM: 'xtream', M3U: 'm3u' });

/** A provider saved before the types existed is an Xtream one. */
export const providerType = (provider) => (provider && provider.type === ProviderType.M3U ? ProviderType.M3U : ProviderType.XTREAM);

/** The client of a provider (same methods for both types). */
export function createProviderClient(provider) {
  if (providerType(provider) === ProviderType.M3U) return new M3uClient({ playlistUrl: provider.playlistUrl, epgUrl: provider.epgUrl || '' });
  return new XtreamClient({ baseUrl: provider.baseUrl, username: provider.username, password: provider.password });
}

/** Top bar sections a provider type has nothing for: a playlist has no series (no seasons or episodes in M3U). */
export function providerHiddenSections(provider) {
  return providerType(provider) === ProviderType.M3U ? ['series'] : [];
}

/** Media types the catalog of a provider holds. */
export function providerMediaTypes(provider) {
  return providerType(provider) === ProviderType.M3U ? ['movie', 'live'] : ['movie', 'series', 'live'];
}
