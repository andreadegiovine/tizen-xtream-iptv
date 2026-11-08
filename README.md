# Xtream IPTV

A fast, TV-first **Xtream Codes** client for **Samsung Tizen**, **LG webOS**, **Android TV / Fire TV** and **Windows, macOS and Linux**.
Browse your provider's movies, series and live channels with the remote control, pick up where you left off, and watch trailers,
cast and guides in a clean interface designed for a 1920x1080 screen. One app, the same on every platform.

<p align="center"><img src="docs/screenshots/home.jpg" alt="Home screen" width="860"></p>

> This project does not provide, host or link to any content. You need your own Xtream Codes provider account.

> **For the best experience, set up TMDB, Trakt and OpenSubtitles** (all free, see [Optional services](#optional-services)): posters,
> plots, cast and trailers, watch history on every device, and subtitles for any title.

## Platforms

Every release on the [Releases](../../releases) page has one package per platform, named `xtream-iptv-<version>_<platform>.<ext>`
(with a `.sha256` checksum).

| Platform | Package | Install guide |
|---|---|---|
| Samsung Tizen TV (6.0 or newer) | `_tizen.wgt`, signed | [`platforms/tizen`](platforms/tizen/README.md) |
| LG webOS TV (6.0 or newer) | `_webos.ipk` | [`platforms/webos`](platforms/webos/README.md) |
| Android TV / Google TV | `_androidtv.apk` | [`platforms/android`](platforms/android/README.md) |
| Amazon Fire TV (Fire OS models) | `_firetv.apk` | [`platforms/android`](platforms/android/README.md) |
| Windows, macOS, Linux | `_windows-x64.exe`, `_macos-x64.dmg`, `_macos-arm64.dmg`, `_linux-x64.AppImage`, `_linux-x64.deb` | [`platforms/desktop`](platforms/desktop/README.md) |

Tizen is developed and tried on a 2021 QLED and the Windows app is tried as well; webOS, Android TV / Fire TV, macOS and Linux are
still being tested on real devices.

## Features

**Catalog**
- **One title, one card.** Duplicates (4K, HD, dubbed, other categories) that share the provider's TMDB id are merged into one card,
  with a dropdown to choose the version. Nothing is merged unless the provider says it is the same title.
- **Built for huge catalogs.** Tens of thousands of titles are synced in a background worker, stored locally and shown in lazily
  loaded grids. The cached catalog opens instantly and refreshes itself in the background.
- **Clean titles and smart filters.** Language prefixes, quality tags and year suffixes are removed (optional). Provider and TMDB
  genres are merged, categories can be hidden per provider, and genres and categories can be pinned to the sidebar or added to the favorites.
- **Search everything** from the top bar: movies, series, channels, collections and the programmes on TV in the next 24 hours.

**Player**
- Draggable progress bar, previous / next episode, an end-credits point set once per series (the next episode is offered from
  there), aspect ratio, audio tracks, subtitles (embedded or from OpenSubtitles, with timing adjustment), adjustable buffering,
  resume and autoplay of the next episode.
- The native engine of each platform: AVPlay on Tizen, the system player on webOS, ExoPlayer on Android.
- Trailers from YouTube: in the app's own player on Samsung TVs, in the YouTube app or the browser elsewhere.

**Live TV**
- The programme on air on every channel card, the next 24 hours on the channel page, a full grid guide and scheduled viewing that
  opens the channel when a programme starts.
- Channels in several qualities grouped into one card, channels of the same network (Rai, Sky, Dazn...) collected together.
- Genres from the guide's categories (Sport, News, Movies...) in the sidebar, which can be pinned or added to the favorites.
- The guide is downloaded once a day after the rest of the start-up work; a custom XMLTV guide can replace the provider's.

**Yours**
- **Continue watching, favorites, collections and suggestions** (based on what you watch, from TMDB or Trakt).
- **Trakt sync with a QR code**: history and progress shared with your other devices.
- **Several providers**, each with its own database; favorites, collections and pins follow you between them.
- **Parental control**: a PIN set on the first start hides adult categories.
- **Private by design**: no account, no analytics; keys stay on the device and credentials are masked in the logs.
- **English and Italian**, following the device language or chosen manually.

## Compared with popular players

A quick look at three widely used IPTV players, from their public descriptions (November 2026; features change, check the official
store listings). "Not advertised" means we found no mention of it, not that it is missing.

| | **Xtream IPTV** | [TiviMate](https://tivimate.com) | [IPTV Smarters Pro](https://www.iptvsmarters.com) | IBO Player |
|---|---|---|---|---|
| Platforms | Tizen, webOS, Android TV / Fire TV, Windows, macOS, Linux | Android TV / Fire TV | Android, Fire TV, Samsung, LG, iOS and others | Android TV / Fire TV, Samsung, LG |
| Xtream Codes login, several providers | Yes | Yes | Yes | Yes |
| Programme guide (EPG grid) | Yes, with a custom XMLTV guide | Yes (its strong point) | Yes | Yes |
| Catch-up / recording | No (catch-up planned) | Catch-up; recording with premium | Catch-up | Not advertised |
| Programmes in the search | Yes | Yes | Not advertised | Not advertised |
| Scheduled viewing (opens the channel when it starts) | Yes | Not advertised | Not advertised | Not advertised |
| Genres from the guide's categories | Yes | Not advertised | Not advertised | Not advertised |
| Quality variants of a channel grouped into one card | Yes, automatic, with manual links | Not advertised | Not advertised | Not advertised |
| TV networks (channels of the same broadcaster collected) | Yes, automatic, with manual links | Not advertised | Not advertised | Not advertised |
| Duplicate movies and series merged into one card | Yes (by TMDB id) | No | No | No |
| Clean titles (no language prefixes, quality tags) | Yes | Not advertised | Not advertised | Not advertised |
| Favourite and pinned categories, genres, networks | Yes | Favourite channels | Favourites | Favourites |
| Collections of movies, series and channels | Yes | Not advertised | Not advertised | Not advertised |
| Favourites, collections and pins shared between providers | Yes (by TMDB id) | Not advertised | Not advertised | Not advertised |
| End-credits point per series (next episode from there) | Yes | Not advertised | Not advertised | Not advertised |
| TMDB posters, plots, cast, trailers | Yes (own free key) | Not advertised | Partly (trailers, info) | Not advertised |
| Trakt history and progress sync | Yes | No | Not advertised | Not advertised |
| Subtitles from OpenSubtitles | Yes, by file hash, with timing | Not advertised | Not advertised | Not advertised |
| Parental control | Yes (PIN) | Yes | Yes | Not advertised |
| Open source, no account, no analytics | Yes | No | No | No |

## Screenshots

| | |
|---|---|
| ![First run](docs/screenshots/first-run.jpg) **First run**: add your provider | ![Home](docs/screenshots/home.jpg) **Home**: new movies, new series, continue watching |
| ![Movies](docs/screenshots/movies.jpg) **Movies**: genres, categories and filters | ![TV series](docs/screenshots/series.jpg) **TV series** |
| ![Live TV](docs/screenshots/live-tv.jpg) **Live TV** with the programme now playing | ![Search](docs/screenshots/search.jpg) **Search** from the top bar |
| ![Movie detail](docs/screenshots/movie-detail.jpg) **Movie**: play, trailer, watched, favorite | ![Series detail](docs/screenshots/series-detail.jpg) **Series**: seasons and episodes |
| ![Player](docs/screenshots/player.jpg) **Player** | ![Favorites](docs/screenshots/favorites.jpg) **Favorites** |
| ![Settings](docs/screenshots/settings.jpg) **Settings**: catalog, TMDB, Trakt, preferences | ![Providers](docs/screenshots/providers.jpg) **Providers** |
| ![Visible categories](docs/screenshots/categories.jpg) **Visible categories** | |

The screenshots use a fictional demo provider.

## First steps

1. **Install the app** with the guide of your platform (see [Platforms](#platforms)).
2. **Add a provider**: name, server URL, username and password. The catalog downloads in the background.
3. **Recommended:** type the TMDB, Trakt and OpenSubtitles keys in **Settings** (see below).

## Optional services

All three are free for personal use. The app works without them, but it is much better with them. Nothing is compiled into the
app: each service stays off until its key is typed in **Settings** (with a remote the on-screen keyboard works; on a phone it is
easier to copy the keys into a note first). The keys stay on the device and are sent only to their own service.

### TMDB: posters, plots, cast, trailers

Posters and backdrops, plots in your language, cast, genres, ratings, trailers and recommendations. The TMDB id also merges the same
title across categories and providers, so favorites, collections and pins follow you from one provider to another.

1. Create a free account on [themoviedb.org](https://www.themoviedb.org) and confirm the email.
2. Open *Profile → Settings → API* ([direct link](https://www.themoviedb.org/settings/api)) and request an API key (type *Developer*; a short description of a personal use is fine).
3. Copy the **API Read Access Token** (v4, the long one) or the 32-character **API Key** (v3) into *Settings → TMDB*.

### Trakt: watch history and progress on every device

What you watch is saved on your Trakt account and read back: *watched* marks and *continue watching* follow you between the TV, the
PC and the phone (and any other app that uses Trakt), and suggestions can be based on your history. *Settings → Trakt* shows how many
titles are aligned.

1. Create a free account on [trakt.tv](https://trakt.tv).
2. Open [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications) and press **New Application**: any name, `urn:ietf:wg:oauth:2.0:oob` as *Redirect uri*, the rest empty.
3. Copy the **Client ID** and **Client Secret** into *Settings → Trakt*, press connect and scan the QR code (or open the address shown and type the code).

### OpenSubtitles: subtitles for any title

Pressing **Subtitles** in the player on a movie or episode with a TMDB id downloads subtitles in your language (then English), also
when the file has its own; they appear in the list next to the file's tracks and stay in memory until the app is closed. The app sends
the video's OpenSubtitles hash (it reads the first and last 64 KB), so subtitles made for that very file come first ("for this file");
others can be moved with **OpenSubtitles timing** in the same list (up to 5 minutes either way, + = later).

1. Create a free account on [opensubtitles.com](https://www.opensubtitles.com).
2. Create a consumer on [opensubtitles.com/consumers](https://www.opensubtitles.com/en/consumers) (any name): it gives an **API key**.
3. Type the key in *Settings → OpenSubtitles*.

Without logging in, OpenSubtitles allows a few downloads a day (5 at the time of writing): each new title uses one, the same title
again in the same session does not.

## Custom EPG

If your provider's guide is missing or poor, *Settings → Preferences → Live TV → Custom EPG* accepts the address of an XMLTV guide
(`http://` or `https://`). It is saved only if it answers with a valid XMLTV file and replaces the provider's guide (which is used
again if it stops working). Channels are matched by the provider's `epg_channel_id`, so the guide must use the same ids. The field's
"x" goes back to the provider's guide.

## Remote control

| Key | Action |
|---|---|
| Arrows | Move the focus |
| OK / Enter | Select (hold on a row of the guide for its actions) |
| Back | Go back / close |
| Channel up / down | In the player: previous / next channel (live) or episode (series) |
| Play / pause / rewind / forward | In the player |
| Left / right in the player | Seek (after OK on the progress bar) |

The desktop app opens as a normal window (the player has a full-screen button) and the keyboard is the remote: arrows, `Enter`,
`Esc` / `Backspace` for Back, `PageUp` / `PageDown` for channel up / down, `Space` for play / pause.

## Documentation

| Document | Content |
|---|---|
| [`platforms/<name>/README.md`](platforms) | Installation and notes per platform: [Tizen](platforms/tizen/README.md), [webOS](platforms/webos/README.md), [Android TV / Fire TV](platforms/android/README.md), [desktop](platforms/desktop/README.md) |
| [`docs/BUILD.md`](docs/BUILD.md) | Building from source, running in a browser, packaging, tests, releases and signing, project layout |
| [`docs/MULTIPLATFORM.md`](docs/MULTIPLATFORM.md) | How the platforms share one app: the adapter, decisions, per-platform details and open issues |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design decisions; read before changing the code |
| [`docs/MILESTONES.md`](docs/MILESTONES.md) | Development history, with what has and has not been verified on a real device |
| [`docs/MOCK-TEST.md`](docs/MOCK-TEST.md) | The fake Xtream server and the performance measurements |

Plain HTML, JavaScript and SCSS (no UI framework), with an extensive unit test suite.

## License

No license has been chosen yet.

---

This repository, its commits and its releases are entirely managed by [Claude](https://claude.ai) (Anthropic).
