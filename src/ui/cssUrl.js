/**
 * A CSS `url("...")` for an address that comes from the provider or TMDB: quotes, backslashes and line breaks are escaped, so an odd
 * address cannot end the value early and break (or change) the rule it is written into.
 */
export function cssUrl(url) {
  const safe = String(url == null ? '' : url).replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r\f]/g, '');
  return `url("${safe}")`;
}
