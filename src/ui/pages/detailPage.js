import { h } from '../dom.js';
import { cssUrl } from '../cssUrl.js';
import { isEmptySeries, markUnavailable } from '../../services/unavailable.js';
import { scheduleId, LEAD_MS } from '../../services/scheduledViewing.js';
import { formatClockTime } from '../../core/clock.js';
import { t, i18n } from '../../i18n/index.js';
import { icon } from '../icons.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { TOPBAR_ZONE } from '../components/topbar.js';
import { ensureVisible } from '../scroll.js';
import { createCarousel } from '../components/carousel.js';
import { createSelectField } from '../components/selectField.js';
import { getEntry, listCategories, listNetworks, createMergeSearch } from '../../services/catalogQuery.js';
import { rebuildLive } from '../../services/rebuildLive.js';
import { watchKey, shouldResume, isWatched } from '../../services/watchStore.js';
import { formatClock } from '../../services/playerController.js';
import { formatRating } from '../components/card.js';
import { youtubeId } from '../../services/trailer.js';
import { mergeGenres } from '../../services/genres.js';
import { addToCollection } from '../components/collectionFlows.js';
import { log } from '../../core/logger.js';

/** Label of one stream choice: the channel's own name for grouped channels, otherwise "#123 · mkv". */
export const streamLabel = (member) => member.name || `#${member.id}${member.ext ? ` · ${member.ext}` : ''}`;

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

export const seasonsLabel = (count) => t('detail.seasons', { count });
export const episodesLabel = (count) => t('detail.episodes', { count });

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
/** Index of the programme to focus when the page is opened from the guide on the one starting at `start`: that one, else the one on at that time, else the first after it, else the first. */
export function landingIndex(list, start) {
  const exact = list.findIndex((p) => p.start === start);
  if (exact >= 0) return exact;
  const after = list.findIndex((p) => p.stop > start);
  return after >= 0 ? after : 0;
}

export function createDetailPage(ctx, params) {
  let entry = null;
  let providerId = null;
  let info = null; // provider details (plot, cast, seasons...)
  let meta = null; // TMDB (localized text, rating, credits)
  let categoryItems = []; // [{ id, name }]
  let collectionItems = []; // collections that hold this title: [{ id, name }]
  let categoryNames = new Map();
  let db = null;
  let mergeAvailable = false; // grouping is on: a single channel can be merged by hand
  let networkChoices = []; // Live TV networks a channel can be added to: [{ key, name, networkId }]
  let manualIds = new Set(); // streams added to a group by hand
  let related = []; // catalog entries "you might also like"
  let favorite = false;
  let selectedMember = null;
  let seasonIndex = 0;
  let seasonChosen = false;
  let records = [];
  let rows = []; // vertical chain of focus zones: { id, zone }
  let destroyed = false;
  let focusedOnce = false;
  let autoFocus = null; // { id, index } of a row the page focused by itself before the play button existed
  // Opened from the guide on a programme: once the list is there, the focus starts on it (its start time, or null).
  let landOn = typeof params.programme === 'number' ? params.programme : null;

  let backdropUrl = '';
  let posterUrl = '';
  const poster = h('div', { class: 'detail-poster loading' });
  const backdropEl = h('div', { class: 'detail-backdrop' });
  const titleEl = h('h1', { class: 'detail-title' });
  const metaEl = h('p', { class: 'detail-meta' });
  const versionEl = h('div', { class: 'detail-version' });
  const plotEl = h('p', { class: 'detail-plot' });
  const actionsEl = h('div', { class: 'detail-actions' });
  const collectionsEl = h('div', { class: 'detail-categories' });
  const categoriesEl = h('div', { class: 'detail-categories' });
  const tagsEl = h('div', { class: 'detail-categories' });
  const directorEl = h('div', { class: 'detail-categories' });
  const companiesEl = h('div', { class: 'detail-categories' });
  const episodesEl = h('div', { class: 'detail-section' });
  const castEl = h('div', { class: 'detail-section' });
  const relatedEl = h('div', { class: 'detail-section' });
  const epgEl = h('div', { class: 'detail-epg' });
  const el = h(
    'section',
    { class: 'page detail loading' },
    backdropEl,
    poster,
    h('div', { class: 'detail-body' }, titleEl, metaEl, versionEl, actionsEl, plotEl, collectionsEl, categoriesEl, tagsEl, directorEl, companiesEl, epgEl, episodesEl, castEl, relatedEl),
  );

  const data = () => ({
    title: (meta && meta.title) || (entry && entry.name) || '',
    year: (meta && meta.year) || (entry && entry.year) || (info && info.year) || null,
    rating: (meta && meta.rating) || (entry && entry.rating) || null,
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

  /** The trailer plays in the app's own player (same controls as a film, without aspect ratio and subtitles). */
  function playTrailer(videoId) {
    ctx.router.push('player', { type: 'trailer', trailer: { videoId }, entryKey: entry.key, title: data().title, playlist: [{ id: '', ext: '', title: t('detail.trailer') }], index: 0, section: params.section });
  }

  async function chooseStream() {
    const value = await ctx.dialogs.choose({
      title: t('detail.version'),
      options: entry.members.map((m) => ({ label: streamLabel(m), value: m.id })),
      selected: selectedMember.id,
    });
    if (value === null || destroyed) return;
    selectedMember = entry.members.find((m) => m.id === value);
    updateCategoryItems();
    fillText(); // the picture follows the version
    build();
  }

  /** The categories shown are the ones of the version that is selected (a grouped channel changes them with the version). */
  function updateCategoryItems() {
    const ids = entry.isGroup && selectedMember ? [selectedMember.categoryId] : entry.categoryIds || [];
    categoryItems = ids.filter((id) => categoryNames.has(id)).map((id) => ({ id, name: categoryNames.get(id) }));
  }

  /** The collections that hold this title, as chips before the categories. */
  async function loadCollections() {
    if (!ctx.collections || !entry) return;
    collectionItems = (await ctx.collections.list(providerId)).filter((c) => c.entryKeys.includes(entry.key)).map((c) => ({ id: c.id, name: c.name }));
    if (!destroyed) build();
  }

  /** Merges this channel with another one (or with a group) chosen in a search box; the link is kept across syncs. */
  async function mergeChannel() {
    const picked = await ctx.dialogs.search({ title: t('merge.title'), placeholder: t('search.placeholder'), emptyLabel: t('common.empty'), minLength: 0, autoFocus: false, run: createMergeSearch(db, entry.defaultId) });
    if (!picked || destroyed) return;
    try {
      await ctx.liveGrouping.link(providerId, entry.defaultId, picked.memberId, picked.group);
      await rebuildLive(ctx);
      manualIds = await ctx.liveGrouping.manual(providerId);
      entry = (await getEntry(db, entry.key)) || entry;
      if (!destroyed) build();
      ctx.notices.success(t('notice.done'), { key: 'merge' });
    } catch (err) {
      log.warn('Merge failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'merge' });
    }
  }

  /** Adds this channel (or every version of this group) to a network chosen in the search box; the link is kept across syncs. */
  async function addToNetwork() {
    const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const picked = await ctx.dialogs.search({
      title: t('networks.add'),
      placeholder: t('search.placeholder'),
      emptyLabel: t('common.empty'),
      minLength: 0,
      autoFocus: false,
      run: async (text) => networkChoices.filter((n) => !text || fold(n.name).includes(fold(text))).map((n) => ({ key: n.key, name: n.name, networkId: n.networkId })),
    });
    if (!picked || destroyed) return;
    try {
      await ctx.liveGrouping.linkNetwork(providerId, entry.isGroup ? entry.memberIds : [entry.defaultId], picked.networkId);
      await rebuildLive(ctx);
      entry = (await getEntry(db, entry.key)) || entry;
      if (!destroyed) build();
      ctx.notices.success(t('notice.added'), { key: 'network' });
    } catch (err) {
      log.warn('Add to network failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'network' });
    }
  }

  /** A channel that is in a group: opens the group's page. */
  async function openGroup() {
    const group = await getEntry(db, entry.groupKey);
    if (group && !destroyed) ctx.openEntry(group, { section: params.section });
  }

  /** Takes the selected version out of the group, when it was added by hand. */
  async function ungroupChannel() {
    const gone = selectedMember;
    try {
      await ctx.liveGrouping.unlink(providerId, gone.id);
      await rebuildLive(ctx);
      manualIds = await ctx.liveGrouping.manual(providerId);
      ctx.notices.success(t('notice.removed'), { key: 'merge' });
      const next = await getEntry(db, entry.key);
      if (destroyed) return;
      if (!next) {
        ctx.router.back(); // the group had only two channels: it is gone
        return;
      }
      entry = next;
      selectedMember = entry.members.find((m) => m.id === entry.defaultId) || entry.members[0];
      updateCategoryItems();
      build();
    } catch (err) {
      log.warn('Ungroup failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'merge' });
    }
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
    const landing = landOn !== null && next.find((r) => r.id === 'detailEpg');
    if (landing) landOn = null; // only the first time the programme list is there
    let keep = ctx.focus.activeId && rows.some((r) => r.id === ctx.focus.activeId) ? { id: ctx.focus.activeId, index: ctx.focus.active.index } : null;
    // The details of a series arrive after the first build: the focus the page chose on its own moves to the play button once it exists.
    const hasActions = next.some((r) => r.id === 'detailActions');
    if (keep && autoFocus && hasActions && keep.id === autoFocus.id && keep.index === autoFocus.index) keep = null;
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
    if (landing) {
      focusedOnce = true;
      autoFocus = null;
      ctx.focus.focus(landing.id, landing.zone.index);
    } else if (target) ctx.focus.focus(target.id, keep.index);
    else if (rows.length && (!focusedOnce || (autoFocus && hasActions))) {
      const actions = rows.find((r) => r.id === 'detailActions') || rows[0];
      focusedOnce = true;
      autoFocus = actions.id === 'detailActions' ? null : { id: actions.id, index: actions.zone.index };
      ctx.focus.focus(actions.id, actions.zone.index);
    }
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** Genres as [{ id, name }]: provider and TMDB spellings merged into the sidebar's keys, all clickable. */
  function genreItems() {
    return mergeGenres(meta && meta.genreList, entry && entry.genres, info && info.genre).map((g) => ({ id: g.key, name: g.name }));
  }

  /** A row of chips; the clickable ones form a horizontal focus zone that opens the matching browse view. */
  function renderChips(container, zoneId, chipItems, kind, next, label, open = null) {
    clear(container);
    if (chipItems.length) container.appendChild(h('span', { class: 'detail-label', text: label }));
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
        if (open) {
          open(links[i].item);
          return;
        }
        const section = { movie: 'movies', series: 'series', live: 'live' }[entry.type];
        ctx.router.push('browse', { type: entry.type, section, filter: { kind, id: String(links[i].item.id) } });
      },
    });
    next.push({ id: zoneId, zone });
  }

  function renderCategories(next) {
    renderChips(collectionsEl, 'detailCollections', collectionItems, 'collection', next, t('nav.collections'), (item) => ctx.router.push('collection', { id: item.id, section: params.section || 'collections' }));
    renderChips(categoriesEl, 'detailCategories', categoryItems, 'category', next, t('detail.categories'));
    renderChips(tagsEl, 'detailGenres', entry.type === 'live' ? [] : genreItems(), 'genre', next, t('detail.genres'));
    renderDirectors();
    renderCompanies();
  }

  /** Director(s) from TMDB, shown before the production companies when known. */
  function renderDirectors() {
    clear(directorEl);
    const list = entry.type === 'live' || !meta || !meta.directors ? [] : meta.directors;
    if (!list.length) return;
    directorEl.appendChild(h('span', { class: 'detail-label', text: t('detail.director') }));
    list.forEach((name) => directorEl.appendChild(h('span', { class: 'chip', text: name })));
  }

  /** Production companies: names as chips, same style as categories and genres but not clickable. */
  function renderCompanies() {
    clear(companiesEl);
    const list = entry.type === 'live' || !meta || !meta.companies ? [] : meta.companies;
    if (!list.length) return;
    companiesEl.appendChild(h('span', { class: 'detail-label', text: t('detail.companies') }));
    list.forEach((company) => companiesEl.appendChild(h('span', { class: 'chip', text: company.name })));
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
            status: rec && rec.watched ? 'watched' : rec && rec.position > 0 ? 'partial' : null,
            progress: rec && !rec.watched && rec.duration ? rec.position / rec.duration : 0,
          },
        };
      }),
      // The focus lands on the episode that plays next, when it is in the season shown.
      startIndex: Math.max(0, season.episodes.indexOf(pickNextEpisode(episodes, records).episode)),
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
    followWatchState();
  }

  /** The season shown (unless the user picked another one) is the one of the episode that plays next, as the watch state now stands. */
  function followWatchState() {
    if (entry.type === 'series' && info && info.seasons && info.seasons.length && !seasonChosen) {
      seasonIndex = seasonIndexOf(info.seasons, pickNextEpisode(flattenEpisodes(info.seasons), records).episode);
    }
  }

  /** "Seen" button: marks the movie (or every episode) as watched, or forgets its history again. */
  async function toggleWatched(episodes, watched) {
    try {
      if (watched) await ctx.watch.clearEntry(providerId, entry.key);
      else {
        const base = { providerId, entryKey: entry.key, type: entry.type, title: data().title, icon: entry.icon || '' };
        const list = entry.type === 'series'
          ? episodes.map((ep) => ({ ...base, key: watchKey(providerId, entry.key, `s${ep.season}e${ep.number}`), episodeKey: `s${ep.season}e${ep.number}`, episodeTitle: ep.title, seriesDone: (meta && meta.episodes) || 1 }))
          : [{ ...base, key: watchKey(providerId, entry.key) }];
        await ctx.watch.markWatched(list);
      }
      await reloadRecords();
      if (!destroyed) build();
      ctx.notices.success(t('notice.done'), { key: 'watched' });
    } catch (err) {
      log.warn('Mark watched failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'watched' });
    }
  }

  async function toggleFavorite() {
    try {
      favorite = await ctx.favorites.toggle(providerId, entry.key, entry.type);
      if (!destroyed) build();
      ctx.notices.success(t(favorite ? 'notice.added' : 'notice.removed'), { key: 'favorite' });
    } catch (err) {
      log.warn('Favorite failed', err && err.message);
      ctx.notices.error(t('error.UNKNOWN'), { key: 'favorite' });
    }
  }

  function build() {
    if (!entry) return;
    const next = [];
    const episodes = entry.type === 'series' && info && info.seasons ? flattenEpisodes(info.seasons) : [];

    // Version dropdown, right under the subtitle and before the plot.
    clear(versionEl);
    if ((entry.type === 'movie' || entry.isGroup) && entry.members.length > 1) {
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
    // The provider's trailer first, otherwise the one TMDB lists for the title.
    const trailerId = (info && youtubeId(info.trailer)) || (meta && meta.trailerKey) || '';
    if (buttons.length && trailerId) buttons.push({ id: 'trailer', icon: 'trailer', label: t('detail.trailer'), run: () => playTrailer(trailerId) });
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
    if (buttons.length) {
      buttons.push({ id: 'collection', icon: 'collectionAdd', label: t('collections.add'), run: async () => {
        if (await addToCollection(ctx, { providerId, entry }) && !destroyed) await loadCollections();
      } });
    }
    if (buttons.length && entry.type === 'live') {
      if (entry.networkKey) buttons.push({ id: 'network', icon: 'network', label: t('networks.open'), run: () => ctx.router.push('network', { key: entry.networkKey, section: params.section }) });
      else if (networkChoices.length) buttons.push({ id: 'networkAdd', icon: 'networkAdd', label: t('networks.add'), run: addToNetwork });
    }
    if (buttons.length && entry.type === 'live' && !entry.isGroup && !entry.groupKey && mergeAvailable) {
      buttons.push({ id: 'merge', icon: 'merge', label: t('merge.title'), run: mergeChannel });
    }
    if (buttons.length && entry.type === 'live' && !entry.isGroup && entry.groupKey) {
      buttons.push({ id: 'group', icon: 'group', label: t('merge.openGroup'), run: openGroup });
    }
    if (buttons.length && entry.isGroup && selectedMember && manualIds.has(selectedMember.id)) {
      buttons.push({ id: 'ungroup', icon: 'remove', label: t('merge.remove'), run: ungroupChannel });
    }
    buttons.note = note;
    if (buttons.length) next.push({ id: 'detailActions', zone: createActions(buttons, 0) });
    else clear(actionsEl);

    renderCategories(next);
    renderEpg(next);
    renderEpisodes(next, episodes);
    renderCast(next);
    renderRelated(next);
    setRows(next);
  }

  function fillText() {
    poster.classList.toggle('square', Boolean(entry && entry.type === 'live'));
    const d = data();
    titleEl.textContent = d.title;
    clear(metaEl);
    detailMetaParts({ type: entry && entry.type, ...d }).forEach((part, i) => {
      if (i > 0) metaEl.appendChild(h('span', { class: 'meta-sep', text: '·' }));
      if (part.kind === 'rating') metaEl.appendChild(h('span', { class: 'meta-rating' }, icon('star'), h('span', { text: part.text })));
      else metaEl.appendChild(h('span', { text: part.text }));
    });
    plotEl.textContent = (meta && meta.overview) || (info && info.plot) || '';
    const logo = entry && entry.isGroup && selectedMember && selectedMember.icon ? selectedMember.icon : entry && entry.icon;
    const img = (meta && meta.poster) || (info && info.cover) || logo;
    if (img && img !== posterUrl) {
      posterUrl = img;
      clear(poster);
      poster.classList.add('loading');
      const node = h('img', { src: img, alt: '', referrerpolicy: 'no-referrer' });
      node.addEventListener('load', () => poster.classList.remove('loading'));
      node.addEventListener('error', () => {
        node.remove();
        poster.classList.remove('loading');
      });
      poster.appendChild(node);
    } else if (!img && !el.classList.contains('loading') && !poster.querySelector('.card-placeholder')) {
      // No picture anywhere (provider nor TMDB): the type's icon, as on the cards, instead of the loading sweep for ever.
      posterUrl = '';
      clear(poster);
      poster.classList.remove('loading');
      poster.appendChild(h('div', { class: 'card-placeholder' }, icon(entry && entry.type === 'live' ? 'network' : 'trailer')));
    }
    showBackdrop((info && info.backdrop) || (meta && meta.backdrop));
  }

  /** Full-width picture behind the page (provider's own, otherwise TMDB's), faded in once it has loaded. */
  function showBackdrop(url) {
    if (!url || backdropUrl === url) return;
    backdropUrl = url;
    const probe = new Image();
    probe.onload = () => {
      if (destroyed || backdropUrl !== url) return;
      backdropEl.style.backgroundImage = cssUrl(url);
      backdropEl.classList.add('visible');
    };
    probe.src = url;
  }

  async function load() {
    const current = await ctx.active.get();
    if (!current || destroyed) return;
    providerId = current.provider.id;
    db = current.db;
    entry = await getEntry(current.db, params.entryKey);
    if (!entry || destroyed) return;
    selectedMember = entry.members.find((m) => m.id === entry.defaultId) || entry.members[0];
    // The provider's details start downloading at once; the local reads run side by side (they used to wait for each other).
    const detailsJob = entry.type === 'series' ? ctx.details.series(entry.defaultId) : entry.type === 'movie' ? ctx.details.vod(entry.defaultId) : Promise.resolve({});
    detailsJob.catch(() => undefined); // handled below, where it is awaited
    const isLive = entry.type === 'live';
    const [categories, isFavorite, collectionList, settingsNow, manual, networks] = await Promise.all([
      listCategories(current.db, entry.type).catch((err) => {
        log.warn('Categories failed', err && err.message);
        return null;
      }),
      ctx.favorites.has(providerId, entry.key),
      ctx.collections ? ctx.collections.list(providerId) : Promise.resolve([]),
      isLive && ctx.liveGrouping ? ctx.settings.get() : Promise.resolve(null),
      isLive && ctx.liveGrouping ? ctx.liveGrouping.manual(providerId) : Promise.resolve(manualIds),
      isLive ? listNetworks(db).catch(() => []) : Promise.resolve([]),
    ]);
    if (destroyed) return;
    if (categories) {
      categoryNames = new Map(categories.map((c) => [c.id, c.name]));
      updateCategoryItems();
    }
    fillText();
    favorite = isFavorite;
    if (ctx.collections) collectionItems = collectionList.filter((c) => c.entryKeys.includes(entry.key)).map((c) => ({ id: c.id, name: c.name }));
    mergeAvailable = settingsNow ? settingsNow.liveGrouping : false;
    manualIds = manual;
    if (isLive) networkChoices = networks.map((n) => ({ key: n.key, name: n.name, networkId: n.networkId }));
    await reloadRecords();
    build();

    // Slow parts arrive later and refresh the page in place.
    try {
      info = { ...(await detailsJob) };
    } catch (err) {
      log.warn('Details failed', err && err.message);
      info = info || {};
    }
    if (destroyed) return;
    el.classList.remove('loading');
    if (isEmptySeries(entry, info)) {
      // The provider lists the series but serves no episode: it leaves the catalog (grids, search, continue watching).
      markUnavailable(db, entry.key)
        .then(() => {
          log.info(`Series without episodes taken out of the catalog: ${entry.key}`);
          ctx.catalogChanged();
          ctx.notices.info(t('detail.unavailable'), { key: 'unavailable' });
        })
        .catch((err) => log.warn('Unavailable mark failed', err && err.message));
    }
    followWatchState();
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

  /** The programmes of the next 24 hours (same data as the guide grid) and the ones whose viewing is scheduled. */
  let epgList = [];
  let scheduledIds = new Set();
  const programmeItem = (p) => ({ providerId, entryKey: entry.key, entryName: entry.name, channelId: entry.epgChannelId, title: p.title, start: p.start, stop: p.stop });

  async function refreshScheduled() {
    const list = ctx.schedules ? await ctx.schedules.list(providerId) : [];
    scheduledIds = new Set(list.map(scheduleId));
  }

  async function loadEpg() {
    try {
      epgList = await ctx.epg.upcoming(entry.epgChannelId);
      await refreshScheduled();
      if (destroyed || !epgList.length) return;
      build();
    } catch (err) {
      log.warn('EPG failed', err && err.message);
    }
  }

  /** The programme list as a focusable list: OK opens its actions (schedule the viewing, or cancel it). */
  function renderEpg(next) {
    clear(epgEl);
    if (!epgList.length) return;
    epgEl.appendChild(h('h2', { text: t('detail.epg') }));
    const at = Date.now();
    const nodes = epgList.map((p) =>
      h(
        'div',
        { class: `epg-row${p.start <= at && p.stop > at ? ' now' : ''}` },
        h('span', { class: 'epg-time', text: formatClockTime(new Date(p.start), 'auto', i18n.getLocale()) }),
        h('span', { class: 'epg-title', text: p.title }),
        scheduledIds.has(scheduleId(programmeItem(p))) ? icon('scheduled', 'epg-scheduled') : null,
      ),
    );
    nodes.forEach((node) => epgEl.appendChild(node));
    const zone = new FocusZone({
      id: 'detailEpg',
      model: new ListModel({ orientation: 'vertical', getCount: () => nodes.length }),
      onFocus: (i) => {
        nodes[i].classList.add('focused');
        ensureVisible(nodes[i], { margin: 120 });
      },
      onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
      onActivate: (i) => programmeActions(epgList[i]).catch((err) => log.warn('Programme action failed', err && err.message)),
    });
    if (landOn !== null) zone.index = landingIndex(epgList, landOn);
    next.push({ id: 'detailEpg', zone });
  }

  async function programmeActions(p) {
    // A programme on now: OK plays the channel, as the play button does.
    const at = Date.now();
    if (p.start <= at && p.stop > at) {
      play({ restart: true });
      return;
    }
    if (!ctx.schedules) return;
    const item = programmeItem(p);
    const scheduled = scheduledIds.has(scheduleId(item));
    if (!scheduled && p.start <= Date.now() + LEAD_MS) {
      ctx.notices.info(t('schedule.started'), { key: 'schedule' });
      return;
    }
    const option = scheduled ? { label: t('schedule.cancel'), value: 'cancel', icon: 'unschedule' } : { label: t('schedule.add'), value: 'add', icon: 'schedule' };
    const value = await ctx.dialogs.choose({ title: t('detail.actions'), options: [option] });
    if (!value || destroyed) return;
    try {
      if (value === 'add') {
        await ctx.schedules.add(item);
        ctx.notices.success(t('schedule.added'), { key: 'schedule' });
      } else {
        await ctx.schedules.remove(item);
        ctx.notices.info(t('schedule.removed'), { key: 'schedule' });
      }
    } catch (err) {
      if (err && err.code === 'CONFLICT') ctx.notices.error(t('schedule.conflict'), { key: 'schedule' });
      else throw err;
    }
    await refreshScheduled();
    if (!destroyed) build(); // the icon appears / goes, the focus stays on the programme
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
