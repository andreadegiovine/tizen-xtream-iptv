import { rowSegments, segmentAt, scrollFor, xOf, floorHalfHour, createEpgGuide, nextProgramme, PX_PER_MIN, ROW_HEIGHT, RULER_HEIGHT } from '../../src/ui/components/epgGuide.js';

const M = 60000;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a row is its programmes on the axis, holes filled, clipped at both ends', () => {
  const start = 0;
  const end = 240 * M;
  const segs = rowSegments([{ start: -30 * M, stop: 30 * M, title: 'A' }, { start: 60 * M, stop: 90 * M, title: 'B' }, { start: 200 * M, stop: 400 * M, title: 'C' }], start, end);
  expect(segs.map((s) => [s.start / M, s.stop / M, s.title || (s.empty ? '-' : '')])).toEqual([[0, 30, 'A'], [30, 60, '-'], [60, 90, 'B'], [90, 200, '-'], [200, 240, 'C']]);
  expect(rowSegments([], start, end)).toEqual([{ start, stop: end, title: '', empty: true }]); // no guide: one segment, still focusable
  expect(segmentAt(segs, 75 * M)).toBe(2);
  expect(segmentAt(segs, 999 * M)).toBe(4);
});

test('the axis scrolls so that the focused programme is visible', () => {
  expect(xOf(30 * M, 0)).toBe(30 * PX_PER_MIN);
  const seg = { start: 120 * M, stop: 150 * M };
  expect(scrollFor(seg, 0, 0, 600)).toBe(120 * PX_PER_MIN + 30 * PX_PER_MIN - 600); // its end comes in from the right
  expect(scrollFor(seg, 0, 2000, 600)).toBe(120 * PX_PER_MIN); // its start comes in from the left
  expect(scrollFor({ start: 0, stop: 600 * M }, 0, 300, 600)).toBe(300); // already fills the screen: nothing moves
  expect(scrollFor({ start: 100 * M, stop: 600 * M }, 0, 0, 600)).toBe(100 * PX_PER_MIN); // longer than the screen: its start comes in
  expect(floorHalfHour(45 * M)).toBe(30 * M);
});

test('Up / Down keep the time, Left / Right go from programme to programme, Left from the first one leaves', async () => {
  const now = 1000 * 30 * M; // on a half hour
  const rows = [
    { key: 'live:1', type: 'live', name: 'One', epgChannelId: 'one' },
    { key: 'live:2', type: 'live', name: 'Two', epgChannelId: 'two' },
    { key: 'live:3', type: 'live', name: 'Three', epgChannelId: null },
  ];
  const guide = {
    one: [{ start: now - 10 * M, stop: now + 20 * M, title: 'News' }, { start: now + 20 * M, stop: now + 80 * M, title: 'Film' }],
    two: [{ start: now - 60 * M, stop: now + 60 * M, title: 'Match' }],
  };
  const opened = [];
  const g = createEpgGuide({
    loadRows: async (offset, limit) => ({ entries: rows.slice(offset, offset + limit) }),
    countRows: async () => rows.length,
    programmes: async (ids) => new Map(ids.map((id) => [id, guide[id] || []])),
    onOpen: (entry, row) => opened.push([entry.key, row]),
    now: () => now,
  });
  document.body.appendChild(g.el);
  await g.start();
  await tick();
  await tick();
  g.onFocus();
  const focusedTitle = () => (g.el.querySelector('.epg-prog.focused .epg-prog-title') || {}).textContent;
  expect(focusedTitle()).toBe('News'); // the programme on now
  expect(g.el.querySelectorAll('.epg-tick').length).toBeGreaterThan(40); // hours and half hours
  expect(g.model.navigate('right')).toEqual({ type: 'move', index: 0 });
  expect(focusedTitle()).toBe('Film');
  g.model.navigate('down');
  expect(focusedTitle()).toBe('Match'); // same time on the next channel
  g.model.navigate('down');
  expect(focusedTitle()).toBe('No information'); // a channel without guide is one segment
  g.activate();
  expect(opened).toEqual([['live:3', 2]]);
  g.model.navigate('up');
  g.model.navigate('up');
  expect(focusedTitle()).toBe('Film'); // back at the time of "Film"
  g.model.navigate('left');
  expect(focusedTitle()).toBe('News');
  // The axis starts at the current half hour: "News", begun 10 minutes ago, is the first programme, Left leaves.
  expect(g.model.navigate('left')).toEqual({ type: 'exit', dir: 'left' });
  expect(g.el.querySelector('.epg-tick').textContent).toBe(g.el.querySelector('.epg-corner').textContent);
  expect(g.model.navigate('up')).toEqual({ type: 'exit', dir: 'up' });
  expect(g.state().row).toBe(0);
  g.destroy();
  g.el.remove();
});

test('OK held selects the row and shows its actions; Left / Right move between them, OK runs one, Back gives the focus back', async () => {
  const now = 1000 * 30 * M;
  const rows = [{ key: 'live:1', type: 'live', name: 'One', epgChannelId: 'one' }];
  const ran = [];
  const g = createEpgGuide({
    loadRows: async () => ({ entries: rows }),
    countRows: async () => 1,
    programmes: async () => new Map([['one', [{ start: now, stop: now + 30 * M, title: 'News' }]]]),
    onOpen: () => ran.push('open'),
    rowActions: [{ id: 'down', icon: 'moveDown', label: 'Down' }, { id: 'up', icon: 'moveUp', label: 'Up' }, { id: 'remove', icon: 'remove', label: 'Remove' }],
    defaultRowAction: 1,
    onRowAction: (id, entry) => ran.push(`${id}:${entry.key}`),
    now: () => now,
  });
  document.body.appendChild(g.el);
  await g.start();
  await tick();
  g.onFocus();
  g.longActivate();
  expect(g.inRowMode()).toBe(true);
  expect(g.el.querySelector('.guide-row-selection').style.display).toBe('');
  expect(g.el.querySelector('.guide-row-actions .focused').getAttribute('aria-label')).toBe('Up');
  g.model.navigate('right');
  g.activate();
  expect(ran).toEqual(['remove:live:1']);
  expect(g.cancelRowMode()).toBe(true);
  expect(g.cancelRowMode()).toBe(false);
  g.activate();
  expect(ran).toEqual(['remove:live:1', 'open']);
  g.destroy();
  g.el.remove();
});

test('the closest programme of a row: the one on, else the next, else the last', () => {
  const segs = rowSegments([{ start: 30 * M, stop: 60 * M, title: 'A' }, { start: 120 * M, stop: 150 * M, title: 'B' }], 0, 240 * M);
  expect(nextProgramme(segs, 40 * M)).toBe(1); // A is on
  expect(nextProgramme(segs, 90 * M)).toBe(3); // B is next
  expect(nextProgramme(segs, 200 * M)).toBe(3); // both over: the last one
  expect(nextProgramme(rowSegments([], 0, 240 * M), 0)).toBe(-1);
});

test('with pickSegment every row reached focuses the programme it picks; OK opens the channel with that programme; the rows fill the screen', async () => {
  const now = 1000 * 30 * M;
  const rows = [
    { key: 'live:1', type: 'live', name: 'One', epgChannelId: 'one' },
    { key: 'live:2', type: 'live', name: 'Two', epgChannelId: 'two' },
  ];
  const guide = {
    one: [{ start: now + 120 * M, stop: now + 150 * M, title: 'Later' }],
    two: [{ start: now + 300 * M, stop: now + 330 * M, title: 'Evening' }, { start: now + 600 * M, stop: now + 630 * M, title: 'Night' }],
  };
  const opened = [];
  const g = createEpgGuide({
    loadRows: async (offset, limit) => ({ entries: rows.slice(offset, offset + limit) }),
    countRows: async () => rows.length,
    programmes: async (ids) => new Map(ids.map((id) => [id, guide[id] || []])),
    onOpen: (entry, row, programme) => opened.push([entry.key, programme && programme.title]),
    pickSegment: nextProgramme,
    emptyText: '',
    now: () => now,
  });
  document.body.appendChild(g.el);
  await g.start();
  await tick();
  await tick();
  g.onFocus();
  const focusedTitle = () => (g.el.querySelector('.epg-prog.focused .epg-prog-title') || {}).textContent;
  expect(focusedTitle()).toBe('Later'); // not the empty hour at the current time
  g.model.navigate('down');
  expect(focusedTitle()).toBe('Evening');
  g.activate();
  expect(opened).toEqual([['live:2', 'Evening']]);
  g.model.navigate('right');
  g.model.navigate('right');
  expect(focusedTitle()).toBe('Night');
  g.model.navigate('up');
  expect(focusedTitle()).toBe('Later');
  // No fixed height: from where the rows start (under the hours; jsdom has no layout) down to the bottom of the screen.
  expect(parseInt(g.el.querySelector('.epg-rows').style.height, 10)).toBe(Math.max(ROW_HEIGHT * 2, window.innerHeight - RULER_HEIGHT));
  g.destroy();
  g.el.remove();
});

test('the axis never starts more than 30 minutes ago: when a new half hour begins it moves on', async () => {
  jest.useFakeTimers();
  let now = 1000 * 30 * M + 20 * M; // 20 minutes into a half hour
  const rows = [{ key: 'live:1', type: 'live', name: 'One', epgChannelId: 'one' }];
  const reads = [];
  const g = createEpgGuide({
    loadRows: async (offset, limit) => ({ entries: rows.slice(offset, offset + limit) }),
    countRows: async () => rows.length,
    programmes: async (ids, from) => {
      reads.push(from);
      return new Map(ids.map((id) => [id, [{ start: 1000 * 30 * M - 60 * M, stop: 1000 * 30 * M + 90 * M, title: 'Long' }]]));
    },
    now: () => now,
  });
  document.body.appendChild(g.el);
  await g.start();
  await Promise.resolve();
  const firstTick = () => g.el.querySelector('.epg-tick');
  const startOf = (ms) => Math.floor(ms / (30 * M)) * 30 * M;
  expect(reads[0]).toBe(startOf(now)); // 20 minutes before now, not more
  now += 15 * M; // the next half hour began 5 minutes ago
  jest.advanceTimersByTime(30000);
  await Promise.resolve();
  await Promise.resolve();
  expect(reads[reads.length - 1]).toBe(startOf(now));
  expect(firstTick().className).toBe('epg-tick half'); // the axis now starts at the half past
  g.destroy();
  g.el.remove();
  jest.useRealTimers();
});

test('programmesOnly: Left / Right skip the holes, only programmes take the focus', async () => {
  const now = 1000 * 30 * M;
  const rows = [{ key: 'live:1', type: 'live', name: 'One', epgChannelId: 'one' }];
  const guide = { one: [{ start: now + 60 * M, stop: now + 90 * M, title: 'A' }, { start: now + 300 * M, stop: now + 330 * M, title: 'B' }] };
  const g = createEpgGuide({
    loadRows: async (offset, limit) => ({ entries: rows.slice(offset, offset + limit) }),
    countRows: async () => rows.length,
    programmes: async (ids) => new Map(ids.map((id) => [id, guide[id] || []])),
    onOpen: () => undefined,
    pickSegment: nextProgramme,
    programmesOnly: true,
    emptyText: '',
    now: () => now,
  });
  document.body.appendChild(g.el);
  await g.start();
  await tick();
  await tick();
  g.onFocus();
  const focusedTitle = () => (g.el.querySelector('.epg-prog.focused .epg-prog-title') || {}).textContent;
  expect(focusedTitle()).toBe('A');
  g.model.navigate('right');
  expect(focusedTitle()).toBe('B'); // over the hole between them
  expect(g.model.navigate('right')).toEqual({ type: 'move', index: 0 }); // nothing after: stays
  expect(focusedTitle()).toBe('B');
  g.model.navigate('left');
  expect(focusedTitle()).toBe('A');
  expect(g.model.navigate('left')).toEqual({ type: 'exit', dir: 'left' }); // only a hole before: leaves
  g.destroy();
  g.el.remove();
});
