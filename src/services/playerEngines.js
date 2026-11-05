import { log } from '../core/logger.js';

/** Aspect-ratio modes the player cycles through. */
export const ASPECT_MODES = ['fit', 'fill', 'zoom'];
const AVPLAY_DISPLAY = { fit: 'PLAYER_DISPLAY_MODE_LETTER_BOX', fill: 'PLAYER_DISPLAY_MODE_FULL_SCREEN', zoom: 'PLAYER_DISPLAY_MODE_CROPPED_FULL' };
const CSS_FIT = { fit: 'contain', fill: 'fill', zoom: 'cover' };

/** AVPlay track list → tracks of one kind: [{ index, language }] (language is the 3-letter code or ''). */
export function parseAvPlayTracks(list, kind = 'TEXT') {
  return (Array.isArray(list) ? list : [])
    .filter((track) => track && track.type === kind)
    .map((track) => {
      let language = '';
      try {
        const info = JSON.parse(track.extra_info || '{}');
        language = String((kind === 'AUDIO' ? info.language : info.track_lang) || '');
      } catch {
        /* extra_info is not JSON on some firmware */
      }
      return { index: Number(track.index), language };
    });
}

/** Samsung AVPlay: draws on a plane behind the page (the page background must be transparent). */
export function createAvPlayEngine() {
  // A page outside the TV can have a partial `webapis` (extensions, emulators): AVPlay counts only when it is complete.
  const av = () => {
    const api = typeof webapis !== 'undefined' ? webapis.avplay : null;
    return api && typeof api.open === 'function' && typeof api.setDisplayRect === 'function' && typeof api.prepareAsync === 'function' ? api : null;
  };
  let element = null;
  let subtitleWatch = null;
  let nativeSubtitles = false; // the player draws them itself (fallback when no event ever arrives)
  let subtitlesOn = false; // a track is selected: events are shown
  let eventsLogged = 0;
  const stopWatch = () => {
    clearTimeout(subtitleWatch);
    subtitleWatch = null;
  };
  return {
    available: () => Boolean(av()),
    start(url, { bufferSeconds, handlers }) {
      const api = av();
      if (!api) throw new Error('AVPlay is not available');
      this.stop();
      element = document.createElement('object');
      element.setAttribute('type', 'application/avplayer');
      element.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:-1';
      document.body.appendChild(element);
      api.open(url);
      api.setDisplayRect(0, 0, 1920, 1080);
      api.setListener({
        onbufferingstart: () => handlers.onBuffering(0),
        onbufferingprogress: (percent) => handlers.onBuffering(percent),
        onbufferingcomplete: () => handlers.onBufferingDone(),
        onstreamcompleted: () => handlers.onEnded(),
        onerror: (error) => handlers.onError(error),
        // Embedded subtitles arrive as events; the page draws them (see setSubtitleTrack).
        // Callback arguments: (duration, subtitles, type, attributes).
        onsubtitlechange: (duration, text, type) => {
          if (eventsLogged < 5) {
            eventsLogged += 1;
            log.info('AVPlay subtitle event', JSON.stringify({ duration, type, text: String(text || '').slice(0, 60), on: subtitlesOn }));
          }
          if (subtitlesOn && !nativeSubtitles && handlers.onSubtitle) handlers.onSubtitle(String(text || ''), Number(duration) || 0);
        },
      });
      try {
        api.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', bufferSeconds);
      } catch (err) {
        log.warn('avplay setBufferingParam failed', err && err.message);
      }
      document.body.classList.add('video-active');
      api.prepareAsync(
        () => {
          // The app draws the subtitles from the events: the player must stay silent (set once, not at every track change).
          try {
            api.setSilentSubtitle(true);
          } catch (err) {
            log.warn('avplay setSilentSubtitle failed', err && err.message);
          }
          handlers.onPrepared();
        },
        (error) => handlers.onError(`prepare failed: ${error}`)
      );
    },
    play: () => av().play(),
    pause: () => av().pause(),
    seekTo: (ms) => av().seekTo(ms),
    getTime: () => av().getCurrentTime(),
    getDuration: () => av().getDuration(),
    setAspect(mode) {
      try {
        av().setDisplayMethod(AVPLAY_DISPLAY[mode] || AVPLAY_DISPLAY.fit);
      } catch (err) {
        log.warn('avplay setDisplayMethod failed', err && err.message);
      }
    },
    getSubtitleTracks() {
      try {
        const all = av().getTotalTrackInfo();
        log.info('AVPlay tracks', JSON.stringify(all)); // helps to see why a file has no subtitles
        return parseAvPlayTracks(all);
      } catch {
        return [];
      }
    },
    getAudioTracks() {
      try {
        const api = av();
        const tracks = parseAvPlayTracks(api.getTotalTrackInfo(), 'AUDIO');
        let current = -1;
        try {
          const now = api.getCurrentStreamInfo().find((info) => info.type === 'AUDIO');
          if (now) current = Number(now.index);
        } catch {
          /* not available on every firmware: the first track is assumed */
        }
        return tracks.map((track) => ({ ...track, current: track.index === current }));
      } catch {
        return [];
      }
    },
    setAudioTrack(index) {
      try {
        av().setSelectTrack('AUDIO', index);
        log.info('AVPlay audio track selected', index);
      } catch (err) {
        log.warn('avplay audio selection failed', err && err.message);
      }
    },
    /** index = track to show, null = subtitles off. The player draws the text itself. */
    setSubtitleTrack(index) {
      stopWatch();
      eventsLogged = 0;
      try {
        if (index === null) {
          subtitlesOn = false;
          if (nativeSubtitles) av().setSilentSubtitle(true);
          nativeSubtitles = false;
          return;
        }
        subtitlesOn = true;
        try {
          av().setSilentSubtitle(false); // before the selection: some firmwares only draw tracks chosen while visible
        } catch (err) {
          log.warn('avplay setSilentSubtitle failed', err && err.message);
        }
        av().setSelectTrack('TEXT', index);
        // The player draws the track itself (the app-drawn text from the events never showed on the TV).
        // Events are still logged, and shown by the app only if the native rendering could not be switched on.
        try {
          av().setSilentSubtitle(false);
          nativeSubtitles = true;
        } catch (err) {
          nativeSubtitles = false;
          log.warn('avplay native subtitles failed', err && err.message);
        }
        log.info('AVPlay subtitle track selected', index, nativeSubtitles ? 'native' : 'app');
      } catch (err) {
        log.warn('avplay subtitle selection failed', err && err.message);
      }
    },
    stop() {
      stopWatch();
      subtitlesOn = false;
      nativeSubtitles = false;
      eventsLogged = 0;
      const api = av();
      try {
        if (api) {
          api.stop();
          api.close();
        }
      } catch {
        /* already stopped */
      }
      if (element) element.remove();
      element = null;
      document.body.classList.remove('video-active');
    },
  };
}

/** Development only: the stream goes through the dev server (no CORS, Range support). */
export function devMediaUrl(url) {
  return typeof __DEV__ !== 'undefined' && __DEV__ ? `/__media?u=${encodeURIComponent(url)}` : url;
}

/** 'hls' | 'ts' | 'native' — only in development builds; production never loads the demuxers. */
export function devStreamKind(url) {
  if (!(typeof __DEV__ !== 'undefined' && __DEV__)) return 'native';
  const path = String(url).split('?')[0].toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  if (path.endsWith('.ts') || /\/live\/[^/]+\/[^/]+\/\d+$/.test(path)) return 'ts';
  return 'native';
}

async function attachHls(video, url, handlers) {
  if (!(typeof __DEV__ !== 'undefined' && __DEV__)) return null;
  const { default: Hls } = await import('hls.js');
  if (!Hls.isSupported()) {
    video.src = url;
    return null;
  }
  const hls = new Hls();
  hls.on(Hls.Events.ERROR, (event, data) => {
    if (data && data.fatal) handlers.onError(`hls ${data.type}: ${data.details}`);
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return hls;
}

async function attachMpegts(video, url, handlers) {
  if (!(typeof __DEV__ !== 'undefined' && __DEV__)) return null;
  const { default: mpegts } = await import('mpegts.js');
  if (!mpegts.isSupported()) {
    video.src = url;
    return null;
  }
  const player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url });
  player.on(mpegts.Events.ERROR, (type, detail) => handlers.onError(`mpegts ${type}: ${detail}`));
  player.attachMediaElement(video);
  player.load();
  return player;
}

/** <video> engine for desktop browsers (development and tests); not used on the TV. */
export function createHtml5Engine() {
  let video = null;
  let htmlHandlers = null;
  let adapter = null; // hls.js / mpegts.js instance (development only)
  return {
    available: () => typeof document !== 'undefined',
    start(rawUrl, { handlers }) {
      this.stop();
      htmlHandlers = handlers;
      const url = devMediaUrl(rawUrl);
      video = document.createElement('video');
      video.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:-1;background:#000';
      video.addEventListener('canplay', () => handlers.onPrepared(), { once: true });
      video.addEventListener('waiting', () => handlers.onBuffering(0));
      video.addEventListener('playing', () => handlers.onBufferingDone());
      video.addEventListener('ended', () => handlers.onEnded());
      video.addEventListener('error', () => handlers.onError(video.error ? `media error ${video.error.code}` : 'media error'));
      document.body.appendChild(video);
      document.body.classList.add('video-active');
      const kind = devStreamKind(rawUrl);
      if (kind === 'hls' || kind === 'ts') {
        // Desktop browsers cannot play HLS (Chrome/Firefox) or raw MPEG-TS: a JS demuxer does it (development only).
        const attach = kind === 'hls' ? attachHls : attachMpegts;
        const current = video;
        attach(current, url, handlers).then((instance) => {
          if (video === current) adapter = instance;
          else if (instance) instance.destroy();
        });
        return;
      }
      video.src = url;
      video.load();
    },
    play: () => video.play(),
    pause: () => video.pause(),
    seekTo: (ms) => {
      video.currentTime = ms / 1000;
    },
    getTime: () => (video ? video.currentTime * 1000 : 0),
    getDuration: () => (video && Number.isFinite(video.duration) ? video.duration * 1000 : 0),
    /** End (ms) of the buffered range that holds the current position, or null when the engine cannot tell. */
    getBufferedEnd() {
      if (!video || !video.buffered) return null;
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (video.currentTime >= video.buffered.start(i) - 0.25 && video.currentTime <= video.buffered.end(i)) return video.buffered.end(i) * 1000;
      }
      return null;
    },
    setAspect(mode) {
      if (video) video.style.objectFit = CSS_FIT[mode] || 'contain';
    },
    getSubtitleTracks() {
      if (!video) return [];
      return Array.from(video.textTracks || [])
        .map((track, index) => ({ index, language: track.language || '', kind: track.kind }))
        .filter((track) => track.kind === 'subtitles' || track.kind === 'captions')
        .map(({ index, language }) => ({ index, language }));
    },
    getAudioTracks() {
      const list = video && video.audioTracks ? Array.from(video.audioTracks) : [];
      return list.map((track, index) => ({ index, language: track.language || '', current: Boolean(track.enabled) }));
    },
    setAudioTrack(index) {
      if (!video || !video.audioTracks) return;
      Array.from(video.audioTracks).forEach((track, i) => {
        track.enabled = i === index;
      });
    },
    // Like AVPlay, the page draws the line: the track is "hidden" and its cues are handed to the page.
    setSubtitleTrack(index) {
      if (!video) return;
      Array.from(video.textTracks || []).forEach((track, i) => {
        track.oncuechange = null;
        track.mode = i === index ? 'hidden' : 'disabled';
        if (i !== index) return;
        track.oncuechange = () => {
          const cue = track.activeCues && track.activeCues[0];
          if (htmlHandlers && htmlHandlers.onSubtitle) htmlHandlers.onSubtitle(cue ? cue.text : '', cue ? (cue.endTime - cue.startTime) * 1000 : 0);
        };
      });
    },
    stop() {
      if (adapter) {
        try {
          adapter.destroy();
        } catch {
          /* already gone */
        }
        adapter = null;
      }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      }
      video = null;
      document.body.classList.remove('video-active');
    },
  };
}

export function createDefaultEngine() {
  const avplay = createAvPlayEngine();
  return avplay.available() ? avplay : createHtml5Engine();
}
