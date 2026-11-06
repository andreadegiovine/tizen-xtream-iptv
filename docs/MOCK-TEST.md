# Testing with the Xtream mock and performance measurements

Development-only tools in `scripts/mock-xtream/` (they do not end up in the build): a fake Xtream panel with a large catalog and a script that uses the app in headless Chromium, with the keyboard only like on the TV, and measures the timings.

## Mock server

```
npm run build
npm run mock -- [--port 8090] [--movies 20000] [--series 8000] [--live 3000] [--latency 150] [--img-latency 40] [--kbps 0] [--dist dist]
```

- Account: user `test`, password `test`, URL `http://localhost:8090`.
- Same origin for the app (build in `dist`), API (`/player_api.php`, `/xmltv.php`), images (`/img/...svg`, cached by the browser) and a fake TMDB (`/tmdb/3/...`, `/tmdbimg/...`): no CORS problems.
- Deterministic catalog (same seed, same catalog): 15% of titles without a TMDB id, 30% without genres, 7% without a poster, 1% adult, channels with quality variants (HD, FHD, 4K...) and country for the grouping; 48-hour XMLTV EPG (one channel in 25 has only "EPG not available" programmes, which the app must treat as no guide).
- `--latency` is the delay of every API response, `--img-latency` that of images, `--kbps` limits the bandwidth (0 = no limit, gzip responses).
- `GET /__stats` gives the requests received by type, `POST /__stats` resets them.
- It also works with the development build (`/__proxy` and `/__media` are handled).

## Measurements

With the server running:

```
npm run perf -- [--url http://localhost:8090] [--tmdb] [--cpu 4] [--profile] [--out report.json] [--shots folder]
```

Path: first run (parental PIN, provider), full catalog sync, home, Movies / Series / Live cold, grid (30 × down), warm restart, search, detail page, Settings, 20 s of inactivity. For each step: time to the visible cards and their posters, main-thread long tasks (> 50 ms), JS heap, requests to the server.

- `--tmdb` sets a TMDB key (the fake TMDB answers) to measure those flows too.
- `--cpu 4` slows the CPU down 4 times (applies to the main thread, not to the workers): closer to a TV.
- `--profile` adds to each step the functions that kept the main thread busiest (better with a development build, readable names: `npx webpack --mode development --output-path /tmp/distdev` and `--dist /tmp/distdev` for the server).
- The numbers are from a PC: on the TV they must be multiplied (slower CPU and IndexedDB). They serve to compare before/after a change.

## Before / after comparison

```
npm run perf -- --out reference.json        # on the starting version
npm run perf -- --out new.json              # after the change (same options)
npm run perf:compare -- reference.json new.json [--threshold 25] [--min-ms 80]
```

For each step it compares the timings felt in the interface (cards, posters, search results, detail page, long tasks) and the sync durations: it marks `✗` what got worse by more than the threshold (25%) and by more than 80 ms, `✓` what improved. It exits with code 1 if something got worse: to be used before delivering a change. Two runs of the same version differ by a few tens of ms: to decide you need repeated differences, not a single value.

The last step of `perf.js` simulates a startup after 12 hours with the same catalog: the sync re-reads the lists and, with the differential sync, writes nothing (`changes: 0`).
