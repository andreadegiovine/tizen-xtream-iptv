import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { Action } from '../../core/input.js';
import { log } from '../../core/logger.js';
import { icon } from '../icons.js';
import { createPlayerController, formatClock, neighborEpisode, subtitleLabel, nextAspect, scrubTarget, positionFromPointer } from '../../services/playerController.js';
import { ASPECT_MODES } from '../../services/playerEngines.js';
import { watchKey, shouldResume } from '../../services/watchStore.js';
import { pageEntries } from '../../services/catalogQuery.js';

const CONTROLS_MS = 4000;
const SAVE_EVERY_MS = 10000;
const NEXT_COUNTDOWN_S = 10;
const SEEK_SHORT = 10;
const SEEK_LONG = 30;
const SCRUB_STEP = 30;

/**
 * Full-screen player. All controls are HTML on top of the video plane; keys arrive through
 * `onAction` (see main.js) so the page does not need a focus zone.
 * params: { type, entryKey, title, icon, playlist: [{ id, ext, title, season?, number? }], index,
 *           live?: { categoryId, offset } }
 */
export function createPlayerPage(ctx, params) {
  const engine = ctx.createEngine();
  const controller = createPlayerController({ engine });
  const isLive = params.type === 'live';
  let playlist = params.playlist;
  let index = params.index || 0;
  let live = params.live ? { ...params.live } : null;
  let title = params.title;
  let destroyed = false;
  let hideTimer = null;
  let saveTimer = null;
  let countdownTimer = null;
  let countdown = 0;
  let loadToken = 0;
  let providerId = null; // known once playback started, so saving on exit needs no await
  let aspect = 'fit';
  let subtitle = -1; // -1 = off
  let appliedFor = 0; // load token the aspect mode was last applied to
  let focusMode = false; // the D-pad moves over the control buttons instead of seeking
  let focusIndex = 0;
  let flashTimer = null;
  let lastStatus = '';
  let subtitleTimer = null;
  let scrub = null; // seconds while the user drags / steps the progress bar, otherwise null
  let scrubMode = false; // OK on the bar: left/right move the position instead of the button focus
  let lastState = { position: 0, duration: 0 };
  let lastPosition = null; // previous polled position, to spot jumps (a seek)
  let tipTimer = null;

  const titleEl = h('div', { class: 'player-title' });
  const statusEl = h('div', { class: 'player-status' });
  const nowEl = h('div', { class: 'player-now' });
  const timeEl = h('span', { class: 'player-time' });
  const fill = h('div', { class: 'player-fill' });
  const knob = h('div', { class: 'player-knob' });
  const tip = h('div', { class: 'player-tip' });
  const bar = h('div', { class: 'player-bar' }, fill, knob, tip);
  const seek = h('div', { class: 'player-seek' }, bar);
  const nextEl = h('div', { class: 'player-next' });
  const flashEl = h('div', { class: 'player-flash' });
  const subtitleEl = h('div', { class: 'player-subtitle' });

  // Control buttons: transport in the middle (not for live), aspect ratio + subtitles on the right.
  const buttonDefs = [
    { id: 'back', icon: 'backward', label: () => t('player.back'), vodOnly: true, group: 'center', run: () => controller.seekBy(-SEEK_LONG) },
    { id: 'toggle', icon: 'pause', label: () => t('player.pause'), vodOnly: true, group: 'center', run: () => controller.togglePause() },
    { id: 'forward', icon: 'forward', label: () => t('player.forward'), vodOnly: true, group: 'center', run: () => controller.seekBy(SEEK_LONG) },
    { id: 'seek', vodOnly: true, group: 'bar', el: seek, run: () => toggleScrub() },
    { id: 'aspect', icon: 'aspect', label: () => t('player.aspect'), group: 'end', run: () => cycleAspect() },
    { id: 'subtitles', icon: 'subtitles', label: () => t('player.subtitles'), group: 'end', run: () => openSubtitles() },
  ].filter((def) => !(isLive && def.vodOnly));
  buttonDefs.forEach((def) => {
    if (def.el) return;
    def.el = h('button', { class: 'player-btn', type: 'button', 'aria-label': def.label() }, icon(def.icon));
  });
  const buttonEl = (id) => (buttonDefs.find((d) => d.id === id) || {}).el;
  // One row: back, play/pause, forward, progress bar, time, aspect ratio, subtitles.
  const row = h('div', { class: 'player-row' }, buttonEl('back'), buttonEl('toggle'), buttonEl('forward'), isLive ? h('div', { class: 'player-bar-gap' }) : seek, timeEl, buttonEl('aspect'), buttonEl('subtitles'));
  const top = h('div', { class: 'player-top' }, titleEl, nowEl);
  const controls = h('div', { class: 'player-controls' }, row);
  const el = h('section', { class: 'player' }, top, controls, statusEl, nextEl, flashEl, subtitleEl);

  const current = () => playlist[index];
  const episodeKey = () => (params.type === 'series' && current().season !== undefined ? `s${current().season}e${current().number}` : null);

  function showControls() {
    controls.classList.add('visible');
    top.classList.add('visible');
    clearTimeout(hideTimer);
    // Without a key press for a few seconds everything fades out, the button focus included.
    hideTimer = setTimeout(() => {
      focusMode = false;
      if (scrubMode) endScrub(false);
      paintFocus();
      controls.classList.remove('visible');
      top.classList.remove('visible');
    }, CONTROLS_MS);
  }

  function drawProgress(position, duration) {
    const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    fill.style.width = `${pct}%`;
    knob.style.left = `${pct}%`;
    tip.style.left = `${pct}%`;
    tip.textContent = formatClock(position);
    timeEl.textContent = isLive ? t('player.live') : `${formatClock(position)} / ${formatClock(duration)}`;
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
    drawProgress(scrub, lastState.duration);
  }

  function endScrub(commit) {
    const target = scrub;
    scrub = null;
    scrubMode = false;
    seek.classList.remove('scrubbing');
    tip.classList.remove('visible');
    if (commit && target !== null) controller.seekTo(target);
    drawProgress(commit && target !== null ? target : lastState.position, lastState.duration);
  }

  /** OK on the bar: start moving the position, OK again applies it. */
  function toggleScrub() {
    if (scrubMode) endScrub(true);
    else if (lastState.duration > 0) {
      scrubMode = true;
      setScrub(lastState.position);
    }
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

  function flash(text) {
    flashEl.textContent = text;
    flashEl.classList.add('visible');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => flashEl.classList.remove('visible'), 2000);
  }

  function paintFocus() {
    buttonDefs.forEach((def, i) => def.el.classList.toggle('focused', focusMode && i === focusIndex));
  }

  function enterFocus() {
    const start = buttonDefs.findIndex((d) => d.id === 'toggle');
    focusMode = true;
    focusIndex = start >= 0 ? start : 0;
    paintFocus();
    showControls();
  }

  function exitFocus() {
    focusMode = false;
    paintFocus();
    showControls();
  }

  /** Subtitle text delivered by the engine: shown by the app for the time the engine gives. */
  function showSubtitle(text, durationMs) {
    clearTimeout(subtitleTimer);
    subtitleEl.textContent = text || '';
    subtitleEl.classList.toggle('visible', Boolean(text));
    if (text && durationMs > 0) subtitleTimer = setTimeout(() => subtitleEl.classList.remove('visible'), durationMs);
  }

  function cycleAspect() {
    aspect = nextAspect(ASPECT_MODES, aspect);
    if (engine.setAspect) engine.setAspect(aspect);
    flash(`${t('player.aspect')}: ${t(`player.aspect.${aspect}`)}`);
  }

  async function openSubtitles() {
    const tracks = engine.getSubtitleTracks ? engine.getSubtitleTracks() : [];
    if (!tracks.length) {
      flash(t('player.subtitles.none'));
      return;
    }
    const options = [
      { label: t('player.subtitles.off'), value: -1 },
      ...tracks.map((track, i) => ({ label: subtitleLabel(track, i + 1, t('player.subtitles.track')), value: track.index })),
    ];
    const value = await ctx.dialogs.choose({ title: t('player.subtitles'), options, selected: subtitle });
    if (value === null || destroyed) return;
    subtitle = value;
    showSubtitle('');
    if (engine.setSubtitleTrack) engine.setSubtitleTrack(value < 0 ? null : value);
    showControls();
  }

  function render(state) {
    if (destroyed) return;
    lastState = state;
    if (scrub === null) {
      drawProgress(state.position, state.duration);
      if (!isLive && lastPosition !== null && Math.abs(state.position - lastPosition) > 3) {
        showControls();
        flashTip();
      }
    }
    lastPosition = state.position;
    let status = '';
    if (state.status === 'loading') status = t('player.loading');
    else if (state.status === 'paused') status = t('player.paused');
    else if (state.status === 'error') status = `${t('error.PLAYER')} ${state.error || ''}`.trim();
    else if (state.buffering > 0 && state.buffering < 100) status = t('player.buffering', { percent: state.buffering });
    statusEl.textContent = status;
    statusEl.classList.toggle('visible', Boolean(status));
    const toggle = buttonDefs.find((d) => d.id === 'toggle');
    if (toggle) {
      const name = state.status === 'paused' ? 'play' : 'pause';
      if (toggle.icon !== name) {
        toggle.icon = name;
        toggle.el.replaceChild(icon(name), toggle.el.firstChild);
        toggle.el.setAttribute('aria-label', name === 'play' ? t('player.play') : t('player.pause'));
      }
    }
    if (state.status === 'playing' && appliedFor !== loadToken) {
      appliedFor = loadToken;
      if (engine.setAspect && aspect !== 'fit') engine.setAspect(aspect);
    }
    if ((state.status === 'paused' || state.status === 'error') && state.status !== lastStatus) showControls();
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
    cancelCountdown();
    subtitle = -1;
    showSubtitle('');
    titleEl.textContent = [title, current().title].filter(Boolean).join(' · ');
    nowEl.textContent = '';
    showControls();
    try {
      const client = isLive ? await ctx.active.authenticatedClient() : (await ctx.active.get()).client;
      let startAt = 0;
      providerId = (await ctx.active.get()).provider.id;
      if (!isLive) {
        const record = await ctx.watch.get(watchKey(providerId, params.entryKey, episodeKey()));
        if (record && !params.restart && shouldResume(record.position, record.duration)) startAt = record.position;
      }
      if (destroyed || token !== loadToken) return;
      const { bufferSeconds } = await ctx.settings.get();
      controller.load(client.streamUrl(params.type, current().id, current().ext), { startAt, bufferSeconds, onSubtitle: showSubtitle });
      if (isLive && ctx.epg) ctx.epg.nowNext(params.epgChannelId).then((n) => { if (!destroyed && n && n.now) nowEl.textContent = n.now.title; }).catch(() => {});
    } catch (err) {
      log.warn('Player start failed', err && err.message);
      statusEl.textContent = t('error.PLAYER');
      statusEl.classList.add('visible');
    }
  }

  function cancelCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    nextEl.classList.remove('visible');
  }

  function onEnded() {
    saveProgress(true);
    const next = neighborEpisode(playlist, index, 1);
    if (isLive || !next) return;
    ctx.settings.get().then((s) => {
      if (!s.autoplayNext || destroyed || countdownTimer) return;
      countdown = NEXT_COUNTDOWN_S;
      const label = next.episode.title || `${t('detail.episode')} ${next.episode.number}`;
      const draw = () => {
        nextEl.textContent = t('player.next', { title: label, seconds: countdown });
      };
      draw();
      nextEl.classList.add('visible');
      countdownTimer = setInterval(() => {
        countdown -= 1;
        if (countdown <= 0) play(next.index);
        else draw();
      }, 1000);
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
      if (countdownTimer) play(neighborEpisode(playlist, index, 1).index);
      else if (controller.getState().status === 'error') play(index);
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
    [Action.UP]: () => (isLive ? changeChannel(-1) : null),
    [Action.DOWN]: () => (isLive ? changeChannel(1) : enterFocus()),
    [Action.CHANNEL_UP]: () => (isLive ? changeChannel(1) : stepEpisode(1)),
    [Action.CHANNEL_DOWN]: () => (isLive ? changeChannel(-1) : stepEpisode(-1)),
    [Action.STOP]: () => ctx.router.back(),
  };

  // Same keys while the buttons have the focus: left/right walk over them, OK presses, Up goes back to seeking.
  const buttonHandlers = {
    [Action.LEFT]: () => {
      if (scrubMode) {
        setScrub(scrubTarget(scrub, -SCRUB_STEP, lastState.duration));
        return;
      }
      focusIndex = Math.max(0, focusIndex - 1);
      paintFocus();
    },
    [Action.RIGHT]: () => {
      if (scrubMode) {
        setScrub(scrubTarget(scrub, SCRUB_STEP, lastState.duration));
        return;
      }
      focusIndex = Math.min(buttonDefs.length - 1, focusIndex + 1);
      paintFocus();
    },
    [Action.ENTER]: () => buttonDefs[focusIndex].run(),
    [Action.UP]: () => {
      if (scrubMode) endScrub(false);
      exitFocus();
    },
    [Action.DOWN]: () => undefined,
  };

  return {
    el,
    /** Called by main.js before the focus manager: the player owns every key except Back. */
    onAction(action) {
      if (ctx.dialogs && ctx.dialogs.isOpen()) return false; // an open list (subtitles) takes the keys
      const handler = (focusMode && buttonHandlers[action]) || handlers[action];
      if (!handler) return false;
      showControls();
      handler();
      return true;
    },
    /** Back first leaves the button row; a second Back leaves the player. */
    onBack() {
      if (!focusMode) return false;
      if (scrubMode) endScrub(false);
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
      clearTimeout(hideTimer);
      clearTimeout(flashTimer);
      clearTimeout(subtitleTimer);
      clearInterval(saveTimer);
      cancelCountdown();
      saveProgress(true);
      controller.stop();
      ctx.catalog.resume();
    },
  };
}
