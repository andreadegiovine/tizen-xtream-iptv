export function formatNumber(value, locale = 'en-US') {
  return Number(value || 0).toLocaleString(locale);
}

export function formatDateTime(timestamp, locale = 'en-US') {
  return new Date(timestamp).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 1790000000000 -> "22/10/2026" (locale order). */
export function formatDate(timestamp, locale = 'en-US') {
  return new Date(timestamp).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** 12345 -> "12.3" (seconds, one decimal). */
export function formatSeconds(ms) {
  return (Number(ms || 0) / 1000).toFixed(1);
}
