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

  function play(url, { bufferSeconds = 10, onEvent = () => {} } = {}) {
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

  return { play, stop };
}
