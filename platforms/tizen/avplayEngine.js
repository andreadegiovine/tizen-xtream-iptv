/* Tizen video engine: Samsung AVPlay, drawing on a plane behind the page (the page background must be transparent). Same contract as the
 * <video> engine of src/services/playerEngines.js. */
import { log } from '../../src/core/logger.js';

/**
 * Display modes for the three aspect ratios of the player, as they were before patch 105 (when the format worked on the TV): letterbox,
 * full screen and cropped full screen. `setDisplayMethod` only: setting the display area again afterwards (patch 105) is not done.
 */
const AVPLAY_DISPLAY = { fit: 'PLAYER_DISPLAY_MODE_LETTER_BOX', fill: 'PLAYER_DISPLAY_MODE_FULL_SCREEN', zoom: 'PLAYER_DISPLAY_MODE_CROPPED_FULL' };

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
    /** True when AVPlay took the mode (the player says so when it did not). */
    setAspect(mode) {
      const method = AVPLAY_DISPLAY[mode] || AVPLAY_DISPLAY.fit;
      try {
        av().setDisplayMethod(method);
        log.info('AVPlay display mode', method);
        return true;
      } catch (err) {
        log.warn('avplay setDisplayMethod failed', method, err && (err.name || ''), err && err.message);
        return false;
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
