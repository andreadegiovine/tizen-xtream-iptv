import { t } from '../i18n/index.js';
import { log } from '../core/logger.js';
import { getEntry } from '../services/catalogQuery.js';

/**
 * Scheduled viewing while the app is open: a notice NOTICE_MS before, then the channel starts LEAD_MS before the programme (see
 * scheduledViewing.js); the programme leaves the list when it ends. A timer goes to the next thing due (none while nothing is
 * scheduled), at most a minute away, so a TV that slept or a clock that moved is caught up; and at once when the app is shown again.
 * `ctx`: schedules, notices, router. Returns { openScheduled(id) }: an alert of the system was opened (or started the app): its channel,
 * unless the app opened it already or the programme ended.
 */
export function startInAppScheduling({ ctx, active, doc = document }) {
  /** Opens the channel of a scheduled programme (once: it stays in "Scheduled" until it ends); true when it was opened. */
  async function startScheduled(s) {
    await ctx.schedules.markStarted(s);
    const current = await active.get();
    if (!current || current.provider.id !== s.providerId) return false;
    const entry = await getEntry(current.db, s.entryKey);
    if (!entry) return false;
    log.info(`Scheduled viewing: ${s.title} on ${entry.name}`);
    ctx.router.push('player', { type: 'live', entryKey: entry.key, title: entry.name, icon: entry.icon, playlist: [{ id: entry.defaultId, ext: '', title: '' }], index: 0, epgChannelId: entry.epgChannelId, section: 'live' });
    return true;
  }

  async function runSchedules() {
    await ctx.schedules.prune(); // ended programmes leave "Scheduled"
    const due = await ctx.schedules.due();
    for (const s of due.notice) {
      await ctx.schedules.markNoticed(s);
      ctx.notices.info(t('schedule.startingSoon', { title: s.title, channel: s.entryName }), { key: 'schedule' });
    }
    for (const s of due.start) {
      if (await startScheduled(s)) break; // one channel at a time
    }
  }

  let timer = null;
  let running = false;
  async function plan() {
    clearTimeout(timer);
    timer = null;
    const at = await ctx.schedules.nextAt().catch(() => null);
    if (at === null || running) return;
    timer = setTimeout(async () => {
      running = true;
      try {
        await runSchedules();
      } catch (err) {
        log.warn('Scheduled viewing failed', err && err.message);
      } finally {
        running = false;
        plan();
      }
    }, Math.min(60000, Math.max(1000, at - Date.now() + 50)));
  }
  ctx.schedules.onChange(() => plan());
  plan();
  // Back in the app (its timers may have been slowed down or stopped while hidden): what is due now, at once.
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') plan();
  });

  return {
    async openScheduled(id) {
      const s = (await ctx.schedules.list()).find((item) => item.id === id);
      if (!s || s.started) return;
      await startScheduled(s);
    },
  };
}
