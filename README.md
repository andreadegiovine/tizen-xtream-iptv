# Xtream IPTV

A Netflix-style **Xtream Codes** client for **Samsung Tizen TVs**, written as a plain
HTML/JS/SCSS web app (no UI framework) and bundled with webpack.

> **Status: early development (milestone 1 + part of milestone 2).**
> The foundations are in place and unit-tested: tooling, remote-control input, focus
> navigation, router, i18n, IndexedDB layer, Xtream API client, title normalisation and
> tmdb grouping. Catalog sync, browsing pages, the player, EPG, TMDB and Trakt are **not
> implemented yet** (see the [roadmap](#roadmap)). Nothing has been run on a real TV yet;
> the built-in **Diagnostics** page exists precisely to do that first check.

This project does not provide, host or link to any content. You need your own Xtream Codes
provider account.

## Features (target)

- Multiple providers, switchable at runtime; provider configured on first launch
- Home carousels: new movies, new series, continue watching, suggested movies/series
- Live TV, Movies and TV Series pages with provider categories, paginated grids,
  items ordered by date added
- Titles sharing a provider tmdb id are grouped; a dropdown picks the stream id
  (lowest id preselected). Titles without tmdb id are never merged
- TMDB metadata (text only, cached) and provider-supplied images
- EPG for live channels (now playing on the card, next 24 h on the channel page)
- Settings: buffering time, carousel size, grid size, per-type category exclusion
- Native Tizen player (AVPlay) and native on-screen keyboard
- Local cache; Trakt sync planned as a second phase
- English (`en-US`) and Italian (`it-IT`)

## Optional API keys

TMDB metadata/suggestions and Trakt are compiled in at build time and stay off when the keys are missing:

| Variable | Used for |
|---|---|
| `TMDB_API_KEY` | TMDB v3 API key (titles, posters, suggestions) |
| `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET` | Trakt device login and history |

Locally: `TMDB_API_KEY=... npm start`. For releases add them as repository secrets with the same names.
Keys that are compiled into an app can be extracted from the package: use dedicated, revocable keys.

## Requirements

- Node.js 18 or newer
- A Samsung TV with Tizen 6.0 or newer (developed against a 2021 QLED, Chromium ~76)
- For installing on the TV: [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download)
  (or its CLI) and a Samsung certificate profile

## Getting started

```bash
npm ci
npm test          # unit tests
npm run lint
npm run dev       # dev server on http://localhost:8080
```

The dev server also runs a same-origin proxy (`/__proxy`) for provider API calls, so the app
works in a desktop browser without CORS problems. In a desktop browser the remote control is
emulated with the keyboard: arrows, `Enter`, `Esc`/`Backspace` = Back, `PageUp`/`PageDown` =
channel up/down.

### Developing on the TV (live reload from your PC)

1. Enable Developer Mode on the TV (Apps panel → press `12345` → Developer mode **On**, enter
   your PC's IP address) and connect Tizen Studio's Device Manager to the TV.
2. Generate the small "dev shell" widget that opens your PC's dev server:

   ```bash
   DEV_HOST=<your-pc-ip> npm run tizen:dev-shell   # writes build/dev-shell/
   ```

3. Build, sign and install `build/dev-shell` once (Tizen Studio: *Build Signed Package*, then
   *Run As*; or `tizen package -t wgt -s <profile> -- build/dev-shell` followed by
   `tizen install -n <file>.wgt -t <tv-name>`).
4. Run `npm run dev:tv` on the PC (it also injects Tizen's `webapis.js`) and launch the widget.
   Saving a source file reloads the app on the TV.

Notes: the dev shell loads a remote page, so the browser's CORS rules apply, which is why API
calls go through the dev proxy. `webapis` (AVPlay) may behave differently in a remote page than
in a packaged app; the Diagnostics page reports what is actually available.

### Production build and installation

```bash
npm run build           # output in dist/
```

`dist/` is a complete Tizen widget (`config.xml`, `index.html`, `js/`, `css/`, icon). Sign and
install it with your own certificate:

```bash
tizen package -t wgt -s <your-profile> -- dist
sdb connect <tv-ip>
tizen install -n dist/XtreamIPTV.wgt -t <tv-name>
```

### Releases

Publishing a GitHub release triggers `.github/workflows/release.yml`, which validates the tag
(`v1.2.3` or `1.2.3`), stamps that version into the build, runs lint and tests, builds, and
uploads `xtream-iptv-<version>.zip` (the contents of `dist/`) plus a `.sha256` file to the release.

The release asset is **unsigned**: Tizen requires your own author/distributor certificate, which
should not live in a public repository. Unzip it and run the `tizen package` / `tizen install`
commands above. Automated signing (certificate stored as encrypted secrets) can be added later.

## Project layout

```
src/
  core/       env, errors, logger (masks credentials), http (timeout/retry), idb, input
  db/         app database (settings, providers, watch state) and one database per provider
  services/   Xtream client, item projection, title normalisation, grouping, settings, diagnostics
  ui/         focus manager + navigation models, router, topbar, pages
  i18n/       dictionaries (en-US, it-IT) and plural-aware t()
  styles/     SCSS (Netflix-like dark theme, designed for a 1920x1080 space)
tizen/        config.xml and icon copied into the build
scripts/      dev proxy and dev-shell generator
test/         Jest tests (jsdom + fake-indexeddb)
docs/DESIGN.md  agreed design decisions
```

Design rules worth knowing:

- UI depends on services, services on core, never the other way round.
- Logic that can be shared lives in one function/module (one URL builder, one query layer,
  one focus manager, one error type).
- Focus navigation works on data indices rather than on-screen geometry, so lists can be
  virtualized.
- Provider databases hold only derived data and are rebuilt on schema change; the app database
  (providers, settings, watch history) uses real migrations.
- The TV runs Chromium ~76: the build targets it, and ESLint blocks APIs such as
  `String.replaceAll`, `.at()` and `structuredClone`. CSS must avoid flexbox `gap` and
  `aspect-ratio`.

## Roadmap

| # | Milestone | State |
|---|-----------|-------|
| 0 | Spike on a real TV (CORS, `webapis`, workers, AVPlay, storage quota) | Diagnostics run on the TV (partial results in `docs/MILESTONES.md`) |
| 1 | Foundations: input, focus, router, i18n, errors, settings | Done |
| 2 | Provider and catalog: client, setup, databases, normalizer, grouping | Catalog sync (worker + fallback) done, not yet verified on the TV |
| 3 | Navigation: topbar, grids, category panel, pagination, search | Done off-TV |
| 4 | Detail page and player with custom controls, watch state | Done off-TV (new player not yet run on the TV) |
| 5 | TMDB matching and metadata | Done, needs a TMDB key in the build |
| 6 | EPG (XMLTV in a worker, now/next, 24 h on the channel page) | Done off-TV |
| 7 | Home carousels, complete settings, hidden categories | Done off-TV |
| 8 | Suggestions | Done, needs a TMDB key |
| 9 | Trakt (second phase) | Done, needs Trakt keys; never run against Trakt |
| 10 | Performance and memory pass on the TV | Open: needs the TV |
| 11 | Final round of tests on the TV | Open (list in `docs/MILESTONES.md`) |
| 12 | UI redesign: icons, search in the bar, full-width layout, new cards, detail and player | Done off-TV (2026-11-03) |

## Application and package ids

The widget uses package id `XtrmIptv01` and application id `XtrmIptv01.XtreamIPTV`
(`tizen/config.xml`). Change them before creating your certificate profile if you prefer others.
Declared privileges (internet, remote-control input, network info, product info) still need to be
confirmed on a device during milestone 0.

## License

No license has been chosen yet.
