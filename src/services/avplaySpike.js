import { log } from '../core/logger.js';

/**
 * Minimal AVPlay wrapper used only by the diagnostics page (milestone 0).
 * AVPlay draws on a native plane behind the web layer, so the page background must be transparent.
 */
export function createAvPlaySpike() {
  let element = null;

  const avplay = () => (typeof webapis !== 'undefined' ? webapis.avplay : null);

  function ensureElement() {
    if (element) return;
    element = document.createElement('object');
    element.id = 'av-player';
    element.setAttribute('type', 'application/avplayer');
    element.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:-1';
    document.body.appendChild(element);
  }

  function stop() {
    const av = avplay();
    try {
      if (av) {
        av.stop();
        av.close();
      }
    } catch {
      /* already stopped */
    }
    if (element) element.remove();
    element = null;
    document.body.classList.remove('video-active');
  }

  function play(url, { bufferSeconds = 10, onEvent = () => {}, onSubtitle = null } = {}) {
    const av = avplay();
    if (!av) {
      onEvent('AVPlay is not available in this environment');
      return;
    }
    stop();
    ensureElement();
    const emit = (message) => {
      log.info('avplay', message);
      onEvent(message);
    };
    try {
      av.open(url);
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setListener({
        onbufferingstart: () => emit('buffering started'),
        onbufferingprogress: (percent) => {
          if (percent % 25 === 0) emit(`buffering ${percent}%`); // every percent would flood the log
        },
        onbufferingcomplete: () => emit('buffering complete'),
        onstreamcompleted: () => {
          emit('stream completed');
          stop();
        },
        onerror: (error) => emit(`error: ${error}`),
        // Subtitle lab: every event is logged (not just the first ones) and handed to the page.
        onsubtitlechange: (duration, text, type, attributes) => {
          emit(`subtitle event ${JSON.stringify({ duration, type, text: String(text || '').slice(0, 80), attributes })}`);
          if (onSubtitle) onSubtitle(String(text || ''), Number(duration) || 0);
        },
        onevent: (type, data) => emit(`event ${type} ${JSON.stringify(data)}`),
      });
      try {
        av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', bufferSeconds);
      } catch (err) {
        emit(`setBufferingParam failed: ${err.message}`);
      }
      document.body.classList.add('video-active');
      av.prepareAsync(
        () => {
          emit('prepared, playing');
          av.play();
        },
        (error) => emit(`prepare failed: ${error}`),
      );
    } catch (err) {
      emit(`exception: ${err.message}`);
      stop();
    }
  }

  /** Text tracks as AVPlay lists them: [{ index, extra_info }]. */
  function textTracks() {
    const av = avplay();
    try {
      return (av.getTotalTrackInfo() || []).filter((track) => track.type === 'TEXT');
    } catch (err) {
      log.warn('avplay getTotalTrackInfo failed', err && err.message);
      return [];
    }
  }

  /**
   * Subtitle lab: tries one way of showing a text track and logs what AVPlay reports.
   * modes: 'events' (silent, the page draws), 'native' (the player draws), 'late' (select, then switch native on 1 s later),
   * 'before' (native on, then select), 'off'.
   */
  function selectText(index, mode) {
    const av = avplay();
    if (!av) return;
    const step = (name, fn) => {
      try {
        fn();
        log.info('avplay', `${name} ok`);
      } catch (err) {
        log.warn('avplay', `${name} failed: ${err && err.message}`);
      }
    };
    const info = () => step('getCurrentStreamInfo', () => log.info('avplay', JSON.stringify(av.getCurrentStreamInfo())));
    if (mode === 'off') {
      step('setSilentSubtitle(true)', () => av.setSilentSubtitle(true));
      return;
    }
    log.info('avplay', `subtitle lab: track ${index}, mode ${mode}`);
    if (mode === 'events') {
      step('setSilentSubtitle(true)', () => av.setSilentSubtitle(true));
      step(`setSelectTrack(TEXT, ${index})`, () => av.setSelectTrack('TEXT', index));
    } else if (mode === 'native') {
      step(`setSelectTrack(TEXT, ${index})`, () => av.setSelectTrack('TEXT', index));
      step('setSilentSubtitle(false)', () => av.setSilentSubtitle(false));
    } else if (mode === 'before') {
      step('setSilentSubtitle(false)', () => av.setSilentSubtitle(false));
      step(`setSelectTrack(TEXT, ${index})`, () => av.setSelectTrack('TEXT', index));
    } else if (mode === 'late') {
      step(`setSelectTrack(TEXT, ${index})`, () => av.setSelectTrack('TEXT', index));
      setTimeout(() => step('setSilentSubtitle(false) (1 s later)', () => av.setSilentSubtitle(false)), 1000);
    }
    setTimeout(info, 1500);
  }

  return { play, stop, textTracks, selectText };
}
