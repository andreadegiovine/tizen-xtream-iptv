import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { getEntry } from '../../services/catalogQuery.js';
import { watchKey, shouldResume, isWatched } from '../../services/watchStore.js';
import { formatClock } from '../../services/playerController.js';
import { log } from '../../core/logger.js';

const ZONE_ID = 'detail';

/** Label of one stream choice: "#123 · mkv". */
export const streamLabel = (member) => `#${member.id}${member.ext ? ` · ${member.ext}` : ''}`;

/** Flat, ordered episode list across seasons. */
export function flattenEpisodes(seasons) {
  return seasons.flatMap((s) => s.episodes);
}

/** Next up for a series: the most recently watched unfinished episode, otherwise the first unwatched, otherwise the first. */
export function pickNextEpisode(episodes, records) {
  const byKey = new Map(records.map((r) => [r.episodeKey, r]));
  const keyOf = (ep) => `s${ep.season}e${ep.number}`;
  const unfinished = records
    .filter((r) => !r.watched && episodes.some((ep) => keyOf(ep) === r.episodeKey))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (unfinished) return { episode: episodes.find((ep) => keyOf(ep) === unfinished.episodeKey), record: unfinished };
  const firstNew = episodes.find((ep) => !(byKey.get(keyOf(ep)) || {}).watched);
  return { episode: firstNew || episodes[0], record: null };
}

/** Movie / series / channel page. params: { entryKey, type, live?: { categoryId, offset } } */
export function createDetailPage(ctx, params) {
  let entry = null;
  let providerId = null;
  let info = null; // provider details (plot, genre...) or series info
  let selectedMember = null;
  let seasonIndex = 0;
  let records = [];
  let items = []; // focusable rows: { el, activate }
  let destroyed = false;
  let focusedOnce = false; // the first time rows exist the page takes the focus (series rows arrive late)

  const poster = h('div', { class: 'detail-poster' });
  const titleEl = h('h1', { class: 'detail-title' });
  const metaEl = h('p', { class: 'muted detail-meta' });
  const plotEl = h('p', { class: 'detail-plot' });
  const actions = h('div', { class: 'detail-actions' });
  const episodesEl = h('div', { class: 'detail-episodes' });
  const epgEl = h('div', { class: 'detail-epg' });
  const el = h('section', { class: 'page detail' }, poster, h('div', { class: 'detail-body' }, titleEl, metaEl, plotEl, actions, epgEl, episodesEl));

  const zone = new FocusZone({
    id: ZONE_ID,
    model: new ListModel({ orientation: 'vertical', getCount: () => items.length }),
    onFocus: (i) => {
      if (!items[i]) return;
      items[i].el.classList.add('focused');
      ensureVisible(items[i].el, { first: i === 0 });
    },
    onBlur: (i) => items[i] && items[i].el.classList.remove('focused'),
    onActivate: (i) => items[i] && items[i].activate(),
  });

  const button = (text, activate, primary = false) => ({ el: h('button', { class: `btn${primary ? ' primary' : ''}`, type: 'button', text }), activate });
  const row = (label, value, activate) => ({
    el: h('div', { class: 'row detail-row' }, h('span', { text: label }), h('span', { class: 'value', text: value })),
    activate,
  });

  function play({ list, startIndex, restart = false, ext, id }) {
    const playlist = list || [{ id: id || (selectedMember ? selectedMember.id : entry.defaultId), ext: ext !== undefined ? ext : selectedMember ? selectedMember.ext : '', title: '' }];
    ctx.router.push('player', {
      type: entry.type,
      entryKey: entry.key,
      title: (info && info.title) || entry.name,
      icon: entry.icon,
      playlist,
      index: startIndex || 0,
      restart,
      live: params.live || null,
      epgChannelId: entry.epgChannelId,
      section: params.section,
    });
  }

  async function chooseStream() {
    const value = await ctx.dialogs.choose({
      title: t('detail.streams'),
      options: entry.members.map((m) => ({ label: streamLabel(m), value: m.id })),
      selected: selectedMember.id,
    });
    if (value === null || destroyed) return;
    selectedMember = entry.members.find((m) => m.id === value);
    build(zone.index);
  }

  async function chooseSeason() {
    const value = await ctx.dialogs.choose({
      title: t('detail.season'),
      options: info.seasons.map((s, i) => ({ label: `${t('detail.season')} ${s.season}`, value: i })),
      selected: seasonIndex,
    });
    if (value === null || destroyed) return;
    seasonIndex = value;
    build(zone.index);
  }

  function build(focusIndex = 0) {
    items = [];
    while (actions.firstChild) actions.removeChild(actions.firstChild);
    while (episodesEl.firstChild) episodesEl.removeChild(episodesEl.firstChild);
    if (!entry) return;

    if (entry.type === 'series') {
      const episodes = info && info.seasons ? flattenEpisodes(info.seasons) : [];
      if (episodes.length) {
        const next = pickNextEpisode(episodes, records);
        const label = next.record && shouldResume(next.record.position, next.record.duration) ? t('detail.resume') : t('detail.play');
        const ep = next.episode;
        items.push(button(`${label} · S${ep.season}E${ep.number}`, () => play({ list: episodes, startIndex: episodes.indexOf(ep) }), true));
        items.push(row(t('detail.season'), `${info.seasons[seasonIndex].season} / ${info.seasons.length}`, chooseSeason));
        info.seasons[seasonIndex].episodes.forEach((episode) => {
          const rec = records.find((r) => r.episodeKey === `s${episode.season}e${episode.number}`);
          const mark = rec && rec.watched ? '✓ ' : '';
          const progress = rec && !rec.watched && rec.position > 0 ? ` · ${formatClock(rec.position)}` : '';
          const epRow = row(`${mark}${episode.number}. ${episode.title || t('detail.episode')}`, `${episode.duration ? formatClock(episode.duration) : ''}${progress}`, () => play({ list: episodes, startIndex: episodes.indexOf(episode) }));
          epRow.into = episodesEl;
          items.push(epRow);
        });
      } else if (info) {
        episodesEl.appendChild(h('p', { class: 'muted', text: t('detail.noEpisodes') }));
      }
    } else {
      const record = records[0];
      const resumable = record && shouldResume(record.position, record.duration);
      items.push(button(resumable ? `${t('detail.resume')} · ${formatClock(record.position)}` : t('detail.play'), () => play({}), true));
      if (resumable) items.push(button(t('detail.restart'), () => play({ restart: true })));
      if (entry.type === 'movie' && entry.members.length > 1) {
        items.push(row(t('detail.streams'), `${streamLabel(selectedMember)} (${entry.members.length})`, chooseStream));
      }
    }
    items.forEach((item) => (item.into || actions).appendChild(item.el));
    if (items.length && (ctx.focus.activeId === ZONE_ID || !focusedOnce)) {
      focusedOnce = true;
      ctx.focus.focus(ZONE_ID, Math.min(focusIndex, items.length - 1));
    }
  }

  function fillText() {
    const title = (info && info.title) || (entry && entry.name) || '';
    titleEl.textContent = title;
    const bits = [];
    if (entry && entry.year) bits.push(String(entry.year));
    if (entry && entry.rating) bits.push(`★ ${entry.rating.toFixed(1)}`);
    if (info && info.genre) bits.push(info.genre);
    if (info && info.runtime) bits.push(`${info.runtime} min`);
    metaEl.textContent = bits.join(' · ');
    plotEl.textContent = (info && (info.overview || info.plot)) || '';
    const img = (info && info.poster) || (entry && entry.icon);
    if (img && !poster.firstChild) {
      const node = h('img', { src: img, alt: '', referrerpolicy: 'no-referrer' });
      node.addEventListener('error', () => node.remove());
      poster.appendChild(node);
    }
  }

  async function load() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    providerId = current.provider.id;
    entry = await getEntry(current.db, params.entryKey);
    if (!entry || destroyed) return;
    selectedMember = entry.members.find((m) => m.id === entry.defaultId) || entry.members[0];
    fillText();
    if (entry.type === 'series') {
      records = (await ctx.watch.recentForEntry(entry.key)) || [];
    } else {
      const rec = await ctx.watch.get(watchKey(providerId, entry.key));
      records = rec ? [rec] : [];
    }
    build(0);

    // Slow parts arrive later and refresh the page in place.
    try {
      if (entry.type === 'series') info = { ...(await ctx.details.series(entry.defaultId)) };
      else if (entry.type === 'movie') info = { ...(await ctx.details.vod(entry.defaultId)) };
      else info = {};
    } catch (err) {
      log.warn('Details failed', err && err.message);
      info = info || {};
    }
    if (destroyed) return;
    if (ctx.meta) {
      try {
        const meta = await ctx.meta.forEntry(entry);
        if (meta) {
          // TMDB (localized) wins over the provider's text, but never replaces a value with an empty one.
          const filled = Object.fromEntries(Object.entries(meta).filter(([, v]) => v));
          info = { ...info, ...filled };
        }
      } catch (err) {
        log.warn('Metadata failed', err && err.message);
      }
    }
    if (destroyed) return;
    fillText();
    build(zone.index);
    if (entry.type === 'live' && ctx.epg) loadEpg();
  }

  async function loadEpg() {
    try {
      const list = await ctx.epg.upcoming(entry.epgChannelId);
      if (destroyed || !list.length) return;
      epgEl.appendChild(h('h2', { text: t('detail.epg') }));
      list.forEach((p) => {
        epgEl.appendChild(h('div', { class: 'epg-row' }, h('span', { class: 'epg-time', text: new Date(p.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }), h('span', { text: p.title })));
      });
    } catch (err) {
      log.warn('EPG failed', err && err.message);
    }
  }

  return {
    el,
    mount() {
      ctx.focus.register(zone);
      ctx.focus.link(ZONE_ID, 'up', TOPBAR_ZONE);
      ctx.focus.link(TOPBAR_ZONE, 'down', ZONE_ID);
      load().catch((err) => log.warn('Detail load failed', err && err.message));
    },
    destroy() {
      destroyed = true;
      ctx.focus.unregister(ZONE_ID);
    },
    saveState: () => ({ index: zone.index }),
    restoreState() {
      /* focus is restored by load(): records refresh after returning from the player */
    },
  };
}

export { isWatched };
