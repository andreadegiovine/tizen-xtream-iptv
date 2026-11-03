import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { icon } from '../icons.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createCarousel } from '../components/carousel.js';
import { createSelectField } from '../components/selectField.js';
import { getEntry, listCategories } from '../../services/catalogQuery.js';
import { watchKey, shouldResume, isWatched } from '../../services/watchStore.js';
import { formatClock } from '../../services/playerController.js';
import { formatRating } from '../components/card.js';
import { openTrailer, youtubeId } from '../../services/trailer.js';
import { mergeGenres } from '../../services/genres.js';
import { log } from '../../core/logger.js';

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

/** "112" → "1h 52m", "45" → "45 min". */
export function formatRuntime(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (total <= 0) return '';
  if (total < 60) return t('detail.minutes', { count: total });
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

const plural = (key, count) => t(`${key}.${count === 1 ? 'one' : 'other'}`, { count });
export const seasonsLabel = (count) => plural('detail.seasons', count);
export const episodesLabel = (count) => plural('detail.episodes', count);

/**
 * Line under the title: year, rating, then duration (movies) or seasons + episodes (series).
 * Returns [{ kind: 'text' | 'rating', text }] so the rating can get its star icon.
 */
export function detailMetaParts({ type, year, rating, runtime, seasons, episodes }) {
  const parts = [];
  if (year) parts.push({ kind: 'text', text: String(year) });
  const stars = formatRating(rating);
  if (stars) parts.push({ kind: 'rating', text: stars });
  if (type === 'movie') {
    const text = formatRuntime(runtime);
    if (text) parts.push({ kind: 'text', text });
  } else if (type === 'series') {
    if (seasons) parts.push({ kind: 'text', text: seasonsLabel(seasons) });
    if (episodes) parts.push({ kind: 'text', text: episodesLabel(episodes) });
  }
  return parts;
}

/** Cast cards: TMDB credits when available, otherwise the provider's comma separated names. */
export function castFrom(meta, info) {
  if (meta && meta.castList && meta.castList.length) return meta.castList;
  const names = String((info && info.cast) || '')
    .split(/[,;]/)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.slice(0, 20).map((name) => ({ name, character: '', photo: '' }));
}

/** Genres as separate tags: "Action, Drama / Thriller" → ['Action', 'Drama', 'Thriller']. */
export function tagsFrom(meta, info) {
  const raw = (meta && meta.genre) || (info && info.genre) || '';
  return Array.from(new Set(String(raw).split(/[,/|]/).map((tag) => tag.trim()).filter(Boolean))).slice(0, 8);
}

/** "Stagione 1 (10 episodi)" */
export const seasonOptionLabel = (season) => t('detail.seasonOption', { season: season.season, count: episodesLabel(season.episodes.length) });

/** Season index to show first: the one holding the episode that plays next. */
export function seasonIndexOf(seasons, episode) {
  const index = episode ? seasons.findIndex((s) => s.season === episode.season) : 0;
  return Math.max(0, index);
}

/** Movie / series / channel page. params: { entryKey, type, live?: { categoryId, offset } } */
export function createDetailPage(ctx, params) {
  let entry = null;
  let providerId = null;
  let info = null; // provider details (plot, cast, seasons...)
  let meta = null; // TMDB (localized text, rating, credits)
  let categoryItems = []; // [{ id, name }]
  let related = []; // catalog entries "you might also like"
  let favorite = false;
  let selectedMember = null;
  let seasonIndex = 0;
  let seasonChosen = false;
  let records = [];
  let rows = []; // vertical chain of focus zones: { id, zone }
  let destroyed = false;
  let focusedOnce = false;

  const poster = h('div', { class: 'detail-poster' });
  const titleEl = h('h1', { class: 'detail-title' });
  const metaEl = h('p', { class: 'detail-meta' });
  const versionEl = h('div', { class: 'detail-version' });
  const plotEl = h('p', { class: 'detail-plot' });
  const actionsEl = h('div', { class: 'detail-actions' });
  const categoriesEl = h('div', { class: 'detail-categories' });
  const tagsEl = h('div', { class: 'detail-categories' });
  const episodesEl = h('div', { class: 'detail-section' });
  const castEl = h('div', { class: 'detail-section' });
  const relatedEl = h('div', { class: 'detail-section' });
  const epgEl = h('div', { class: 'detail-epg' });
  const el = h(
    'section',
    { class: 'page detail' },
    poster,
    h('div', { class: 'detail-body' }, titleEl, metaEl, versionEl, actionsEl, plotEl, categoriesEl, tagsEl, epgEl, episodesEl, castEl, relatedEl),
  );

  const data = () => ({
    title: (meta && meta.title) || (entry && entry.name) || '',
    year: (entry && entry.year) || (meta && meta.year) || (info && info.year) || null,
    rating: (entry && entry.rating) || (meta && meta.rating) || null,
    runtime: (meta && meta.runtime) || (info && info.duration ? Math.round(info.duration / 60) : null),
    seasons: (info && info.seasons && info.seasons.length) || (meta && meta.seasons) || null,
    episodes: (info && info.episodeCount) || (meta && meta.episodes) || null,
  });

  function play({ list, startIndex, restart = false, ext, id }) {
    const playlist = list || [{ id: id || (selectedMember ? selectedMember.id : entry.defaultId), ext: ext !== undefined ? ext : selectedMember ? selectedMember.ext : '', title: '' }];
    ctx.router.push('player', {
      type: entry.type,
      entryKey: entry.key,
      title: data().title,
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
      title: t('detail.version'),
      options: entry.members.map((m) => ({ label: streamLabel(m), value: m.id })),
      selected: selectedMember.id,
    });
    if (value === null || destroyed) return;
    selectedMember = entry.members.find((m) => m.id === value);
    build();
  }

  async function chooseSeason() {
    const value = await ctx.dialogs.choose({
      title: t('detail.season'),
      options: info.seasons.map((s, i) => ({ label: seasonOptionLabel(s), value: i })),
      selected: seasonIndex,
    });
    if (value === null || destroyed) return;
    seasonIndex = value;
    seasonChosen = true;
    build();
  }

  /** Icon-only button row (play / resume) with its own horizontal zone. */
  function createActions(buttons, initial) {
    const nodes = buttons.map((b) => h('button', { class: `icon-btn${b.active ? ' active' : ''}`, type: 'button', 'aria-label': b.label }, icon(b.icon)));
    while (actionsEl.firstChild) actionsEl.removeChild(actionsEl.firstChild);
    nodes.forEach((n) => actionsEl.appendChild(n));
    if (buttons.note) actionsEl.appendChild(h('span', { class: 'detail-note', text: buttons.note }));
    const zone = new FocusZone({
      id: 'detailActions',
      model: new ListModel({ orientation: 'horizontal', getCount: () => nodes.length }),
      onFocus: (i) => {
        nodes[i].classList.add('focused');
        ensureVisible(actionsEl, { margin: 24 });
      },
      onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
      onActivate: (i) => buttons[i].run(),
    });
    zone.index = initial;
    return zone;
  }

  function setRows(next) {
    const keep = ctx.focus.activeId && rows.some((r) => r.id === ctx.focus.activeId) ? { id: ctx.focus.activeId, index: ctx.focus.active.index } : null;
    rows.forEach((r) => ctx.focus.unregister(r.id));
    rows = next;
    if (rows.length) {
      // Reaching the first row scrolls the whole page back up (title and subtitle included).
      const first = rows[0].zone;
      const original = first.onFocus;
      first.onFocus = (i) => {
        original(i);
        el.scrollTop = 0;
      };
    }
    rows.forEach((r, i) => {
      ctx.focus.register(r.zone);
      ctx.focus.link(r.id, 'up', i === 0 ? TOPBAR_ZONE : rows[i - 1].id);
      if (i < rows.length - 1) ctx.focus.link(r.id, 'down', rows[i + 1].id);
    });
    if (rows.length) ctx.focus.link(TOPBAR_ZONE, 'down', rows[0].id);
    const target = keep && rows.find((r) => r.id === keep.id);
    if (target) ctx.focus.focus(target.id, keep.index);
    else if (rows.length && !focusedOnce) {
      const actions = rows.find((r) => r.id === 'detailActions') || rows[0];
      focusedOnce = true;
      ctx.focus.focus(actions.id, actions.zone.index);
    }
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** Genres as [{ id, name }]: provider and TMDB spellings merged into the sidebar's keys, all clickable. */
  function genreItems() {
    return mergeGenres(entry && entry.genres, info && info.genre, meta && meta.genreList).map((g) => ({ id: g.key, name: g.name }));
  }

  /** A row of chips; the clickable ones form a horizontal focus zone that opens the matching browse view. */
  function renderChips(container, zoneId, chipItems, kind, next) {
    clear(container);
    const nodes = chipItems.map((item) => h('span', { class: `chip${item.id !== undefined ? ' link' : ''}`, text: item.name }));
    nodes.forEach((node) => container.appendChild(node));
    const links = chipItems.map((item, i) => ({ item, node: nodes[i] })).filter(({ item }) => item.id !== undefined && item.id !== null);
    if (!links.length) return;
    const zone = new FocusZone({
      id: zoneId,
      model: new ListModel({ orientation: 'horizontal', getCount: () => links.length }),
      onFocus: (i) => {
        links[i].node.classList.add('focused');
        ensureVisible(container, { margin: 24 });
      },
      onBlur: (i) => links[i] && links[i].node.classList.remove('focused'),
      onActivate: (i) => {
        const section = { movie: 'movies', series: 'series', live: 'live' }[entry.type];
        ctx.router.push('browse', { type: entry.type, section, filter: { kind, id: String(links[i].item.id) } });
      },
    });
    next.push({ id: zoneId, zone });
  }

  function renderCategories(next) {
    renderChips(categoriesEl, 'detailCategories', categoryItems, 'category', next);
    renderChips(tagsEl, 'detailGenres', entry.type === 'live' ? [] : genreItems(), 'genre', next);
  }

  function renderCast(next) {
    clear(castEl);
    const people = castFrom(meta, info);
    if (!people.length || entry.type === 'live') return;
    const carousel = createCarousel({
      id: 'detailCast',
      title: t('detail.cast'),
      className: 'cast',
      items: people.map((p) => ({ entry: { name: p.name, icon: p.photo }, type: 'cast', meta: { subtitle: p.character, placeholder: 'user' } })),
      onOpen: null, // not clickable yet
    });
    castEl.appendChild(carousel.el);
    next.push({ id: 'detailCast', zone: carousel.zone });
  }

  function renderRelated(next) {
    clear(relatedEl);
    if (!related.length) return;
    const carousel = createCarousel({
      id: 'detailRelated',
      title: t('detail.related'),
      items: related.map((item) => ({ entry: item, type: item.type })),
      onOpen: (item) => ctx.openEntry(item.entry, { section: params.section }),
    });
    relatedEl.appendChild(carousel.el);
    next.push({ id: 'detailRelated', zone: carousel.zone });
    if (ctx.enrich) ctx.enrich(related, carousel.cards, entry.type, true);
  }

  function renderEpisodes(next, episodes) {
    clear(episodesEl);
    if (entry.type !== 'series' || !info) return;
    if (!episodes.length) {
      episodesEl.appendChild(h('p', { class: 'muted', text: t('detail.noEpisodes') }));
      return;
    }
    const season = info.seasons[seasonIndex];
    const select = createSelectField({ id: 'detailSeason', label: '', text: seasonOptionLabel(season), onOpen: chooseSeason });
    episodesEl.appendChild(select.el);
    next.push({ id: 'detailSeason', zone: select.zone });
    const carousel = createCarousel({
      id: 'detailEpisodes',
      title: '',
      className: 'episodes',
      items: season.episodes.map((episode) => {
        const rec = records.find((r) => r.episodeKey === `s${episode.season}e${episode.number}`);
        return {
          episode,
          entry: { name: `${episode.number}. ${episode.title || t('detail.episode')}`, icon: episode.icon },
          type: 'episode',
          meta: {
            subtitle: episode.duration ? formatClock(episode.duration) : '',
            status: rec && rec.watched ? 'watched' : null,
            progress: rec && !rec.watched && rec.duration ? rec.position / rec.duration : 0,
          },
        };
      }),
      onOpen: (item) => play({ list: episodes, startIndex: episodes.indexOf(item.episode) }),
    });
    episodesEl.appendChild(carousel.el);
    next.push({ id: 'detailEpisodes', zone: carousel.zone });
  }

  function isEntryWatched(episodes) {
    if (entry.type === 'series') {
      return episodes.length > 0 && episodes.every((ep) => records.some((r) => r.episodeKey === `s${ep.season}e${ep.number}` && r.watched));
    }
    return Boolean(records[0] && records[0].watched);
  }

  async function reloadRecords() {
    if (entry.type === 'series') records = (await ctx.watch.recentForEntry(entry.key)) || [];
    else {
      const rec = await ctx.watch.get(watchKey(providerId, entry.key));
      records = rec ? [rec] : [];
    }
  }

  /** "Seen" button: marks the movie (or every episode) as watched, or forgets its history again. */
  async function toggleWatched(episodes, watched) {
    try {
      if (watched) await ctx.watch.clearEntry(providerId, entry.key);
      else {
        const base = { providerId, entryKey: entry.key, type: entry.type, title: data().title, icon: entry.icon || '' };
        const list = entry.type === 'series'
          ? episodes.map((ep) => ({ ...base, key: watchKey(providerId, entry.key, `s${ep.season}e${ep.number}`), episodeKey: `s${ep.season}e${ep.number}`, episodeTitle: ep.title }))
          : [{ ...base, key: watchKey(providerId, entry.key) }];
        await ctx.watch.markWatched(list);
      }
      await reloadRecords();
      if (!destroyed) build();
    } catch (err) {
      log.warn('Mark watched failed', err && err.message);
    }
  }

  async function toggleFavorite() {
    try {
      favorite = await ctx.favorites.toggle(providerId, entry.key, entry.type);
      if (!destroyed) build();
    } catch (err) {
      log.warn('Favorite failed', err && err.message);
    }
  }

  function build() {
    if (!entry) return;
    const next = [];
    const episodes = entry.type === 'series' && info && info.seasons ? flattenEpisodes(info.seasons) : [];

    // Version dropdown, right under the subtitle and before the plot.
    clear(versionEl);
    if (entry.type === 'movie' && entry.members.length > 1) {
      const select = createSelectField({ id: 'detailVersion', label: '', text: `${streamLabel(selectedMember)} (${entry.members.length})`, onOpen: chooseStream });
      versionEl.appendChild(select.el);
      next.push({ id: 'detailVersion', zone: select.zone });
    }

    // Icon-only buttons: play, trailer, resume, watched, favourite.
    const buttons = [];
    let note = '';
    let canResume = false;
    let startIndex = 0;
    if (entry.type === 'series') {
      if (episodes.length) {
        const pick = pickNextEpisode(episodes, records);
        startIndex = episodes.indexOf(pick.episode);
        canResume = Boolean(pick.record && shouldResume(pick.record.position, pick.record.duration));
        note = `S${pick.episode.season}E${pick.episode.number}${canResume ? ` · ${formatClock(pick.record.position)}` : ''}`;
        buttons.push({ id: 'play', icon: 'play', label: t('detail.play'), run: () => play({ list: episodes, startIndex, restart: true }) });
      }
    } else {
      const record = records[0];
      canResume = Boolean(record && shouldResume(record.position, record.duration));
      if (canResume) note = formatClock(record.position);
      buttons.push({ id: 'play', icon: 'play', label: t('detail.play'), run: () => play({ restart: true }) });
    }
    if (buttons.length && info && youtubeId(info.trailer)) {
      buttons.push({ id: 'trailer', icon: 'trailer', label: t('detail.trailer'), run: () => openTrailer(info.trailer) });
    }
    if (canResume) {
      buttons.push({ id: 'resume', icon: 'resume', label: t('detail.resume'), run: () => (entry.type === 'series' ? play({ list: episodes, startIndex }) : play({})) });
    }
    const watched = isEntryWatched(episodes);
    if (buttons.length && entry.type !== 'live') {
      buttons.push({ id: 'watched', icon: 'check', active: watched, label: watched ? t('detail.unwatched') : t('detail.watched'), run: () => toggleWatched(episodes, watched) });
    }
    if (buttons.length) {
      buttons.push({ id: 'favorite', icon: 'heart', active: favorite, label: favorite ? t('detail.unfavorite') : t('detail.favorite'), run: toggleFavorite });
    }
    buttons.note = note;
    const resumeAt = buttons.findIndex((b) => b.id === 'resume'); // resume is the natural default when it exists
    if (buttons.length) next.push({ id: 'detailActions', zone: createActions(buttons, Math.max(0, resumeAt)) });
    else clear(actionsEl);

    renderCategories(next);
    renderEpisodes(next, episodes);
    renderCast(next);
    renderRelated(next);
    setRows(next);
  }

  function fillText() {
    const d = data();
    titleEl.textContent = d.title;
    clear(metaEl);
    detailMetaParts({ type: entry && entry.type, ...d }).forEach((part, i) => {
      if (i > 0) metaEl.appendChild(h('span', { class: 'meta-sep', text: '·' }));
      if (part.kind === 'rating') metaEl.appendChild(h('span', { class: 'meta-rating' }, icon('star'), h('span', { text: part.text })));
      else metaEl.appendChild(h('span', { text: part.text }));
    });
    plotEl.textContent = (meta && meta.overview) || (info && info.plot) || '';
    const img = (meta && meta.poster) || (info && info.cover) || (entry && entry.icon);
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
    try {
      const categories = await listCategories(current.db, entry.type);
      const names = new Map(categories.map((c) => [c.id, c.name]));
      categoryItems = (entry.categoryIds || []).filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id) }));
    } catch (err) {
      log.warn('Categories failed', err && err.message);
    }
    fillText();
    favorite = await ctx.favorites.has(providerId, entry.key);
    await reloadRecords();
    build();

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
    if (entry.type === 'series' && info.seasons && info.seasons.length && !seasonChosen) {
      seasonIndex = seasonIndexOf(info.seasons, pickNextEpisode(flattenEpisodes(info.seasons), records).episode);
    }
    fillText();
    build();
    if (ctx.meta) {
      try {
        meta = await ctx.meta.forEntry(entry);
      } catch (err) {
        log.warn('Metadata failed', err && err.message);
      }
      if (destroyed) return;
      if (meta) {
        fillText();
        build();
      }
    }
    if (ctx.suggestions && entry.type !== 'live') {
      try {
        related = await ctx.suggestions.forEntry(entry, { tmdbId: meta && meta.tmdbId, limit: 20 });
      } catch (err) {
        log.warn('Related failed', err && err.message);
      }
      if (destroyed) return;
      if (related.length) build();
    }
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
      load().catch((err) => log.warn('Detail load failed', err && err.message));
    },
    destroy() {
      destroyed = true;
      rows.forEach((r) => ctx.focus.unregister(r.id));
      rows = [];
    },
    saveState: () => ({}),
    restoreState() {
      /* focus is restored by load(): records refresh after returning from the player */
    },
  };
}

export { isWatched };
