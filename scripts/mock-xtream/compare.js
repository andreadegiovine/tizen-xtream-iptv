#!/usr/bin/env node
/**
 * Compares two reports of perf.js (`--out`): the reference and the new one. For every step it lists the UI figures (time to the cards,
 * to their posters, search results, detail page; main-thread long tasks) and the catalog sync times, and marks as worse what grew more
 * than the threshold AND by more than a minimum number of milliseconds (small figures move a lot between two runs).
 *
 *   node scripts/mock-xtream/compare.js reference.json new.json [--threshold 25] [--min-ms 80]
 *
 * Exit code 1 when something got worse: usable in a script that runs before delivering a change.
 */
const fs = require('fs');

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(args[i + 1]);
};
const THRESHOLD = opt('threshold', 25) / 100;
const MIN_MS = opt('min-ms', 80);

if (files.length < 2) {
  console.error('usage: compare.js reference.json new.json [--threshold 25] [--min-ms 80]');
  process.exit(2);
}
const [before, after] = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));

/** The figures of one step that say how the UI feels (null when the step did not measure them). */
function figures(step) {
  const out = {
    cards: step.cardsMs,
    posters: step.postersMs,
    search: step.resultsAfterLastKeyMs,
    detail: step.detailMs,
    blocked: step.longTasks ? step.longTasks.totalMs : null,
    longest: step.longTasks ? step.longTasks.maxMs : null,
  };
  (step.meta || []).forEach((m) => {
    out[`sync ${m.key.replace('sync:', '')}`] = m.durationMs;
  });
  return out;
}

const byName = new Map(before.steps.map((s) => [s.name, s]));
const worse = [];
const rows = [];
after.steps.forEach((step) => {
  const ref = byName.get(step.name);
  if (!ref) return;
  const a = figures(ref);
  const b = figures(step);
  Object.keys(b).forEach((key) => {
    if (typeof a[key] !== 'number' || typeof b[key] !== 'number') return;
    const delta = b[key] - a[key];
    const bad = delta > MIN_MS && b[key] > a[key] * (1 + THRESHOLD);
    const good = -delta > MIN_MS && b[key] < a[key] * (1 - THRESHOLD);
    rows.push(`${bad ? '✗' : good ? '✓' : ' '} ${step.name} · ${key}: ${a[key]} → ${b[key]} ms`);
    if (bad) worse.push(`${step.name} · ${key}: ${a[key]} → ${b[key]} ms`);
  });
});
console.log(rows.join('\n'));
console.log(worse.length ? `\n${worse.length} worse (> ${Math.round(THRESHOLD * 100)}% and > ${MIN_MS} ms):\n  ${worse.join('\n  ')}` : '\nnothing worse');
process.exit(worse.length ? 1 : 0);
