import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { Action } from '../../core/input.js';
import { log } from '../../core/logger.js';
import { icon } from '../icons.js';
import { createPlayerController, cleanSubtitle, formatClock, neighborEpisode, subtitleLabel, nextAspect, scrubTarget, positionFromPointer } from '../../services/playerController.js';
import { ASPECT_MODES } from '../../services/playerEngines.js';
import { youtubeStreamUrl } from '../../services/youtubeEngine.js';
import { formatClockTime } from '../../core/clock.js';
import { watchKey, shouldResume } from '../../services/watchStore.js';
import { pageEntries } from '../../services/catalogQuery.js';

const CONTROLS_MS = 4000;
const SAVE_EVERY_MS = 10000;
const NEXT_OFFER_S = 120; // the "next episode" notice appears this long before the end (over the end credits)
const NEXT_MIN_DURATION_S = 240;
const NEXT_COUNTDOWN_S = 10;
const SEEK_SHORT = 10;
const SEEK_LONG = 30;
const SCRUB_STEP = 30;
const SCRUB_CONFIRM_MS = 2000; // the moved position is applied after this long without a key
const SUBTITLE_FALLBACK_MS = 5000;

/**
 * Full-screen player. All controls are HTML on top of the video plane; keys arrive through
 * `onAction` (see main.js) so the page does not need a focus zone.
 * params: { type, entryKey, title, icon, playlist: [{ id, ext, title, season?, number? }], index,
 *           live?: { categoryId, offset } }
 */
export function createPlayerPage(ctx, params) {
  const isTrailer = params.type === 'trailer'; // a YouTube trailer: same player and controls, no aspect ratio / subtitles
  const engine = isTrailer ? ctx.createTrailerEngine() : ctx.createEngine();
  const controller = createPlayerController({ engine });
  const isLive = params.type === 'live';
  let playlist = params.playlist;
  let index = params.index || 0;
  let live = params.live ? { ...params.live } : null;
  let title = params.title;
  let destroyed = false;
  let hideTimer = null;
  let saveTimer = null;
  let nextNotice = null; // the notice that offers the next episode (OK plays it now)
  let nextTimer = null; // the 10 second countdown
  let nextOffered = false; // once per episode
  let recoverNotice = null;
  let loadToken = 0;
  let providerId = null; // known once playback started, so saving on exit needs no await
  let aspect = 'fit';
  let subtitle = -1; // -1 = off
  let audioTrack = null; // null = the file's default
  let appliedFor = 0; // load token the aspect mode was last applied to
  let focusMode = false; // the D-pad moves over the controls (progress pointer + buttons) instead of seeking
  let barFocus = false; // focus on the progress pointer (otherwise on a button)
  let focusIndex = 0;
  let lastStatus = '';
  let subtitleTimer = null;
  let scrub = null; // seconds while the user drags / steps the progress bar, otherwise null
  let lastState = { position: 0, duration: 0 };
  let lastPosition = null; // previous polled position, to spot jumps (a seek)
  let tipTimer = null;
  let timeFormat = 'auto'; // the clock format of the top bar, for the end time
  let scrubTimer = null;

  const titleEl = h('div', { class: 'player-title' });
  const statusEl = h('div', { class: 'player-status' });
  const nowEl = h('div', { class: 'player-now' });
  const timeEl = h('span', { class: 'player-time' });
  const buffer = h('div', { class: 'player-buffer' });
  const fill = h('div', { class: 'player-fill' });
  const knob = h('div', { class: 'player-knob' });
  const tip = h('div', { class: 'player-tip' });
  const bar = h('div', { class: 'player-bar' }, buffer, fill, knob, tip);
  const seek = h('div', { class: 'player-seek' }, bar);
  const subtitleEl = h('div', { class: 'player-subtitle' });

  // Control buttons: transport at the bottom left (not for live), aspect ratio + subtitles at the bottom right.
  const buttonDefs = [
    { id: 'back', icon: 'backward', label: () => t('player.back'), vodOnly: true, group: 'start', run: () => controller.seekBy(-SEEK_LONG) },
    { id: 'toggle', icon: 'pause', label: () => t('player.pause'), vodOnly: true, group: 'start', run: () => controller.togglePause() },
    { id: 'forward', icon: 'forward', label: () => t('player.forward'), vodOnly: true, group: 'start', run: () => controller.seekBy(SEEK_LONG) },
    { id: 'aspect', icon: 'aspect', label: () => t('player.aspect'), group: 'end', run: () => cycleAspect() },
    { id: 'subtitles', icon: 'subtitles', label: () => t('player.subtitles'), group: 'end', run: () => openSubtitles() },
    { id: 'audio', icon: 'audio', label: () => t('player.audio'), group: 'end', hidden: true, run: () => openAudio() }, // shown once the file has several audio tracks
  ].filter((def) => !(isLive && def.vodOnly) && !(isTrailer && (def.id === 'aspect' || def.id === 'subtitles' || def.id === 'audio')));
  buttonDefs.forEach((def) => {
    def.el = h('button', { class: 'player-btn', type: 'button', 'aria-label': def.label() }, icon(def.icon));
  });
  buttonDefs.forEach((def) => {
    if (def.hidden) def.el.style.display = 'none';
  });
  const buttonEl = (id) => (buttonDefs.find((d) => d.id === id) || {}).el;
  // Full-width progress bar, then one row: back, play/pause, forward and the time on the left, aspect ratio and subtitles on the right.
  const row = h('div', { class: 'player-row' }, h('div', { class: 'player-group' }, buttonEl('back'), buttonEl('toggle'), buttonEl('forward'), timeEl), h('div', { class: 'player-group' }, buttonEl('aspect'), buttonEl('subtitles'), buttonEl('audio')));
  const top = h('div', { class: 'player-top' }, titleEl, nowEl);
  const controls = h('div', { class: 'player-controls' }, ...(isLive ? [] : [seek]), row);
  const el = h('section', { class: 'player' }, top, controls, statusEl, subtitleEl);

  const current = () => playlist[index];
  const episodeKey = () => (params.type === 'series' && current().season !== undefined ? `s${current().season}e${current().number}` : null);

  function showControls() {
    controls.classList.add('visible');
    top.classList.add('visible');
    clearTimeout(hideTimer);
    // Without a key press for a few seconds everything fades out, the button focus included.
    hideTimer = setTimeout(() => {
      focusMode = false;
      barFocus = false;
      if (scrub !== null) endScrub(false);
      paintFocus();
      controls.classList.remove('visible');
      top.classList.remove('visible');
    }, CONTROLS_MS);
  }

  /** " · termina alle 23:34": when it would end if it keeps playing from `position` (the clock format of the top bar). */
  function endsAtText(position, duration) {
    if (!(duration > 0)) return '';
    const end = new Date(Date.now() + Math.max(0, duration - position) * 1000);
    return ` · ${t('player.endsAt', { time: formatClockTime(end, timeFormat) })}`;
  }

  function drawProgress(position, duration, bufferedEnd = null) {
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    const bufferPct = duration > 0 && bufferedEnd !== null ? Math.min(100, Math.max(pct, (bufferedEnd / duration) * 100)) : 0;
    buffer.style.width = `${bufferPct}%`;
    fill.style.width = `${pct}%`;
    knob.style.left = `${pct}%`;
    tip.style.left = `${pct}%`;
    tip.textContent = formatClock(position);
    timeEl.textContent = isLive ? t('player.live') : `${formatClock(position)} / ${formatClock(duration)}${endsAtText(position, duration)}`;
  }

  /** The minute the picture now starts from, shown above the knob for a moment after a jump. */
  function flashTip() {
    tip.classList.add('visible');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => tip.classList.remove('visible'), 2500);
  }

  function setScrub(seconds) {
    scrub = scrubTarget(seconds, 0, lastState.duration);
    seek.classList.add('scrubbing');
    tip.classList.add('visible');
    drawProgress(scrub, lastState.duration, lastState.bufferedEnd);
  }

  function endScrub(commit) {
    clearTimeout(scrubTimer);
    const target = scrub;
    scrub = null;
    seek.classList.remove('scrubbing');
    tip.classList.remove('visible');
    if (commit && target !== null) controller.seekTo(target);
    drawProgress(commit && target !== null ? target : lastState.position, lastState.duration);
  }

  /** Left / right on the progress pointer: move the target position (applied with OK). */
  function stepScrub(delta) {
    if (!(lastState.duration > 0)) return;
    setScrub(scrubTarget(scrub === null ? lastState.position : scrub, delta, lastState.duration));
    // OK applies at once; otherwise the position is applied by itself when the pointer stops moving.
    clearTimeout(scrubTimer);
    scrubTimer = setTimeout(() => {
      if (!destroyed && scrub !== null) endScrub(true);
    }, SCRUB_CONFIRM_MS);
  }

  // Pointer (Smart Remote / mouse): click or drag on the bar.
  const pointerPosition = (event) => {
    const rect = bar.getBoundingClientRect();
    return positionFromPointer(event.clientX, rect.left, rect.width, lastState.duration);
  };
  seek.addEventListener('mousedown', (event) => {
    if (!(lastState.duration > 0)) return;
    event.preventDefault();
    setScrub(pointerPosition(event));
    showControls();
    const move = (e) => setScrub(pointerPosition(e));
    const up = (e) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setScrub(pointerPosition(e));
      endScrub(true);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  const shown = () => buttonDefs.filter((d) => !d.hidden);
  function setAudioVisible(visible) {
    const def = buttonDefs.find((d) => d.id === 'audio');
    if (!def || def.hidden === !visible) return;
    def.hidden = !visible;
    def.el.style.display = visible ? '' : 'none';
    if (focusIndex >= shown().length) focusIndex = shown().length - 1;
    paintFocus();
  }

  function paintFocus() {
    const list = shown();
    buttonDefs.forEach((def) => def.el.classList.toggle('focused', focusMode && !barFocus && list[focusIndex] === def));
    seek.classList.toggle('focused', focusMode && barFocus);
  }

  /** Position of play / pause among the buttons (the first button for live channels). */
  const startIndex = () => Math.max(0, shown().findIndex((d) => d.id === 'toggle'));

  /** Controls get the focus on play / pause. */
  function enterFocus() {
    focusMode = true;
    barFocus = false;
    focusIndex = startIndex();
    paintFocus();
    showControls();
  }

  /** Up from the player (or from the buttons): the focus goes to the progress pointer. */
  function focusBar() {
    if (isLive) return;
    if (!focusMode) focusIndex = startIndex();
    focusMode = true;
    barFocus = true;
    paintFocus();
    showControls();
  }

  function exitFocus() {
    if (scrub !== null) endScrub(false);
    focusMode = false;
    barFocus = false;
    paintFocus();
    showControls();
  }

  /** Subtitle text delivered by the engine: shown by the app for the time the engine gives. */
  function showSubtitle(text, durationMs) {
    clearTimeout(subtitleTimer);
    const clean = cleanSubtitle(text);
    subtitleEl.textContent = clean;
    subtitleEl.classList.toggle('visible', Boolean(clean));
    // The engine says for how long; without a usable duration the line is replaced by the next one or cleared after a while.
    if (clean) subtitleTimer = setTimeout(() => subtitleEl.classList.remove('visible'), durationMs > 0 ? durationMs : SUBTITLE_FALLBACK_MS);
  }

  function cycleAspect() {
    aspect = nextAspect(ASPECT_MODES, aspect);
    if (engine.setAspect) engine.setAspect(aspect);
    ctx.notices.info(`${t('player.aspect')}: ${t(`player.aspect.${aspect}`)}`, { scope: 'playback', key: 'aspect' });
  }

  async function openSubtitles() {
    const tracks = engine.getSubtitleTracks ? engine.getSubtitleTracks() : [];
    if (!tracks.length) {
      ctx.notices.warning(t('player.subtitles.none'), { scope: 'playback', key: 'track' });
      return;
    }
    const options = [
      { label: t('player.subtitles.off'), value: -1 },
      ...tracks.map((track, i) => ({ label: subtitleLabel(track, i + 1, t('player.track')), value: track.index })),
    ];
    const value = await ctx.dialogs.choose({ title: t('player.subtitles'), options, selected: subtitle });
    if (value === null || destroyed) return;
    subtitle = value;
    showSubtitle('');
    showControls();
    // The engine call can stall the picture for a moment: let the list close first.
    const chosen = options.find((o) => o.value === value);
    ctx.notices.info(`${t('player.subtitles')}: ${chosen ? chosen.label : ''}`, { scope: 'playback', key: 'track' });
    setTimeout(() => {
      if (!destroyed && engine.setSubtitleTrack) engine.setSubtitleTrack(value < 0 ? null : value);
    }, 150);
  }

  async function openAudio() {
    const tracks = engine.getAudioTracks ? engine.getAudioTracks() : [];
    if (tracks.length < 2) {
      ctx.notices.warning(t('player.audio.none'), { scope: 'playback', key: 'track' });
      return;
    }
    const now = tracks.find((track) => track.current) || tracks[0];
    const options = tracks.map((track, i) => ({ label: subtitleLabel(track, i + 1, t('player.track')), value: track.index }));
    const value = await ctx.dialogs.choose({ title: t('player.audio'), options, selected: audioTrack === null ? now.index : audioTrack });
    if (value === null || destroyed) return;
    audioTrack = value;
    showControls();
    const chosen = options.find((o) => o.value === value);
    ctx.notices.info(`${t('player.audio')}: ${chosen ? chosen.label : ''}`, { scope: 'playback', key: 'track' });
    setTimeout(() => {
      if (!destroyed && engine.setAudioTrack) engine.setAudioTrack(value);
    }, 150);
  }

  function render(state) {
    if (destroyed) return;
    lastState = state;
    if (scrub === null) {
      drawProgress(state.position, state.duration, state.bufferedEnd);
      if (!isLive && lastPosition !== null && Math.abs(state.position - lastPosition) > 3) {
        showControls();
        flashTip();
      }
    }
    lastPosition = state.position;
    let status = '';
    if (state.status === 'loading') status = t('player.loading');
    else if (state.status === 'paused') status = t('player.paused');
    else if (state.buffering > 0 && state.buffering < 100) status = t('player.buffering', { percent: state.buffering });
    statusEl.textContent = status;
    statusEl.classList.toggle('visible', Boolean(status));
    const toggle = buttonDefs.find((d) => d.id === 'toggle');
    if (toggle) {
      const name = state.status === 'paused' ? 'play' : 'pause';
      if (toggle.icon !== name) {
        toggle.icon = name;
        toggle.el.replaceChild(icon(name), toggle.el.firstChild);
        toggle.el.setAttribute('aria-label', name === 'play' ? t('detail.play') : t('player.pause'));
      }
    }
    if (state.status === 'playing' && appliedFor !== loadToken) {
      appliedFor = loadToken;
      if (engine.setAspect && aspect !== 'fit') engine.setAspect(aspect);
      if (engine.getAudioTracks) setAudioVisible(engine.getAudioTracks().length > 1);
    }
    if ((state.status === 'paused' || state.status === 'error' || state.status === 'recovering') && state.status !== lastStatus) showControls();
    if (state.status === 'error' && lastStatus !== 'error') showPlayerError(`${t('error.PLAYER')} ${state.error || ''}`.trim());
    else if (state.status === 'playing') closePlayerError();
    if (state.status === 'recovering') showRecovery(t('player.recovering', { attempt: state.attempt, attempts: state.attempts }));
    else closeRecovery();
    offerNext(state);
    lastStatus = state.status;
    if (state.status === 'ended') onEnded();
  }

  async function saveProgress(force = false) {
    if (isLive) return;
    const state = controller.getState();
    if (!providerId || !(state.duration > 0) || (!force && state.status !== 'playing')) return;
    try {
      await ctx.watch.save({
        key: watchKey(providerId, params.entryKey, episodeKey()),
        providerId,
        entryKey: params.entryKey,
        episodeKey: episodeKey(),
        type: params.type,
        title,
        episodeTitle: current().title || '',
        icon: params.icon || '',
        position: state.status === 'ended' ? state.duration : state.position,
        duration: state.duration,
      });
    } catch (err) {
      log.warn('Saving progress failed', err && err.message);
    }
  }

  async function play(nextIndex = index) {
    index = nextIndex;
    const token = (loadToken += 1);
    closeNextNotice();
    nextOffered = false;
    subtitle = -1;
    audioTrack = null;
    setAudioVisible(false);
    showSubtitle('');
    titleEl.textContent = [title, current().title].filter(Boolean).join(' · ');
    nowEl.textContent = '';
    showControls();
    if (isTrailer) {
      controller.load(youtubeStreamUrl(params.trailer.videoId), { bufferSeconds: 0 });
      return;
    }
    try {
      const client = isLive ? await ctx.active.authenticatedClient() : (await ctx.active.get()).client;
      let startAt = 0;
      providerId = (await ctx.active.get()).provider.id;
      if (!isLive) {
        const record = await ctx.watch.get(watchKey(providerId, params.entryKey, episodeKey()));
        if (record && !params.restart && shouldResume(record.position, record.duration)) startAt = record.position;
      }
      if (destroyed || token !== loadToken) return;
      const { bufferSeconds, timeFormat: clockFormat } = await ctx.settings.get();
      timeFormat = clockFormat || 'auto';
      controller.load(client.streamUrl(params.type, current().id, current().ext), { startAt, bufferSeconds, onSubtitle: showSubtitle });
      if (isLive && ctx.epg) ctx.epg.nowNext(params.epgChannelId).then((n) => { if (!destroyed && n && n.now) nowEl.textContent = n.now.title; }).catch(() => {});
    } catch (err) {
      log.warn('Player start failed', err && err.message);
      showPlayerError(t('error.PLAYER'));
    }
  }

  /** The playback error stays on screen (a notice that does not time out) until the player is closed or the video plays. */
  let errorNotice = null;
  function showPlayerError(message) {
    closePlayerError();
    errorNotice = ctx.notices.error(message, { scope: 'playback', key: 'player-error', permanent: true });
  }
  function closePlayerError() {
    if (errorNotice !== null) ctx.notices.close(errorNotice);
    errorNotice = null;
  }

  /** Another try after a playback problem: a notice (replaced at every attempt), not a text over the video. */
  function showRecovery(message) {
    if (recoverNotice !== null) ctx.notices.close(recoverNotice);
    recoverNotice = ctx.notices.warning(message, { scope: 'playback', key: 'player-recovery', permanent: true });
  }
  function closeRecovery() {
    if (recoverNotice !== null) ctx.notices.close(recoverNotice);
    recoverNotice = null;
  }

  function closeNextNotice() {
    clearInterval(nextTimer);
    nextTimer = null;
    if (nextNotice !== null) ctx.notices.close(nextNotice);
    nextNotice = null;
  }

  /** About two minutes before the end of an episode the next one is offered: OK plays it now (during the end credits). */
  function offerNext(state) {
    if (isLive || isTrailer || nextOffered || state.status !== 'playing' || !(state.duration > NEXT_MIN_DURATION_S)) return;
    if (state.duration - state.position > NEXT_OFFER_S) return;
    const next = neighborEpisode(playlist, index, 1);
    if (!next) return;
    nextOffered = true;
    nextNotice = ctx.notices.info(t('player.next', { seconds: NEXT_COUNTDOWN_S }), { scope: 'playback', key: 'player-next', sticky: true });
    const shown = nextNotice;
    // Always a 10 second countdown from when the notice appears; at zero the next episode starts (autoplay on).
    ctx.settings.get().then((s) => {
      if (nextNotice !== shown || destroyed) return;
      if (!s.autoplayNext) {
        ctx.notices.update(shown, t('player.nextNow'));
        return;
      }
      let left = NEXT_COUNTDOWN_S;
      nextTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) play(next.index);
        else ctx.notices.update(shown, t('player.next', { seconds: left }));
      }, 1000);
    });
  }

  function onEnded() {
    if (isTrailer) {
      ctx.router.back();
      return;
    }
    saveProgress(true);
    const next = neighborEpisode(playlist, index, 1);
    if (isLive || !next) return;
    ctx.settings.get().then((s) => {
      if (s.autoplayNext && !destroyed) play(next.index);
    });
  }

  async function changeChannel(delta) {
    if (!live) return;
    const { db } = await ctx.active.get();
    const page = await pageEntries(db, { type: 'live', categoryId: live.categoryId, offset: Math.max(0, live.offset + delta), limit: 1 });
    const entry = page.entries[0];
    if (!entry || destroyed) return;
    live.offset = Math.max(0, live.offset + delta);
    title = entry.name;
    params.epgChannelId = entry.epgChannelId;
    playlist = [{ id: entry.defaultId, ext: '', title: '' }];
    index = 0;
    play(0);
  }

  function stepEpisode(delta) {
    const next = neighborEpisode(playlist, index, delta);
    if (next) play(next.index);
  }

  const handlers = {
    [Action.ENTER]: () => {
      if (nextNotice !== null) play(neighborEpisode(playlist, index, 1).index);
      else if (['error', 'recovering'].includes(controller.getState().status)) play(index);
      else if (isLive) enterFocus();
      else controller.togglePause();
    },
    [Action.PLAY]: () => controller.getState().status === 'paused' && controller.togglePause(),
    [Action.PAUSE]: () => controller.getState().status === 'playing' && controller.togglePause(),
    [Action.PLAY_PAUSE]: () => controller.togglePause(),
    [Action.LEFT]: () => controller.seekBy(-SEEK_SHORT),
    [Action.RIGHT]: () => controller.seekBy(SEEK_SHORT),
    [Action.REWIND]: () => controller.seekBy(-SEEK_LONG),
    [Action.FAST_FORWARD]: () => controller.seekBy(SEEK_LONG),
    [Action.UP]: () => (isLive ? changeChannel(-1) : focusBar()),
    [Action.DOWN]: () => (isLive ? changeChannel(1) : enterFocus()),
    [Action.CHANNEL_UP]: () => (isLive ? changeChannel(1) : stepEpisode(1)),
    [Action.CHANNEL_DOWN]: () => (isLive ? changeChannel(-1) : stepEpisode(-1)),
    [Action.STOP]: () => ctx.router.back(),
  };

  // Same keys while the controls have the focus: left/right walk over the buttons (or move the pointer),
  // OK presses, Up goes to the progress pointer, Down comes back to the buttons.
  const controlHandlers = {
    [Action.LEFT]: () => {
      if (barFocus) {
        stepScrub(-SCRUB_STEP);
        return;
      }
      focusIndex = Math.max(0, focusIndex - 1);
      paintFocus();
    },
    [Action.RIGHT]: () => {
      if (barFocus) {
        stepScrub(SCRUB_STEP);
        return;
      }
      focusIndex = Math.min(shown().length - 1, focusIndex + 1);
      paintFocus();
    },
    [Action.ENTER]: () => {
      if (!barFocus) shown()[focusIndex].run();
      else if (scrub !== null) endScrub(true);
      else controller.togglePause();
    },
    [Action.UP]: () => {
      if (barFocus) return;
      if (isLive) exitFocus();
      else focusBar();
    },
    [Action.DOWN]: () => {
      if (!barFocus) return;
      if (scrub !== null) endScrub(false);
      barFocus = false;
      paintFocus();
    },
  };

  return {
    el,
    /** Called by main.js before the focus manager: the player owns every key except Back. */
    onAction(action) {
      if (ctx.dialogs && ctx.dialogs.isOpen()) return false; // an open list (subtitles) takes the keys
      const handler = (focusMode && controlHandlers[action]) || handlers[action];
      if (!handler) return false;
      showControls();
      handler();
      return true;
    },
    /** Back first leaves the controls; a second Back leaves the player. */
    onBack() {
      if (!focusMode) return false;
      exitFocus();
      return true;
    },
    mount() {
      ctx.catalog.pause();
      controller.onChange(render);
      saveTimer = setInterval(() => saveProgress(), SAVE_EVERY_MS);
      play(index);
    },
    destroy() {
      destroyed = true;
      closePlayerError();
      closeRecovery();
      closeNextNotice();
      clearTimeout(hideTimer);
      clearTimeout(scrubTimer);
      clearTimeout(subtitleTimer);
      clearInterval(saveTimer);
      saveProgress(true);
      controller.stop();
      ctx.catalog.resume();
    },
  };
}
