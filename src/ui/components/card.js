import { h } from '../dom.js';
import { icon } from '../icons.js';
import { lazySrc } from '../lazyImage.js';
import { i18n, t } from '../../i18n/index.js';
import { formatNumber } from '../../core/format.js';
import { rotatePoster } from './imageRotator.js';

let isAdultEntry = () => false;
/** The app tells the cards which entries are adult content: their poster is never shown (a lock stands in for it). */
export function setAdultCheck(fn) {
  isAdultEntry = typeof fn === 'function' ? fn : () => false;
}

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

/** Empty card with the same footprint, pulsing while the real ones are loaded. */
export function createSkeletonCard() {
  return h('div', { class: 'card skeleton-card' }, h('div', { class: 'card-poster loading' }), h('div', { class: 'card-title skeleton-line' }), h('div', { class: 'card-meta skeleton-line short' }));
}

export const formatRating = (rating) => (Number(rating) > 0 ? Number(rating).toFixed(1) : '');

/**
 * Grid / carousel card, the same size for every media type.
 *   poster (rating badge top-right, watched/partial badge top-left)
 *   one line of title, one smaller line with year / S / E (or the program on air for channels)
 * `meta.square` makes the picture a square (the Live TV page only).
 * update(patch) accepts: title, year, seasons, episodes, tag, subtitle, rating, favorite (heart badge under the rating), poster, posters (several: rotate, see imageRotator.js), status, progress.
 */
export function createCard(entry, type, meta = {}) {
  const poster = h('div', { class: 'card-poster' });
  const ratingBadge = h('div', { class: 'card-badge card-rating' });
  const favoriteBadge = h('div', { class: 'card-badge card-favorite' }, icon('heart'));
  const badges = h('div', { class: 'card-badges' }, ratingBadge, favoriteBadge); // top right: rating, then the heart under it
  const statusBadge = h('div', { class: 'card-badge card-status' });
  const title = h('div', { class: 'card-title' });
  const sub = h('div', { class: 'card-meta' });
  const bar = h('div', { class: 'card-progress' }, h('span'));
  const locked = Boolean(entry && isAdultEntry(entry));
  if (locked) poster.appendChild(h('div', { class: 'card-placeholder locked' }, icon('lock')));
  else if (meta.placeholder) poster.appendChild(h('div', { class: 'card-placeholder' }, icon(meta.placeholder)));
  poster.append(badges, statusBadge);
  const el = h('div', { class: `card ${type}${meta.square ? ' square' : ''}` }, poster, title, sub, bar); // `square`: the logo box of Live TV channels
  const state = { year: entry.year, seasons: null, episodes: null, tag: '', subtitle: '', count: null, countLoading: false };
  let img = null;
  let rotation = null; // a collection card: its poster changes among the pictures of its titles

  function setPoster(url) {
    if (!url || locked) return;
    if (!img) {
      img = h('img', { alt: '', referrerpolicy: 'no-referrer' });
      const done = () => poster.classList.remove('loading');
      img.addEventListener('load', done);
      img.addEventListener('error', () => {
        img.remove();
        img = null;
        done();
      });
      poster.insertBefore(img, badges);
    }
    if (img.dataset.src !== url) {
      poster.classList.add('loading'); // skeleton until the picture is there
      lazySrc(img, url);
    }
  }

  /** The meta line, plus (favourite categories / genres) a number after a dot: a grey sweep stands in until it is known. */
  function renderSub() {
    const text = cardMeta(state);
    sub.textContent = text;
    if (state.countLoading) {
      if (text) sub.appendChild(document.createTextNode(' · '));
      sub.appendChild(h('span', { class: 'skeleton-line card-count-skeleton' }));
    } else if (state.count !== null && state.count !== undefined) {
      sub.appendChild(document.createTextNode(`${text ? ' · ' : ''}${formatNumber(state.count, i18n.getLocale())}`));
    }
  }

  function setRating(rating) {
    const text = formatRating(rating);
    while (ratingBadge.firstChild) ratingBadge.removeChild(ratingBadge.firstChild);
    if (text) ratingBadge.append(icon('star'), h('span', { text }));
    ratingBadge.classList.toggle('visible', Boolean(text));
  }

  function setStatus(status) {
    while (statusBadge.firstChild) statusBadge.removeChild(statusBadge.firstChild);
    // A network or a grouped Live TV channel carries its own badge, in the place of the watched one.
    const shown = entry && entry.isNetwork ? 'network' : entry && entry.isGroup ? 'group' : status;
    if (shown === 'network') statusBadge.appendChild(icon('network'));
    else if (shown === 'group') statusBadge.appendChild(icon('group'));
    else if (shown === 'watched') statusBadge.appendChild(icon('check'));
    else if (shown === 'partial') statusBadge.appendChild(icon('hourglass'));
    statusBadge.classList.toggle('visible', shown === 'network' || shown === 'group' || shown === 'watched' || shown === 'partial');
    statusBadge.classList.toggle('partial', shown === 'partial');
    statusBadge.classList.toggle('group', shown === 'group' || shown === 'network');
  }

  function update(next = {}) {
    if (next.title !== undefined) title.textContent = next.title;
    ['year', 'seasons', 'episodes', 'tag', 'subtitle'].forEach((key) => {
      if (next[key] !== undefined && next[key] !== null) state[key] = next[key];
    });
    if (next.count !== undefined) {
      state.count = next.count;
      state.countLoading = false;
    }
    if (next.countLoading !== undefined) state.countLoading = next.countLoading;
    if (['year', 'seasons', 'episodes', 'tag', 'subtitle', 'count', 'countLoading'].some((key) => next[key] !== undefined)) renderSub();
    if (next.poster) setPoster(next.poster);
    if (next.posters && !locked) {
      if (!rotation) rotation = rotatePoster({ host: poster, before: badges, urls: next.posters });
      else rotation.setUrls(next.posters);
    }
    if (next.rating !== undefined) setRating(next.rating);
    if (next.favorite !== undefined) favoriteBadge.classList.toggle('visible', Boolean(next.favorite));
    if (next.status !== undefined) setStatus(next.status);
    if (next.progress !== undefined) {
      el.classList.toggle('has-progress', next.progress > 0);
      bar.firstChild.style.width = `${Math.round(Math.min(1, Math.max(0, next.progress)) * 100)}%`;
    }
  }

  if (entry && (entry.isGroup || entry.isNetwork)) setStatus(null);
  const fields = { ...meta };
  delete fields.placeholder;
  delete fields.square;
  // A network says how many items (channels and groups) it holds, like a collection.
  const units = entry.isNetwork ? (entry.memberKeys || []).length : 0;
  update({ title: entry.name, poster: entry.icon, ...(entry.icons && entry.icons.length > 1 ? { posters: entry.icons } : {}), rating: entry.rating, year: entry.year, ...(units ? { subtitle: t('collections.items', { count: units }) } : {}), ...fields });
  return { el, update };
}
