/* Video engines shared by every platform: the <video> element (with hls.js / mpegts.js in development). The platform's own engine (AVPlay on
 * Tizen) lives in platforms/<name>/ and is chosen by the platform adapter (createEngine). */
/** Aspect-ratio modes the player cycles through. */
export const ASPECT_MODES = ['fit', 'fill', 'zoom'];
const CSS_FIT = { fit: 'contain', fill: 'fill', zoom: 'cover' };

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
    kind: 'html5',
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
