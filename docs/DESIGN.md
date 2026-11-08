# Design decisions

Decisions agreed during the design phase. Update this file when a decision changes.

## Platform and tooling
- Target: Samsung QE75Q70AATXZT (2021, Tizen 6.0, Chromium ~76), installed by sideloading.
- Vanilla ES6 (no UI library, no TypeScript), SCSS, webpack 5. Production output is a
  Tizen widget with separate JS/CSS files. Development: `npm run dev` in a desktop browser (keyboard as remote, dev proxy for the provider); the TV runs the signed build.
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
- Trailers: the provider's `youtube_trailer`, otherwise the TMDB trailer (`videos`). They play in the app's own player through a YouTube engine (iframe + postMessage); on the TV the player page comes from the `ytresolver` service on localhost:8125 because a `file://` page has no origin YouTube accepts.
- TMDB metadata is stored in the app DB by tmdb id + language (`meta:<type>:<id>:<lang>`, `expiresAt`, index `byExpires`), independent of the provider. A worker downloads it for the whole catalog; requests for visible cards and the open page go first and pause the worker.

## Grouping and titles
- Trust the provider's tmdb id. Items without one are never merged, even if TMDB matching finds an id.
- Default stream = lowest stream id; the dropdown lists stream ids.
- A group's `added` is the maximum of its members.
- Card title: TMDB title when available, otherwise the normalized provider title. Card rating comes
  from the provider (TMDB only as a fallback). Series season/episode counts load lazily.
- Matching without tmdb id is conservative: prefer no metadata over wrong metadata.

## UI
- Netflix-like top bar: Home (icon), Search (icon), Movies, TV Series, Live TV, Favorites, Suggestions, then Provider
  and Settings (icons) pushed to the right edge. Search opens a full-width field in the bar (close icon on the right): from 2 characters
  the results page is shown without pressing Enter; Enter/Down moves to the results, Back closes the search.
- One spacing unit (`$gutter`, 48 px) for the screen sides, bar → content and sidebar → content. Pages are full width.
- Icons: Font Awesome Free solid, imported one by one and inlined as SVG (`src/ui/icons.js`); css-loader runs with
  `url:false`, so web-font files would not be shipped.
- Cards are the same size for every type (224 px wide, 2:3 poster): rating badge top-right, watched / partial badge
  top-left, one line of title, one smaller line `year · S7 · E87`.
- Favorites, Suggestions and search results are one carousel per type (movies / series / channels), not one grid.
  Favorites live in the app DB (`kv`, key `favorites`), per provider; the heart on the detail page toggles them.
- There is a single card component for every content type (titles, episodes, cast, channels): square corners, same size.
- Model-based focus (data indices, not geometry); `.focused` class; transform/opacity animations only.
- Category side panel with an "All" entry as default; paginated grids with a page bar and CH+/CH-.
- Posters 2:3 for every card (channel logos are contained inside the same box). Custom dropdowns (`selectField`) with label.
- Detail page: icon-only play / resume buttons, version dropdown under the subtitle, plot, category chips, genre tags, season
  dropdown (no label) + episode carousel (series), cast carousel (TMDB credits, placeholder when no photo; not clickable yet).
  Buttons: play, trailer (only when the provider sends `youtube_trailer`), resume, watched, favourite.
- Player: title at the top; a full-width progress bar (no frame; Up puts the focus on the pointer, left/right move it by 30 s, OK applies, or pointer drag) and below it one row: play-pause (initial focus), previous / next episode (series, only when they exist) and the time on the left, aspect ratio, subtitles and, for series with "play the next episode" on, the end-credits button (last) on the right. Seeking is done with the pointer (and left / right, rewind / fast forward). Subtitles are drawn by the app from AVPlay events (`setSilentSubtitle(false)` while a track is chosen, `true` when off; AVPlay never draws them itself).
- Browse sidebar (Movies/Series): Show all, Continue watching, Favorites, Suggestions, Genres (an open group; provider + TMDB merged under one normalised, untranslated key; only those with titles), Categories (expandable group). Counts and genres still being worked out show skeleton placeholders. Detail chips link back to the matching filter. API keys can be typed in Settings; suggestions come from TMDB or Trakt (setting). Fixed entries have an icon (genres and categories do not, and have no empty slot); every entry shows its title count on the right; categories under the toggle use a smaller font.
  Down (or OK on live) puts the D-pad on the buttons, Back leaves that mode first.
- AVPlay is the engine; all player controls are built in HTML. On-screen keyboard is the native IME.
- Settings, Providers and Categories use a centred 1400 px container (`.page-container`) whose content is full width. Settings starts with "Operations in progress" (stop button per operation); the visible-categories chooser opens from an icon on each provider.
- Settings: grid sizes are multiples of 12 (12/24/36), carousels 10/15/20/30, buffering 2/5/10/20/30 s.

## Flows
- Provider setup uses manual fields. First sync is progressive. Background work pauses during playback.
- Live format is chosen automatically (HLS preferred, TS as fallback) from the account's allowed formats.
- A title counts as watched past 90 %; position saved every 10 s. Next episode autoplays after a
  10 s countdown (can be disabled).
- Deleting a provider keeps tmdb-based watch history.
- One `AppError` type (code, severity, retryable, i18n key). Credentials are masked in all logs.
- EPG: now-playing on the card, next 24 h on the channel page; downloaded in the background at most
  once a day, as the last start-up task (see patch 121); only programs ending in the future and starting within 48 h are kept.
- Suggestions: TMDB recommendations seeded from watch history (trending as fallback), intersected with
  the provider catalog by tmdb id. Trakt follows in a second phase behind the watch-state adapter.

## Back, exit and sections (2026-11-02)
- Back: open dialog → closes it; page with history → back; other section → Home; Home / first run → exit confirmation (default "Stay").
- The top bar highlights the current *section*; when the section changes the focus stays on the bar.

## Catalog sync (2026-11-02)
- A single implementation (`catalogSync.js`) in a worker loaded from a file; fallback on the main thread.
- Order movies → series → live; TTL 12 h; starts when the app opens and after adding a provider; paused during playback.
- New rows first, old ones deleted afterwards; an empty list does not replace an existing catalog.
- Provider schema v2: `items` without indexes, `entries` without a tmdb index (key `type:t<tmdbId>`).


## Provider (2026-11-02)
- The Provider section = list (`providers`) with Use/Edit/Remove per row and "Add"; the form (`providerSetup`) serves both adding and editing (`params.providerId`).
- Changing the active provider = `setActiveId` + `catalog.start()` (cancels the running job).

## Browsing the catalog (2026-11-02)
- One `browse` page for movies/series/live: categories on the left, paginated grid on the right (21 titles per page). Pages are read with cursors on the `byTypeAdded` / `byCatAdded` indexes; no full list is ever loaded in memory.
- Sync details and manual update: at the top of Settings (Catalog, Metadata and Device tables, each with its own button; then the Preferences title). The Provider section has only the list.

## Playback, watch state and metadata (2026-11-02, night)
- A single `playerController` (state machine) on top of an interchangeable engine: AVPlay on the TV, `<video>` in a desktop browser. Controls are HTML.
- Watch state in the app DB, key `movie:t<tmdb>` (shared across providers) or `<provider>:movie:i<id>`; series per episode. Trakt is an adapter over the local store, which remains the source for resuming.
- `activeProvider` is the single shared handle on the active provider's DB and client.
- TMDB/Trakt keys are not in the repository nor in the build: they are typed in Settings.
- EPG: XMLTV filtered for the channels present, read in blocks in a worker, once a day after every other start-up task.
- Suggestions: TMDB recommendations from the history, intersected by tmdb id with the catalog.

## Favorites of categories and genres, light TMDB records (2026-11-03)
Favorites can be titles or filters (`kind` category/genre). Filter cards come before titles and open the grid (`openFilter`). The TMDB database keeps only `gridMeta`; full details are fetched with `getFull` and live in memory. Suggestions do not propose titles already seen.
The favorites heart sits in the grid's sticky header (title · page · heart), zone `browseHead`. Directors come from the full TMDB record (`directors`).

## Notices, clock, pins and parental control (2026-11-04)
Notices use a single service (`ctx.notices`): on the right, centred, without focus (they close by themselves, permanent ones with a click); during playback only those with `scope: 'playback'`. The clock is in the top bar (not focusable), formats in `settings`. Pins are `pins` (kv) and appear in the sidebar between Suggestions and Genres. The parental PIN is stored with a salted hash; a title is adult if one of its categories has an adult name, and the detail page opens only through `ctx.openEntry`, which asks for the PIN.

Grouped Live channels: `src/services/liveGrouping.js` (pure) decides the groups during sync/rebuild; the groups are in the `groups` store, the "Show all" rows (`@all`) in `entry_cat`. `getEntry` and `pageEntries` read from `groups` for the `live:g…` keys. Manual links are in the kv `liveLinks:<provider>`.

## Collections

- A collection (`src/services/collections.js`, `kv` `collections`) is a named set of items of a provider: movies, series, channels and Live groups (the `entryKeys` are saved; those no longer in the catalog are skipped without deleting them).
- Genres are not stored: they are the union of the items' genres (`entryGenres` reads `entry_genre` and `entry_genre_tmdb` by key prefix; channels have none).
- Favorites: `favorites` record with key `collection:<id>` and type `collection` (they do not appear in the pages by type). Pinned genres: `pins` with type `collection`.
- "Collections" page (sidebar + grid) and `collection` detail page (count, genres, Favorites/Edit/Delete, carousel). Adding starts from a title's detail page with `dialogs.search` (the same box as the channel merge, with `createLabel` for the "create" row); editing uses `dialogs.editCollection`.

## Catalog download: retries

- Categories and lists (`syncType`) go through `loadWithRetries`: if the provider gives an error (network, timeout, HTTP, unreadable response) or an empty list, it retries 2 times with growing pauses (`retryPolicy.delays`, 3 s and 8 s), showing "retry n/2" in the `retry` phase. After the last attempt the error is thrown, the empty list accepted if there is no saved catalog (if there is, the "empty list" rejection stands: nothing is deleted). Non-retryable errors (authentication, cancellation) are not retried; cancelling the sync also interrupts the pause. It adds to the single attempt of `fetchJson` for timeout/5xx.

## Live TV networks

- A network collects the channels and groups that start with the same word (≥ 2 items; `networkToken` discards generic words, numbers and short words). It is computed in the same sync/rebuild as the groups (`buildNetworks` after `groupLiveItems`) and saved in the `groups` store with key `live:n<id>` (`isCompositeKey` is true for groups and networks); in "Show all" it is listed first (then groups without a network, then channels with neither group nor network; network members are not repeated).
- Algorithm (`analyzeNetworks`): names are compared without spaces, symbols and accents, in lowercase (`Rai 3 +1` → `rai31`). Sorted, a name joins the previous network as long as the common start of all names (min 3 characters) stays at least **X%** of each name (`liveNetworkSimilarity`, default 50) and no name exceeds the common start by more than **N** characters (`liveNetworkMaxDiff`, default 13). Words are letters and digits (every other character is a space, multiple spaces → one) and a word repeated right after itself counts once (`Dazn: Dazn 1` → `Dazn 1`, also in `channelBase`). The network name is the common start, written as in the channels with single spaces (uppercase → title case, acronyms ≤ 3 letters stay) and carried to the end of the word (`amazonprime1`/`…10` → `Amazon Prime`). Discarded are the repeated name (`duplicates`, also "X" and "X Channel"), the generic one (`generic`: Sport, TV…) and the one that cuts a word in half (`partial`: `Vene` for Veneto/Venezia). Defaults chosen on ~200 names from real reports (grid of threshold 20–100%, difference 1–30): below 50% wrong names enter (precision 0.71 at 20%), above 50% networks are lost (recall 0.47 at 60%); beyond 13 characters nothing changes. Known limit: brands with different sub-brands (`Sky Cinema …`, `Sky Sport …`, `Rai Sport`) have a common start that is too short and do not merge.
- The report (networks with evidence, discarded names, units left out) is saved in `meta` (`networkReport`, discarded sorted by size, max 150) at every Live sync/rebuild and shown in Diagnostics.
- Manual additions: `[streamId, networkId]` in `liveNetworkLinks:<provider>` (`linkNetwork`/`unlinkNetwork`), valid only for existing networks; only these can be removed. A unit (group or channel) belongs to the network if one of its streams is linked.
- Channels and groups carry `networkKey`. Favorites = title record with the network key; collections = key among the `entryKeys`. `ctx.openEntry` opens the `network` page for networks.

- The words to remove from names (`liveGroupPatterns`) add to the default ones (`resolveTerms`: defaults + additions), keep the upper/lower case as written and accept `/regex/`; they apply to single-channel names (`cleanChannelNames`) and to groups, before networks and groups are computed.
- A network can be added to favorites (title record with the `live:n…` key) and pinned in the Live sidebar (`pins` with `kind: 'network'`).

## Collection images and connection

- A collection's page has a rectangular poster (like movies and series); only the Network entity uses the square poster.
- `imageRotator.js`: two overlapping layers with a fade; each rotator picks at random (never the same twice in a row) among the images of the titles, with preloading. Poster and background are independent rotators, so they are not coupled. The background also uses the TMDB backdrops of titles with a `tmdbId` (first 12) as they arrive.
- Device: the "Internet connection" row uses `navigator.onLine`, `navigator.connection` (type, `effectiveType`, `downlink`, `rtt`) and `tizen.systeminfo` `NETWORK` when present; the quality fields appear only if the browser provides them.
- Player: the aspect-ratio change uses the standard notices (`scope: 'playback'`, `key: 'aspect'`) like audio and subtitles; the `player-flash` box was removed.

See also `docs/MULTIPLATFORM.md`.

## Started titles and end time

- `STARTED_RATIO = 0.1`: `isStarted` is true beyond 10% (exclusive); `shouldResume` = started and not finished (before: at least 30 s). `WatchStore.recent` groups the records by title: a movie stays if started and not watched; a series stays if one of its episodes is finished or started.
- "Watched" then removed runs `clearEntry` (no record remains), so the title is not started.
- Player: `endsAtText` = current time + remaining time; `timeFormat` format of the settings (like the clock). Not shown for live or unknown duration.

## Text size, screensaver, card posters

- `html { font-size: 16px }`; all `font-size` values in the stylesheet are in **rem** (px / 16) and `body` is 1.625rem (26 px). rem is used and not em because ems compound across nested elements and would have changed the relative sizes. `applyTextSize` (core/textSize.js) sets the `<html>` font to 12 / 16 / 20 px. Box measures stay in px: at 125% long texts are truncated as already happens.
- Screensaver (ui/screensaver.js): listens in capture to keys and pointer; after 15 minutes it shows a black overlay with the logo (`MARK`) that changes place and size every 10 s; the first event closes it and is swallowed. Suspended in the player page and when the preference is off.
- `rotatePoster` (imageRotator.js): cards with `posters` (collections) change image every 8 s on a single shared `setInterval`; cards no longer in the DOM (`isConnected`) leave the round by themselves, so no destructors are needed.
- Screensaver: `screensaver` is in minutes (`SCREENSAVER_OPTIONS = [0, 1, 5, 15]`, 0 = off); `setMinutes` replaces `setEnabled`. A boolean saved by earlier versions counts as 15 (true) or 0 (false).

## Forms, search, cache (patch 70)

- `field.js`, `formPage.js`: reusable text field, form (fields, action row) and framed page; `formModel` handles the focus (Down from the last field → Confirm).
- Search: index in `search.worker.js` (fallback on the main thread), warmed up at startup and invalidated at every `catalogChanged()`; history in `searchHistory` (last 10); the page shows recents, skeleton or results.
- Adult: the provider's `is_adult` flag, then a regex on the name.
- Images: loading at 600px, release at 1800px, `decoding=async`, skeleton on return.
- `pageCache`: `sidebar:` and `page:` keys; suspended during catalog jobs, emptied at the end, on language change and on `catalogChanged()`.
- `connectivity.js`: offline notice.

## Player on PC (patch 71)

Development only: `scripts/dev-media-proxy.js` serves `/__media?u=…` (Range, redirects, rewritten HLS playlists); `createHtml5Engine` chooses hls.js, mpegts.js or native `<video>` from `devStreamKind`. `__DEV__` guard → in production the demuxers do not enter the bundle. Limits: codecs the browser does not support (HEVC/AC3, MKV) may not play; the proxy does not handle providers bound to IP/UA.

## Alignment with Trakt (patch 78)

- Keys: titles with a tmdb id use `movie:t{id}` / `series:t{id}|sXeY`, the same locally and on Trakt; the others are never sent.
- Sending: queue in `kv` of `{op: add|remove, payload, id}`; `flush()` returns the accepted ids; 5xx stays queued, 4xx discarded. Records sent successfully have `traktSynced: true`.
- Manual: `markWatched`/`clearEntry` → a single call on the title (`reportManual`), never per episode.
- Progress: `reportProgress` (scrobble pause, 1–99 %) on pause and close; best effort, no queue.
- Reading (`importFromTrakt`): empties the queue, reads watched movies/series and `/sync/playback`; marks watched, removes watched marks already aligned but no longer on Trakt (`source: 'trakt'` or `traktSynced`), applies the most recent progress only with a known local duration.

Additions (patch 79): `trakt.progress` in `kv` = one progress per title (the most recent) not yet sent, retried by `flush()`; `playbackItems` also carries title, episode and duration (Trakt's runtime, or 100 / 45 min); `sendHistory` sends in bulk (200 records per call) the watched titles with `traktSynced` false, also at startup (`pushUnsent`); from 99 % progress is no longer a scrobble but a watched title.

## Images and scrolling containers (patch 80)

`lazyImage.js` observes each image from its container (`.carousel-track` or `.page`) with an explicit `root`: without it, `overflow` containers clip without margin and `rootMargin` has no effect. The observers are one per container; the image is not yet in the document when the card is born, so registration happens on the next frame.

## Queued startup and derived data
Everything derived from the catalog (search rows, sidebar with genres and counts) is saved in the provider db (`meta`, `derived:*` keys) with the version `schema|catalogRev|genresRev|language`; the version is read before computing and every sync invalidates it. Startup tasks go through `backgroundQueue` (one at a time, by priority, blocked during the catalog sync).

## Genres: TMDB replaces the provider
For a title with TMDB genres (`entry_genre_tmdb`, `|tmdb`) the provider rows (`entry_genre` and `|info`) are deleted in `writeGenres`, and `writeEntries` does not rewrite `entry_genre` for those titles. `clearTmdb` rewrites the provider list from the entries.

## Rebuilds, differential sync, style (patches 90–93)
- Every rebuild of titles from saved data goes through `ctx.rebuildCatalog(types)` → `startRebuild()` (`catalogRebuild.js`): `rebuild` op in the catalog worker, fallback on the main thread, stoppable `rebuild` operation. No page calls `rebuildEntries` directly any more.
- The sync compares each row with the saved one (`snapshot()` + JSON) and writes only the differences; `rewrite` (forced update from Settings) rewrites everything. `catalogRev` changes only if something changed.
- Genres from the provider: only without a TMDB key, 1 request/s, 500 per day (`genres:daily`). Title cleaning: `cleanTitles` preference.
- Style: `src/styles/main.scss` imports the files per part of the interface in the original order; colors only in `_tokens.scss`; animations only on `transform`/`opacity`; Inter font from `@fontsource/inter` copied by webpack into `dist/fonts`.
- "Automatic" dates and times follow the app language (`formatClockTime/formatClockDate(date, format, locale)`).

## Several providers: what is shared (patch 114)
- Favorites, collections and pins are one list in the app database, visible to every provider. Keys mean the same everywhere (`shareKeys.js`): TMDB id for movies and series (`movie:t603`), normalised name for channel groups and networks, folded name for categories, genre key for genres. A provider's own title (no TMDB id) is stored with the provider id (`<providerId>@movie:i12`).
- A provider that does not carry a saved item shows nothing for it; nothing is deleted. Counts count what the provider can show.
- A title saved under a provider key moves to the shared key once its row has a TMDB id (`portableKeyFor`); duplicates merge.
- The Programme layout is shared (`createGuideLayoutStore`). Hidden categories, manual Live links and scheduled viewings stay per provider.
- Desktop: normal resizable window; the player's full-screen button (`toggleFullscreen`) and F11 switch it.

## Custom EPG and Trakt counters (patch 115)
- `settings.customEpgUrl`: an http(s) XMLTV address. The field (Preferences → Live TV, last) saves it only when `isEpgUrl` accepts it and `probeGuide` finds a `<tv` start in the answer; an empty value clears it. `runEpgForProvider` tries the custom guide first and falls back to the provider's when it fails (an abort is not a failure); saving forces a new download. Channels are still matched by the provider's `epgChannelId`.
- Settings → Trakt shows two more rows, watched and continue watching titles aligned with Trakt (`watch.traktCounts()`: watched records with `source: 'trakt'` or `traktSynced`; unfinished records with `source: 'trakt'`).

## Subtitles from OpenSubtitles (patch 117)
- `src/services/openSubtitles.js`: `GET /subtitles` by `tmdb_id` (movies) or `parent_tmdb_id` + season + episode, languages = app language then English (parameters sorted, lowercase); best file = language order, not machine / AI translated, most downloaded; `POST /download` → link → SRT / WebVTT text → cues. Headers `Api-Key` and `X-User-Agent` (browsers cannot set `User-Agent`). Results stay in memory for the session (same title: no second download); nothing is written to the databases.
- Player (since patch 120): when Subtitles is pressed and a key is set (whatever tracks the engine lists), before the list opens, the TMDB id comes from the key (`movie:t…`) or from the provider row (`portableKeyFor`); notice "Downloading subtitles" (closed when the title changes or the player closes), then "Subtitles downloaded: <language>" or "none found" / "failed". The track is added to the Subtitles list (`value: 'online'`); when chosen, the page draws the cue at `engine.getTime()` every 200 ms (the engine's own track is switched off).

## Series: episode buttons and end credits (patch 118)
- The player has no back / forward 30 s buttons any more (the pointer, left / right and rewind / fast forward seek). Series get previous / next episode buttons, visible only when that episode exists (no tooltip).
- End credits (`creditsStore.js`, app database, key `creditsStart`): seconds before the end, per series, under the shared key (`series:t…`, from `portableKeyFor` when the provider row has a TMDB id) or the provider's own one. The button (last on the right, tooltip "End credits start", shown only with "play the next episode" on) saves `duration - position`; pressed again ("Remove end credits start", accent colour) it deletes it. Every episode draws the part of the bar after `duration - offset` darker (`.player-credits`) and offers the next episode (10 s countdown) from that point; an episode shorter than the offset, or a series without a point, keeps the rule of the last two minutes.

## Clear button of the text fields (patch 119)
- Every text field (`createField`, `clearable` by default) has an "x" at the right edge inside its box (`.field-clear`), visible only while the field or the x has the focus (the box stays highlighted on the x: `.clearing`). Right from the field (before OK opens the keyboard) moves to the x, Left goes back; OK or a click on it empties the field and opens the keyboard (Done saves as usual, Cancel restores).
- Settings: the x is a `secondary: 'right'` row of the field (`clearRowOf`). Since patch 122 the fields have no reset button: a field with a default value (`createField({ defaultValue })`, the network similarity and difference) gets it back from the x instead of being emptied. Provider form: `formModel({ clearable: true })` adds one index per field after the actions (`fieldCount + actionCount + i`).

## Guide download, guide rows and guide genres (patch 121)
- Download: the background queue has a last priority `EPG` (after the search index). The `epg` task is added at start-up, after every catalog sync and every hour while the app is open; it only calls `epg.maybeSync()` (the download runs in its worker, the task does not wait for it) and `maybeSync` downloads only when the last download is 24 h old. Opening Live TV or a live channel no longer starts it. Settings → Catalog has a "TV guide (EPG)" row (programmes · channels with a guide · genres · valid until · updated, or "in progress" while the `epg` operation runs) with update (forced download) and remove (`clearEpg`: programmes, summary and last-download record) buttons.
- Channel summary (`epgChannels.js`, `meta` record `epg:channels`), written by `syncEpg` from the programmes it stores: per channel the span (`from` / `to`) and the genres. The XMLTV parser keeps up to four `<category>` per programme (`categories`). Genres are folded (`genreKey`: case, accents, spacing); a channel has the genres carried by at least 30 % of its programmes with categories (the most frequent always). The record is valid until its last programme ends (`until`); the next download replaces it.
- Guide rows (`guideIndex.js`, `meta` record `guide:rows`): `[key, epgChannelId]` of the groups and the ungrouped channels with a guide id, by name, written with the Live TV entries (`writeEntries`, sync and rebuild) and deleted with them; a catalog stored before it existed builds it once. The guide page filters it with the summary (`channelsWithGuide`, without walking the programmes; the old walk stays for a guide downloaded before the summary existed), applies the layout and reads the entries only for the rows it draws (`loadRows` → `getEntry`).
- Live TV sidebar: when the summary has genres, a "Genres" entry (`epgGenresToggle`, open by default, before Networks) lists them (`epgGenre`) with the number of rows (groups and ungrouped channels) that have them; the grid shows those rows. Not pinnable or favourite (they change with the guide).
- Player of a series: previous episode, play / pause, next episode (play / pause keeps the focus when the controls open).

## Settings fields, dialogs, guide genres as favourites (patch 122)
- Preferences: no reset buttons next to the text fields (`.row-reset` removed). The x of a field with a default puts the default in it and opens the keyboard (Done saves it, Cancel restores). The words removed from channel names have no default of their own (empty = only the built-in words), so their x empties the field.
- Dialogs: `.dialog` hides its overflow and every `::-webkit-scrollbar` inside it (older Chromium ignores `scrollbar-width`); `.choice-list` has `overflow-x: hidden` and a long word in a choice wraps (`overflow-wrap`).
- Guide genres (`epgGenre`) can be favourites (filter record `epgGenre:live:<key>`) and pins, like categories and genres. They are kept when the guide no longer has them: `favoriteFilterEntries(saved, categoriesOf, epgGenresOf)` and the sidebar's `pinnedView` show only the keys of the current guide (`epg.genreRows()`), so they come back with a later guide that has them. The favourite card counts the rows of the genre.
- Live TV sidebar: with guide genres listed, "Networks" starts closed (open when the page opens on a network); the saved page state still wins when coming back.

## Subtitles: AVPlay, OpenSubtitles timing, position (patch 123)
- AVPlay: `setSilentSubtitle(true)` is never called (suspected of stopping `onsubtitlechange` for good on some firmwares); lines are ignored while no track is chosen. Choosing a text track stops and opens the same address again, selects the track in the READY state (`setSelectTrack('TEXT', i)`, `setSilentSubtitle(false)`), seeks to the old position and plays; the page is not told about the new prepare. Off only stops drawing. The log counts the lines with text received since the choice (`AVPlay subtitle event … lines`).
- OpenSubtitles: with the address being played, `fetch(query, { url })` reads bytes 0–64 KB and the last 64 KB with `Range` requests (size from `Content-Range`; a server answering 200 is cancelled and no hash is sent) and adds `moviehash` to the search. `pickSubtitle` ranks a `moviehash_match` right after the language. The hash is computed on 32-bit halves (`movieHash`, no BigInt); checked against a reference on a real MKV served with ranges.
- Timing: the subtitle list has "OpenSubtitles timing: ±x s" while downloaded subtitles exist; it opens −15…+15 s in 0.5 s steps (`onlineDelay`, per title, reset on the next title) and switches them on. The cue on is `cueAt(cues, position − delay)`.
- The subtitle line sits `controls.offsetHeight − 96 + 24` px from the bottom while the controls are shown (`placeSubtitle`, animated), at its usual place when they fade.

## Clear without keyboard, now playing everywhere, programmes in the search (patch 124)
- The x of a field (`createField`) sets the empty or default value and saves it at once (`onSubmit(value, null)`, or `onClear(value)` when given), without focusing the input: no keyboard. The provider form passes an `onClear` that only empties the field (the form does not move to the next field).
- Now playing: every Live TV card goes through `ctx.enrich(…, 'live')` → `epg.decorate`, which needs the card's `epgChannelId`; the search rows (`loadSearchRows`) now carry it for channels and groups, so channels found by the search show the programme on air too.
- Programme search: `epg.searchProgrammes(query)` reads the stored programmes once per guide download (`titlesJob`, title + folded search key, placeholders left out; warmed when the search opens) and returns those of the next 24 hours whose title has every word, whole title first, then titles starting with the query, then on air and by start, one per channel and title, mapped to their Live TV row through the guide index. The search page adds them as `type: 'programme'` entries (carousel "On TV" after Live TV): the row's picture, a clock badge (`isProgramme`), "start – end" in the clock format of the settings; OK opens the row's page with `programme: start`, which lands the focus on it.
