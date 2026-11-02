# Design decisions

Decisions agreed during the design phase. Update this file when a decision changes.

## Platform and tooling
- Target: Samsung QE75Q70AATXZT (2021, Tizen 6.0, Chromium ~76), installed by sideloading.
- Vanilla ES6 (no UI library, no TypeScript), SCSS, webpack 5. Production output is a
  Tizen widget with separate JS/CSS files. Development: the TV opens the dev server on the PC.
- Unit tests (Jest) for pure logic.

## Data
- `app` IndexedDB: providers, settings, watch state, TMDB cache, TMDB title matches (real migrations).
- One `provider_<id>` database per provider: categories, items, entries, entry_cat, details, epg, meta
  (derived data, rebuilt when the schema changes).
- `entries` are what grids show: one per tmdb group (same type) or per ungrouped item.
  `entry_cat` duplicates rows per category so "category + newest first" is a single index range.
- Category exclusions are applied when entries are built (changing them triggers a rebuild).
- Search runs on an in-memory list of normalized titles, not an IndexedDB index.
- TTLs: provider lists 12 h, series details 24 h, TMDB metadata 30 days, TMDB "not found" 7 days.
- TMDB metadata language follows the UI language.

## Grouping and titles
- Trust the provider's tmdb id. Items without one are never merged, even if TMDB matching finds an id.
- Default stream = lowest stream id; the dropdown lists stream ids.
- A group's `added` is the maximum of its members.
- Card title: TMDB title when available, otherwise the normalized provider title. Card rating comes
  from the provider (TMDB only as a fallback). Series season/episode counts load lazily.
- Matching without tmdb id is conservative: prefer no metadata over wrong metadata.

## UI
- Netflix-like top bar: Search, Home, Live TV, Movies, Series, Suggestions, Provider, Settings.
- Model-based focus (data indices, not geometry); `.focused` class; transform/opacity animations only.
- Category side panel with an "All" entry as default; paginated grids with a page bar and CH+/CH-.
- Posters 2:3 for movies and series, 16:9 tiles for channels. Custom dropdown for stream ids.
- AVPlay is the engine; all player controls are built in HTML. On-screen keyboard is the native IME.
- Settings: grid sizes are multiples of 12 (12/24/36), carousels 10/15/20/30, buffering 2/5/10/20/30 s.

## Flows
- Provider setup uses manual fields. First sync is progressive. Background work pauses during playback.
- Live format is chosen automatically (HLS preferred, TS as fallback) from the account's allowed formats.
- A title counts as watched past 90 %; position saved every 10 s. Next episode autoplays after a
  10 s countdown (can be disabled).
- Deleting a provider keeps tmdb-based watch history.
- One `AppError` type (code, severity, retryable, i18n key). Credentials are masked in all logs.
- EPG: now-playing on the card, next 24 h on the channel page; downloaded in the background at most
  once a day when the app is opened; only programs ending in the future and starting within 48 h are kept.
- Suggestions: TMDB recommendations seeded from watch history (trending as fallback), intersected with
  the provider catalog by tmdb id. Trakt follows in a second phase behind the watch-state adapter.
