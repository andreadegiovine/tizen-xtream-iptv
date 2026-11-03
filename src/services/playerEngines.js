import { log } from '../core/logger.js';

/** Aspect-ratio modes the player cycles through. */
export const ASPECT_MODES = ['fit', 'fill', 'zoom'];
const AVPLAY_DISPLAY = { fit: 'PLAYER_DISPLAY_MODE_LETTER_BOX', fill: 'PLAYER_DISPLAY_MODE_FULL_SCREEN', zoom: 'PLAYER_DISPLAY_MODE_CROPPED_FULL' };
const SUBTITLE_EVENT_WAIT_MS = 12000; // wait for the first subtitle event before using the player's own rendering
const CSS_FIT = { fit: 'contain', fill: 'fill', zoom: 'cover' };

/** AVPlay track list → subtitle tracks: [{ index, language }] (language is the 3-letter code or ''). */
export function parseAvPlayTracks(list) {
  return (Array.isArray(list) ? list : [])
    .filter((track) => track && track.type === 'TEXT')
    .map((track) => {
      let language = '';
      try {
        language = String(JSON.parse(track.extra_info || '{}').track_lang || '');
      } catch {
        /* extra_info is not JSON on some firmware */
      }
      return { index: Number(track.index), language };
    });
}

/** Samsung AVPlay: draws on a plane behind the page (the page background must be transparent). */
export function createAvPlayEngine() {
  const av = () => (typeof webapis !== 'undefined' ? webapis.avplay : null);
  let element = null;
  let subtitleSeen = false; // a subtitle event arrived since the track was selected
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
          subtitleSeen = true;
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
    /** index = track to show, null = subtitles off. The text is drawn by the app from the player's events. */
    setSubtitleTrack(index) {
      stopWatch();
      subtitleSeen = false;
      eventsLogged = 0;
      try {
        if (index === null) {
          subtitlesOn = false;
          if (nativeSubtitles) av().setSilentSubtitle(true);
          nativeSubtitles = false;
          return;
        }
        subtitlesOn = true;
        nativeSubtitles = false;
        av().setSelectTrack('TEXT', index);
        log.info('AVPlay subtitle track selected', index);
        // If the player never reports a line, let it draw them itself rather than showing nothing.
        subtitleWatch = setTimeout(() => {
          if (subtitleSeen || !subtitlesOn) return;
          try {
            nativeSubtitles = true;
            av().setSilentSubtitle(false);
            log.warn('AVPlay sent no subtitle events: using the native subtitles');
          } catch (err) {
            log.warn('avplay native subtitles failed', err && err.message);
          }
        }, SUBTITLE_EVENT_WAIT_MS);
      } catch (err) {
        log.warn('avplay subtitle selection failed', err && err.message);
      }
    },
    stop() {
      stopWatch();
      subtitleSeen = false;
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

/** <video> engine for desktop browsers (development and tests); not used on the TV. */
export function createHtml5Engine() {
  let video = null;
  let htmlHandlers = null;
  return {
    available: () => typeof document !== 'undefined',
    start(url, { handlers }) {
      this.stop();
      htmlHandlers = handlers;
      video = document.createElement('video');
      video.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:-1;background:#000';
      video.addEventListener('canplay', () => handlers.onPrepared(), { once: true });
      video.addEventListener('waiting', () => handlers.onBuffering(0));
      video.addEventListener('playing', () => handlers.onBufferingDone());
      video.addEventListener('ended', () => handlers.onEnded());
      video.addEventListener('error', () => handlers.onError(video.error ? `media error ${video.error.code}` : 'media error'));
      document.body.appendChild(video);
      document.body.classList.add('video-active');
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
