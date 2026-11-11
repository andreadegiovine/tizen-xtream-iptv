import { t, i18n } from '../../../i18n/index.js';
import { log } from '../../../core/logger.js';
import { cleanSubtitle, subtitleLabel } from '../../../services/playerController.js';
import { portableKeyFor } from '../../../services/shareKeys.js';
import { cueAt, subtitleLanguages } from '../../../services/openSubtitles.js';
import { createRangeReader, probeMkv, createTrackLoader } from '../../../services/mkvSubtitles.js';
import { probeMp4 } from '../../../services/mp4Subtitles.js';

const SUBTITLE_FALLBACK_MS = 5000;
const ONLINE_TICK_MS = 200;
const ONLINE = 'online'; // value of the downloaded track in the subtitle list
const DOWNLOAD = 'download'; // value of the "Download from OpenSubtitles" entry of the subtitle list
const SYNC = 'sync'; // value of the "timing" entry of the subtitle list (downloaded subtitles only)
const EMBEDDED = 'emb:'; // + track number: a text track of the MKV read by the app (see mkvSubtitles.js)
const ENSURE_EVERY_MS = 2000; // how often the reader of an embedded track checks what is coming

/** Delays offered for the downloaded subtitles: half seconds up to 10 s, seconds up to 1 minute, 5 s up to 5 minutes (each side). */
export function syncSteps() {
  const side = [];
  for (let ms = 500; ms <= 10000; ms += 500) side.push(ms);
  for (let ms = 11000; ms <= 60000; ms += 1000) side.push(ms);
  for (let ms = 65000; ms <= 300000; ms += 5000) side.push(ms);
  return side.slice().reverse().map((ms) => -ms).concat([0], side);
}

/**
 * The subtitles of the player (src/ui/pages/playerPage.js): the line on screen (`show`, also for the lines the engine sends), the list of
 * the Subtitles button (`open`): the engine's tracks, the text tracks of an MKV / MP4 read by the app, the OpenSubtitles download and
 * its timing. `reset()` when another title starts, `stop()` when the player closes.
 * deps: { ctx, engine, params, isLive, isTrailer, subtitleEl, current(), showControls(), loadToken() (the load being played), isDestroyed(),
 * streamUrl() }
 */
export function createPlayerSubtitles({ ctx, engine, params, isLive, isTrailer, subtitleEl, current, showControls, loadToken, isDestroyed, streamUrl }) {
  let subtitle = -1; // -1 = off, ONLINE = the downloaded subtitles, otherwise the engine's track
  let online = null; // { language, matched, cues } downloaded from OpenSubtitles for what is playing
  let onlineDelay = 0; // ms the downloaded subtitles are moved by (later when positive), set from the subtitle list
  let onlineTimer = null; // draws the downloaded cues while they are chosen
  let onlineCue = null;
  let onlinePending = null; // the download running for what is playing, shared by repeated presses
  let embedded = null; // the text tracks of the file read by the app: { tracks, reader, loaders }, false when there are none
  let embeddedPending = null;
  let subtitleTimer = null;

  function showSubtitle(text, durationMs) {
    clearTimeout(subtitleTimer);
    const clean = cleanSubtitle(text);
    subtitleEl.textContent = clean;
    subtitleEl.classList.toggle('visible', Boolean(clean));
    // The engine says for how long; without a usable duration the line is replaced by the next one or cleared after a while.
    if (clean) subtitleTimer = setTimeout(() => subtitleEl.classList.remove('visible'), durationMs > 0 ? durationMs : SUBTITLE_FALLBACK_MS);
  }

  /** OpenSubtitles can be asked for this title (a key is set; not live channels or trailers; nothing downloaded yet). */
  const canDownload = () => Boolean(!online && !isLive && !isTrailer && ctx.openSubtitles && ctx.openSubtitles.enabled);

  /** "Download from OpenSubtitles": the download, then the list again with the downloaded subtitles (and their timing) in it. */
  async function downloadOnline() {
    const token = loadToken();
    if (!onlinePending) onlinePending = fetchOnline(token).catch(() => undefined);
    const pending = onlinePending;
    await pending;
    if (onlinePending === pending) onlinePending = null;
    if (token !== loadToken() || isDestroyed() || !online) return;
    await openSubtitles();
  }

  async function openSubtitles() {
    // The text tracks of an MKV / MP4 are read at the first press (once per title); OpenSubtitles only when its entry is chosen.
    const token = loadToken();
    const jobs = [];
    if (embedded === null) {
      if (!embeddedPending) embeddedPending = readEmbedded(token).catch(() => undefined);
      jobs.push(embeddedPending);
    }
    if (jobs.length) {
      await Promise.all(jobs);
      if (token !== loadToken() || isDestroyed()) return;
    }
    // The tracks the app reads replace the player's (which list them without sending their lines).
    const own = embedded ? embedded.tracks : [];
    const tracks = own.length ? [] : engine.getSubtitleTracks ? engine.getSubtitleTracks() : [];
    if (!tracks.length && !own.length && !online && !canDownload()) {
      ctx.notices.warning(t('player.subtitles.none'), { scope: 'playback', key: 'track' });
      return;
    }
    const options = [
      { label: t('player.subtitles.off'), value: -1 },
      ...tracks.map((track, i) => ({ label: subtitleLabel(track, i + 1, t('player.track')), value: track.index })),
      ...own.map((track, i) => ({ label: embeddedLabel(track, i + 1), value: `${EMBEDDED}${track.number}` })),
      ...(online ? [{ label: onlineLabel(), value: ONLINE }, { label: syncLabel(), value: SYNC }] : []),
      ...(canDownload() ? [{ label: t('player.subtitles.download'), value: DOWNLOAD }] : []),
    ];
    const value = await ctx.dialogs.choose({ title: t('player.subtitles'), options, selected: subtitle });
    if (value === null || isDestroyed()) return;
    if (value === SYNC) {
      await chooseDelay();
      return;
    }
    if (value === DOWNLOAD) {
      await downloadOnline();
      return;
    }
    subtitle = value;
    showSubtitle('');
    showControls();
    // The engine call can stall the picture for a moment: let the list close first.
    const chosen = options.find((o) => o.value === value);
    ctx.notices.info(`${t('player.subtitles')}: ${chosen ? chosen.label : ''}`, { scope: 'playback', key: 'track' });
    stopOnline();
    setTimeout(() => {
      if (isDestroyed()) return;
      const ownTrack = typeof value === 'string' && value.indexOf(EMBEDDED) === 0;
      if (value === ONLINE || ownTrack) {
        // The player's own track goes off (also when the list shows the tracks the app reads instead of the player's).
        if (engine.setSubtitleTrack && (tracks.length || own.length)) engine.setSubtitleTrack(null);
        if (ownTrack) startEmbedded(Number(value.slice(EMBEDDED.length)));
        else startOnline();
      } else if (engine.setSubtitleTrack) engine.setSubtitleTrack(value < 0 ? null : value);
    }, 150);
  }

  const onlineLanguage = () => subtitleLabel({ language: online.language }, 1, t('player.track'));
  // "for this file" when OpenSubtitles found them by the file's hash (made for this very version: in time with it).
  const onlineLabel = () => t(online.matched ? 'player.subtitles.matched' : 'player.subtitles.online', { language: onlineLanguage() });
  // "+2.5 s", "−1:05" (a minute or more as minutes:seconds).
  const delayText = (ms) => {
    const sign = ms > 0 ? '+' : ms < 0 ? '−' : '';
    const abs = Math.abs(ms);
    if (abs >= 60000) return `${sign}${Math.floor(abs / 60000)}:${`0${Math.round((abs % 60000) / 1000)}`.slice(-2)} min`;
    return `${sign}${(abs / 1000).toLocaleString(i18n.getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  };
  const syncLabel = () => t('player.subtitles.sync', { delay: delayText(onlineDelay) });

  /**
   * Timing of the downloaded subtitles, from −5 to +5 minutes (+ = later, for lines that come before the voice; see syncSteps). Choosing
   * a value also switches them on.
   */
  async function chooseDelay() {
    const options = syncSteps().map((ms) => ({ label: delayText(ms), value: ms }));
    const value = await ctx.dialogs.choose({ title: t('player.subtitles.syncTitle'), options, selected: onlineDelay });
    if (value === null || isDestroyed()) return;
    onlineDelay = value;
    ctx.notices.info(syncLabel(), { scope: 'playback', key: 'track' });
    if (subtitle !== ONLINE) {
      subtitle = ONLINE;
      if (engine.setSubtitleTrack && engine.getSubtitleTracks && engine.getSubtitleTracks().length) engine.setSubtitleTrack(null);
    }
    showSubtitle('');
    startOnline();
  }
  let onlineNotice = null; // the "downloading" notice, closed if the player changes title or closes first
  function closeOnlineNotice() {
    if (onlineNotice !== null) ctx.notices.close(onlineNotice);
    onlineNotice = null;
  }

  /** The downloaded cues follow the position of the engine (read a few times a second). */
  function startOnline() {
    stopOnline();
    if (!online) return;
    onlineTimer = setInterval(() => {
      let ms = 0;
      try {
        ms = Number(engine.getTime()) || 0;
      } catch {
        return;
      }
      const cue = cueAt(online.cues, ms - onlineDelay);
      if (cue === onlineCue) return;
      onlineCue = cue;
      showSubtitle(cue ? cue.text : '', cue ? cue.end + onlineDelay - ms : 0);
    }, ONLINE_TICK_MS);
  }
  function stopOnline() {
    clearInterval(onlineTimer);
    onlineTimer = null;
    onlineCue = null;
  }

  /** "Italiano · Forced", or "Track 2": the language (or name) of a track the app reads from the file. */
  function embeddedLabel(track, position) {
    const base = track.language ? subtitleLabel({ language: track.language }, position, t('player.track')) : track.name || `${t('player.track')} ${position}`;
    return track.forced ? `${base} · ${t('player.subtitles.forced')}` : base;
  }

  /**
   * Reads the text tracks of the file when it is an MKV that the server serves in ranges and whose cue index lists the subtitles
   * (live channels, trailers and ExoPlayer, which shows them itself, are left out). `embedded` becomes false when there is nothing to read.
   */
  async function readEmbedded(token) {
    if (isLive || isTrailer || engine.kind === 'exoplayer' || !streamUrl()) {
      embedded = false;
      log.info('Embedded subtitles not read here', isLive ? 'live' : isTrailer ? 'trailer' : engine.kind === 'exoplayer' ? 'ExoPlayer' : 'no address');
      return;
    }
    const reader = createRangeReader(streamUrl(), ctx.fetch || ((...args) => fetch(...args)));
    let found = null;
    log.info('Embedded subtitles: reading the file', (/\.([a-z0-9]+)(?:\?|$)/i.exec(streamUrl()) || [])[1] || '?');
    try {
      // MKV first; a file that is not one may be an MP4 (tx3g / WebVTT tracks).
      let why = '';
      found = await probeMkv(reader, (reason) => {
        why = reason;
      });
      if (!found && why === 'not an MKV') found = await probeMp4(reader, (reason) => {
        why = reason;
      });
      if (!found) log.info('Embedded subtitles not readable', why);
    } catch (err) {
      log.info('Embedded subtitles not readable', err && err.message);
    }
    if (token !== loadToken() || isDestroyed()) return;
    embedded = found ? { ...found, reader, loaders: new Map() } : false;
    if (found) log.info('Embedded subtitles read by the app', found.tracks.map((tr) => `${tr.number}:${tr.codec}:${tr.language || '?'}:${tr.cues.length}`).join(', '), `${reader.requests} requests`);
  }

  /** Draws a track read from the file: its lines are read a few minutes ahead of the position, again after a seek. */
  function startEmbedded(number) {
    stopOnline();
    if (!embedded) return;
    const track = embedded.tracks.find((tr) => tr.number === number);
    if (!track) return;
    let loader = embedded.loaders.get(number);
    if (!loader) {
      loader = createTrackLoader(embedded.reader, track, { scaleMs: embedded.scaleMs });
      embedded.loaders.set(number, loader);
    }
    let lastEnsure = -Infinity;
    onlineTimer = setInterval(() => {
      let ms = 0;
      try {
        ms = Number(engine.getTime()) || 0;
      } catch {
        return;
      }
      const now = Date.now();
      if (now - lastEnsure >= ENSURE_EVERY_MS) {
        lastEnsure = now;
        loader.ensure(ms);
      }
      const cue = cueAt(loader.cues, ms);
      if (cue === onlineCue) return;
      onlineCue = cue;
      showSubtitle(cue ? cue.text : '', cue ? cue.end - ms : 0);
    }, ONLINE_TICK_MS);
  }

  /** TMDB id (and episode) of what is playing: from the key, or from the provider's list row when it has one. */
  async function tmdbQuery() {
    let key = params.entryKey || '';
    if (!/^(movie|series):t\d+$/.test(key)) {
      const current = await ctx.active.get();
      key = (current && (await portableKeyFor(current.db, key))) || key;
    }
    const m = /^(movie|series):t(\d+)$/.exec(key);
    if (!m || m[1] !== params.type) return null;
    const languages = subtitleLanguages(i18n.getLocale());
    if (m[1] === 'movie') return { tmdbId: Number(m[2]), languages };
    const ep = current();
    return ep && ep.season !== undefined && ep.number !== undefined ? { tmdbId: Number(m[2]), season: Number(ep.season), episode: Number(ep.number), languages } : null;
  }

  /**
   * Pressing Subtitles: when OpenSubtitles is set up and the title has a TMDB id, its subtitles are downloaded (kept in memory for
   * this session only) and added to the list, next to the file's own tracks.
   */
  async function fetchOnline(token) {
    const service = ctx.openSubtitles;
    if (isLive || isTrailer || !service || !service.enabled || token !== loadToken() || isDestroyed()) return;
    const query = await tmdbQuery().catch(() => null);
    if (!query || token !== loadToken() || isDestroyed()) return;
    onlineNotice = ctx.notices.info(t('player.subtitles.downloading'), { scope: 'playback', key: 'subs-online', permanent: true });
    let found = null;
    let failed = false;
    try {
      found = await service.fetch(query, { url: streamUrl() });
    } catch (err) {
      failed = true;
      log.warn('OpenSubtitles download failed', err && err.message, err && err.details ? JSON.stringify(err.details) : '');
    }
    if (token !== loadToken() || isDestroyed()) return;
    onlineNotice = null; // replaced below (same key)
    if (found) {
      online = found;
      log.info('OpenSubtitles', found.language, `${found.cues.length} lines`);
      ctx.notices.info(t('player.subtitles.downloaded', { language: onlineLanguage() }), { scope: 'playback', key: 'subs-online' });
    } else ctx.notices.warning(t(failed ? 'player.subtitles.failed' : 'player.subtitles.notFound'), { scope: 'playback', key: 'subs-online' });
  }


  return {
    show: showSubtitle,
    open: openSubtitles,
    /** Another title starts: nothing chosen, downloaded or read is kept. */
    reset() {
      subtitle = -1;
      online = null;
      onlineDelay = 0;
      closeOnlineNotice();
      stopOnline();
      onlinePending = null;
      embedded = null;
      embeddedPending = null;
      showSubtitle('');
    },
    /** The player closes. */
    stop() {
      clearTimeout(subtitleTimer);
      closeOnlineNotice();
      stopOnline();
    },
  };
}
