import { kvGet, kvSet } from '../db/kv.js';

const KEY = 'scheduledViewing';
/** The channel starts this long before the programme, after a notice shown NOTICE_MS earlier. */
export const LEAD_MS = 2 * 60 * 1000;
export const NOTICE_MS = 10 * 1000;

/** Id of a scheduled programme: one per provider, channel and start. */
export const scheduleId = (s) => `${s.providerId}|${s.channelId}|${s.start}`;

/**
 * Programmes the user asked to watch: at LEAD_MS before their start the app opens their channel (if it is open), after a notice.
 * One programme per start time at most (two at the same time cannot both be watched). Saved in the app database. A programme stays
 * scheduled (and in "Scheduled" of Live TV) until it ends: `prune()` then removes it and tells the listeners.
 */
export function createScheduledViewing({ db, now = Date.now }) {
  const handlers = new Set();
  let cache = null;
  const notify = () => handlers.forEach((handler) => handler());
  const load = async () => {
    if (!cache) cache = ((await kvGet(db, KEY, [])) || []).filter(Boolean);
    return cache;
  };
  const save = async (list) => {
    cache = list;
    await kvSet(db, KEY, list);
    notify();
  };

  return {
    /** The scheduled programmes of a provider (all when no provider), by start. */
    async list(providerId = null) {
      const all = await load();
      return all.filter((s) => s.stop > now() && (!providerId || s.providerId === providerId)).sort((a, b) => a.start - b.start);
    },
    async has(item) {
      return (await load()).some((s) => scheduleId(s) === scheduleId(item));
    },
    /** Adds one; rejects with code CONFLICT when another programme is already scheduled at the same time. */
    async add(item) {
      const all = await load();
      if (all.some((s) => scheduleId(s) === scheduleId(item))) return;
      if (all.some((s) => s.start === item.start)) {
        const err = new Error('Another programme is scheduled at the same time');
        err.code = 'CONFLICT';
        throw err;
      }
      await save(all.concat([{ ...item, id: scheduleId(item) }]));
    },
    async remove(item) {
      const id = typeof item === 'string' ? item : scheduleId(item);
      await save((await load()).filter((s) => scheduleId(s) !== id));
    },
    /** The programmes whose notice (`notice`) or start of the channel (`start`, once) is due now. */
    async due() {
      const t = now();
      const all = await load();
      return {
        notice: all.filter((s) => !s.noticed && t >= s.start - LEAD_MS - NOTICE_MS && t < s.start - LEAD_MS),
        start: all.filter((s) => !s.started && t >= s.start - LEAD_MS && t < s.stop),
      };
    },
    async markNoticed(item) {
      const all = await load();
      await save(all.map((s) => (scheduleId(s) === scheduleId(item) ? { ...s, noticed: true } : s)));
    },
    /** The channel was opened (or could not be): it is not opened again, the programme stays scheduled until it ends. */
    async markStarted(item) {
      const all = await load();
      await save(all.map((s) => (scheduleId(s) === scheduleId(item) ? { ...s, started: true } : s)));
    },
    /** Removes the programmes that have ended (listeners told only when there were some). Resolves with how many. */
    async prune() {
      const t = now();
      const all = await load();
      const kept = all.filter((s) => s.stop > t);
      if (kept.length !== all.length) await save(kept);
      return all.length - kept.length;
    },
    onChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
