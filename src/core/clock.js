export const TIME_FORMATS = ['auto', '12h', '24h'];
export const DATE_FORMATS = ['auto', 'dmy', 'mdy', 'ymd'];

const pad = (n) => String(n).padStart(2, '0');

/** "14:05" / "2:05 PM". `auto` follows the system (the browser's own locale). */
export function formatClockTime(date, format = 'auto') {
  if (format === '24h') return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (format === '12h') {
    const hours = date.getHours() % 12 || 12;
    return `${hours}:${pad(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  try {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}

/** "04/11/2026" / "11/04/2026" / "2026-11-04". `auto` follows the system locale. */
export function formatClockDate(date, format = 'auto') {
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  if (format === 'dmy') return `${d}/${m}/${y}`;
  if (format === 'mdy') return `${m}/${d}/${y}`;
  if (format === 'ymd') return `${y}-${m}-${d}`;
  try {
    return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return `${d}/${m}/${y}`;
  }
}
