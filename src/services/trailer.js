/** The provider gives either the bare 11-character id or a full youtube URL. */
export function youtubeId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^[\w-]{11}$/.test(text)) return text;
  const match = /(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/.exec(text);
  return match ? match[1] : '';
}

export const youtubeUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

/** `youtube:<id>` is how the player controller is told which trailer to open (the platform's trailer engine plays it). */
export const youtubeStreamUrl = (id) => `youtube:${id}`;
export const videoIdOf = (url) => {
  const match = /^youtube:([\w-]{11})$/.exec(String(url || ''));
  return match ? match[1] : '';
};
