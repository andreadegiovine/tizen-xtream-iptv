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

/** State and picture size of the stream, for the log ("state PLAYING, video 1920x1080"): what decides whether a display mode shows. */
function describeState(api) {
  const parts = [];
  try {
    parts.push(`state ${api.getState()}`);
  } catch {
    /* not on every firmware */
  }
  try {
    const video = (api.getCurrentStreamInfo() || []).find((info) => info.type === 'VIDEO');
    const extra = video ? JSON.parse(video.extra_info || '{}') : {};
    if (extra.Width) parts.push(`video ${extra.Width}x${extra.Height}`);
  } catch {
    /* extra_info is not JSON on some firmware */
  }
  return parts.join(', ');
}

export function createAvPlayEngine() {
  // A page outside the TV can have a partial `webapis` (extensions, emulators): AVPlay counts only when it is complete.
  const av = () => {
    const api = typeof webapis !== 'undefined' ? webapis.avplay : null;
    return api && typeof api.open === 'function' && typeof api.setDisplayRect === 'function' && typeof api.prepareAsync === 'function' ? api : null;
  };
  let element = null;
  let subtitlesOn = false; // a track is selected: its lines (onsubtitlechange) are drawn by the page
  let eventsLogged = 0;
  let textEvents = 0; // subtitle lines with text received since the track was chosen (Diagnostics)

  /** Opens `url` in AVPlay with the listener of the page's handlers. */
  function open(api, { url, bufferSeconds, handlers }) {
    api.open(url);
    api.setDisplayRect(0, 0, 1920, 1080);
    api.setListener({
      onbufferingstart: () => handlers.onBuffering(0),
      onbufferingprogress: (percent) => handlers.onBuffering(percent),
      onbufferingcomplete: () => handlers.onBufferingDone(),
      onstreamcompleted: () => handlers.onEnded(),
      onerror: (error) => handlers.onError(error),
      // Embedded subtitles arrive as events (text in HTML, duration in ms); the page draws them (see setSubtitleTrack).
      // Callback arguments: (duration, subtitles, type, attributes). An empty text clears the line.
      onsubtitlechange: (duration, text, type, attributes) => {
        if (text && text !== '\u0000') textEvents += 1;
        if (eventsLogged < 8) {
          eventsLogged += 1;
          log.info('AVPlay subtitle event', JSON.stringify({ duration, type, text: String(text || '').slice(0, 60), attributes, on: subtitlesOn, lines: textEvents }));
        }
        // A NUL character alone (sent by some firmwares at the start) is no line.
        if (subtitlesOn && handlers.onSubtitle) handlers.onSubtitle(String(text || '').split('\u0000').join(''), Number(duration) || 0);
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
        // Lines AVPlay sends before the user picks a track are ignored (subtitlesOn); silent mode is never used, since some
        // firmwares send no more lines once it was on.
        handlers.onPrepared();
      },
      (error) => handlers.onError(`prepare failed: ${error}`)
    );
  }

  function makeElement() {
    element = document.createElement('object');
    element.setAttribute('type', 'application/avplayer');
    element.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:-1';
    document.body.appendChild(element);
  }

  return {
    kind: 'avplay',
    available: () => Boolean(av()),
    start(url, { bufferSeconds, handlers }) {
      const api = av();
      if (!api) throw new Error('AVPlay is not available');
      this.stop();
      makeElement();
      open(api, { url, bufferSeconds, handlers });
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
        const api = av();
        api.setDisplayMethod(method);
        log.info('AVPlay display mode', method, describeState(api));
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
    /**
     * index = track to show, null = subtitles off. AVPlay does not draw subtitles: it sends each line in `onsubtitlechange` and the
     * page draws it. The track is chosen while the video plays (READY refuses it; reopening the video only cost a rebuffer). Off only
     * stops drawing the lines.
     */
    setSubtitleTrack(index) {
      eventsLogged = 0;
      textEvents = 0;
      const api = av();
      if (!api) return;
      if (index === null) {
        subtitlesOn = false;
        log.info('AVPlay subtitles off');
        return;
      }
      subtitlesOn = true;
      try {
        api.setSilentSubtitle(false);
        api.setSelectTrack('TEXT', index);
        log.info('AVPlay subtitle track selected', index, 'state', api.getState());
      } catch (err) {
        log.warn('avplay subtitle selection failed', err && (err.name || ''), err && err.message);
      }
    },
    stop() {
      subtitlesOn = false;
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
