import { h } from '../dom.js';
import { icon } from '../icons.js';

/** "2019 · S7 · E87": year, then seasons/episodes for series, then an optional tag. A `subtitle` (e.g. the program on air) replaces all. */
export function cardMeta({ year, seasons, episodes, tag, subtitle } = {}) {
  if (subtitle) return subtitle;
  const parts = [];
  if (year) parts.push(String(year));
  if (seasons) parts.push(`S${seasons}`);
  if (episodes) parts.push(`E${episodes}`);
  if (tag) parts.push(tag);
  return parts.join(' · ');
}

export const formatRating = (rating) => (Number(rating) > 0 ? Number(rating).toFixed(1) : '');

/**
 * Grid / carousel card, the same size for every media type.
 *   poster (rating badge top-right, watched/partial badge top-left)
 *   one line of title, one smaller line with year / S / E (or the program on air for channels)
 * update(patch) accepts: title, year, seasons, episodes, tag, subtitle, rating, poster, status, progress.
 */
export function createCard(entry, type, meta = {}) {
  const poster = h('div', { class: 'card-poster' });
  const ratingBadge = h('div', { class: 'card-badge card-rating' });
  const statusBadge = h('div', { class: 'card-badge card-status' });
  const title = h('div', { class: 'card-title' });
  const sub = h('div', { class: 'card-meta' });
  const bar = h('div', { class: 'card-progress' }, h('span'));
  if (meta.placeholder) poster.appendChild(h('div', { class: 'card-placeholder' }, icon(meta.placeholder)));
  poster.append(ratingBadge, statusBadge);
  const el = h('div', { class: `card ${type}` }, poster, title, sub, bar);
  const state = { year: entry.year, seasons: null, episodes: null, tag: '', subtitle: '' };
  let img = null;

  function setPoster(url) {
    if (!url) return;
    if (!img) {
      img = h('img', { alt: '', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => {
        img.remove();
        img = null;
      });
      poster.insertBefore(img, ratingBadge);
    }
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
  }

  function setRating(rating) {
    const text = formatRating(rating);
    while (ratingBadge.firstChild) ratingBadge.removeChild(ratingBadge.firstChild);
    if (text) ratingBadge.append(icon('star'), h('span', { text }));
    ratingBadge.classList.toggle('visible', Boolean(text));
  }

  function setStatus(status) {
    while (statusBadge.firstChild) statusBadge.removeChild(statusBadge.firstChild);
    if (status === 'watched') statusBadge.appendChild(icon('check'));
    else if (status === 'partial') statusBadge.appendChild(icon('hourglass'));
    statusBadge.classList.toggle('visible', status === 'watched' || status === 'partial');
    statusBadge.classList.toggle('partial', status === 'partial');
  }

  function update(next = {}) {
    if (next.title !== undefined) title.textContent = next.title;
    ['year', 'seasons', 'episodes', 'tag', 'subtitle'].forEach((key) => {
      if (next[key] !== undefined && next[key] !== null) state[key] = next[key];
    });
    if (['year', 'seasons', 'episodes', 'tag', 'subtitle'].some((key) => next[key] !== undefined)) sub.textContent = cardMeta(state);
    if (next.poster) setPoster(next.poster);
    if (next.rating !== undefined) setRating(next.rating);
    if (next.status !== undefined) setStatus(next.status);
    if (next.progress !== undefined) {
      el.classList.toggle('has-progress', next.progress > 0);
      bar.firstChild.style.width = `${Math.round(Math.min(1, Math.max(0, next.progress)) * 100)}%`;
    }
  }

  const fields = { ...meta };
  delete fields.placeholder;
  update({ title: entry.name, poster: entry.icon, rating: entry.rating, year: entry.year, ...fields });
  return { el, update };
}
