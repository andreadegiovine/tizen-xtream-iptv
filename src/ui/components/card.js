import { h } from '../dom.js';

/**
 * Grid / carousel card. `meta` can carry TMDB data (title, poster) and a second line (EPG, progress).
 * Returns { el, update({ title, subtitle, poster, progress }) } so metadata can arrive later.
 */
export function createCard(entry, type, meta = {}) {
  const poster = h('div', { class: 'card-poster' });
  const title = h('div', { class: 'card-title' });
  const sub = h('div', { class: 'card-sub' });
  const bar = h('div', { class: 'card-progress' }, h('span'));
  const el = h('div', { class: `card ${type}` }, poster, title, sub, bar);
  let img = null;

  function setPoster(url) {
    if (!url) return;
    if (!img) {
      img = h('img', { alt: '', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => {
        img.remove();
        img = null;
      });
      poster.appendChild(img);
    }
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
  }

  function update(next = {}) {
    if (next.title !== undefined) title.textContent = next.title;
    if (next.subtitle !== undefined) {
      sub.textContent = next.subtitle || '';
      el.classList.toggle('has-sub', Boolean(next.subtitle));
    }
    if (next.poster) setPoster(next.poster);
    if (next.progress !== undefined) {
      el.classList.toggle('has-progress', next.progress > 0);
      bar.firstChild.style.width = `${Math.round(Math.min(1, Math.max(0, next.progress)) * 100)}%`;
    }
  }

  update({
    title: entry.year ? `${entry.name} (${entry.year})` : entry.name,
    poster: entry.icon,
    ...meta,
  });
  return { el, update };
}
