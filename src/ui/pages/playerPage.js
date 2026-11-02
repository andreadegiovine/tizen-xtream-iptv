import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { Action } from '../../core/input.js';
import { log } from '../../core/logger.js';
import { createPlayerController, formatClock, neighborEpisode } from '../../services/playerController.js';
import { watchKey, shouldResume } from '../../services/watchStore.js';
import { pageEntries } from '../../services/catalogQuery.js';

const CONTROLS_MS = 4000;
const SAVE_EVERY_MS = 10000;
const NEXT_COUNTDOWN_S = 10;
const SEEK_SHORT = 10;
const SEEK_LONG = 30;

/**
 * Full-screen player. All controls are HTML on top of the video plane; keys arrive through
 * `onAction` (see main.js) so the page does not need a focus zone.
 * params: { type, entryKey, title, icon, playlist: [{ id, ext, title, season?, number? }], index,
 *           live?: { categoryId, offset } }
 */
export function createPlayerPage(ctx, params) {
  const controller = createPlayerController({ engine: ctx.createEngine() });
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

  const titleEl = h('div', { class: 'player-title' });
  const statusEl = h('div', { class: 'player-status' });
  const nowEl = h('div', { class: 'player-now' });
  const timeEl = h('span', { class: 'player-time' });
  const fill = h('div', { class: 'player-fill' });
  const bar = h('div', { class: 'player-bar' }, fill);
  const nextEl = h('div', { class: 'player-next' });
  const controls = h('div', { class: 'player-controls' }, titleEl, nowEl, h('div', { class: 'player-progress' }, timeEl, bar));
  const el = h('section', { class: 'player' }, controls, statusEl, nextEl);

  const current = () => playlist[index];
  const episodeKey = () => (params.type === 'series' && current().season !== undefined ? `s${current().season}e${current().number}` : null);

  function showControls() {
    controls.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => controls.classList.remove('visible'), CONTROLS_MS);
  }

  function render(state) {
    if (destroyed) return;
    const pct = state.duration > 0 ? (state.position / state.duration) * 100 : 0;
    fill.style.width = `${Math.min(100, pct)}%`;
    bar.style.visibility = isLive ? 'hidden' : '';
    timeEl.textContent = isLive ? t('player.live') : `${formatClock(state.position)} / ${formatClock(state.duration)}`;
    let status = '';
    if (state.status === 'loading') status = t('player.loading');
    else if (state.status === 'paused') status = t('player.paused');
    else if (state.status === 'error') status = `${t('error.PLAYER')} ${state.error || ''}`.trim();
    else if (state.buffering > 0 && state.buffering < 100) status = t('player.buffering', { percent: state.buffering });
    statusEl.textContent = status;
    statusEl.classList.toggle('visible', Boolean(status));
    if (state.status === 'paused' || state.status === 'error') showControls();
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
      controller.load(client.streamUrl(params.type, current().id, current().ext), { startAt, bufferSeconds });
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
    [Action.ENTER]: () => (countdownTimer ? play(neighborEpisode(playlist, index, 1).index) : controller.getState().status === 'error' ? play(index) : controller.togglePause()),
    [Action.PLAY]: () => controller.getState().status === 'paused' && controller.togglePause(),
    [Action.PAUSE]: () => controller.getState().status === 'playing' && controller.togglePause(),
    [Action.PLAY_PAUSE]: () => controller.togglePause(),
    [Action.LEFT]: () => controller.seekBy(-SEEK_SHORT),
    [Action.RIGHT]: () => controller.seekBy(SEEK_SHORT),
    [Action.REWIND]: () => controller.seekBy(-SEEK_LONG),
    [Action.FAST_FORWARD]: () => controller.seekBy(SEEK_LONG),
    [Action.UP]: () => (isLive ? changeChannel(-1) : null),
    [Action.DOWN]: () => (isLive ? changeChannel(1) : null),
    [Action.CHANNEL_UP]: () => (isLive ? changeChannel(1) : stepEpisode(1)),
    [Action.CHANNEL_DOWN]: () => (isLive ? changeChannel(-1) : stepEpisode(-1)),
    [Action.STOP]: () => ctx.router.back(),
  };

  return {
    el,
    /** Called by main.js before the focus manager: the player owns every key except Back. */
    onAction(action) {
      const handler = handlers[action];
      if (!handler) return false;
      showControls();
      handler();
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
      clearInterval(saveTimer);
      cancelCountdown();
      saveProgress(true);
      controller.stop();
      ctx.catalog.resume();
    },
  };
}
