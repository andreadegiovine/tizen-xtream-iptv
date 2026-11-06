# Xtream IPTV

A fast, TV-first **Xtream Codes** client for **Samsung Tizen**, **LG webOS**, **Android TV / Fire TV** and **Windows, macOS and Linux**.
Browse your provider's movies, series and live channels with the remote control, pick up where you left off, and watch
trailers, cast and guides, all in a clean, modern interface designed for a 1920x1080 screen. The same app and the same interface run on every platform.

<p align="center"><img src="docs/screenshots/home.jpg" alt="Home screen" width="860"></p>

> This project does not provide, host or link to any content. You need your own Xtream Codes
> provider account.

## Platforms

Every release on the [Releases](../../releases) page has one package per platform, named `xtream-iptv-<version>_<platform>.<ext>`
(with a `.sha256` checksum). Each platform folder has its own installation guide.

| Platform | Package | Install guide |
|---|---|---|
| Samsung Tizen TV (6.0 or newer) | `_tizen.wgt`, signed | [`platforms/tizen`](platforms/tizen/README.md) |
| LG webOS TV (6.0 or newer) | `_webos.ipk` | [`platforms/webos`](platforms/webos/README.md) |
| Android TV / Google TV | `_androidtv.apk` | [`platforms/android`](platforms/android/README.md) |
| Amazon Fire TV (Fire OS models) | `_firetv.apk` | [`platforms/android`](platforms/android/README.md) |
| Windows, macOS, Linux | `_windows-x64.exe`, `_macos-x64.dmg`, `_macos-arm64.dmg`, `_linux-x64.AppImage`, `_linux-x64.deb` | [`platforms/desktop`](platforms/desktop/README.md) |

Tizen has been developed and tried on a 2021 QLED; the Windows app is tried as well. webOS, Android TV / Fire TV, macOS and Linux are new and still being tested on real devices.

## What makes it different

- **One title, one card.** Provider catalogs are full of duplicates (4K, HD, dubbed, different
  categories). Items that share the provider's TMDB id are merged into a single card, with a
  dropdown to choose the exact version. Nothing is merged unless the provider says it is the same title.
- **Built for huge catalogs.** Tens of thousands of titles are synced in a background worker,
  stored locally and shown through lazily loaded grids, so navigation stays smooth on a TV processor.
  The cached catalog opens instantly and refreshes itself in the background.
- **Clean titles.** Provider noise such as language prefixes, quality tags and year suffixes is removed from movie and series titles
  (can be turned off). With a TMDB key configured you also get posters, plots, cast and genres.
- **Smart filtering.** Genres from the provider and from TMDB are merged into one list, categories
  can be hidden per provider and per type, and every detail page links back to the matching genre or category.
- **Trailers.** The trailer button plays the YouTube trailer in the app's own player on Samsung TVs, with the same controls as a movie;
  on the other platforms it opens the YouTube app or the browser.
- **A real player.** Back / forward 30 s, draggable progress bar, aspect ratio, audio tracks, subtitles, adjustable
  buffering, resume from where you stopped and autoplay of the next episode. The video engine is the one native to each platform
  (AVPlay on Tizen, the system player on webOS, ExoPlayer on Android).
- **Live TV with a programme guide.** Now-playing on every channel card, the next 24 hours on the channel page, a full
  grid guide, and scheduled viewing that opens the channel when a programme starts. Channels with several qualities are grouped
  into one card, and channels of the same network (Rai, Sky, Dazn...) are collected together.
- **Collections.** Group movies, series and channels of your own in named collections, with favorites and pins.
- **Trakt sync with a QR code.** Connect your account by scanning a code with your phone, import your
  history and keep watched titles in sync, or remove everything with one button.
- **Continue watching, favorites and suggestions.** Resume rows, a favorites page, watched marks and
  recommendations based on what you watch (TMDB or Trakt).
- **Parental control.** A PIN set on the first start hides the posters of adult categories and asks for
  the PIN before opening them; change it in Settings > Preferences.
- **Pinned categories and genres.** Pin the ones you use most to the sidebar, or add them to the favorites.
- **Notices.** Errors, warnings and confirmations (finished updates, subscription ending soon) appear in
  one place at the right of the screen, and never cover the video except for playback errors.
- **Local search.** Search movies, series, channels and collections from the top bar, using the on-screen keyboard of the TV.
- **Several providers.** Add as many as you like and switch at any time; each has its own database.
- **Private by design.** No account, no analytics. TMDB and Trakt keys are typed in Settings and
  stay on the device; credentials are masked in logs.
- **English and Italian**, following the device language or chosen manually.
- **Open and tested.** Plain HTML, JavaScript and SCSS (no UI framework) with an extensive unit test suite.

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

1. **Install the app** on your device following the guide of your platform (see [Platforms](#platforms)).
2. **Add a provider**: name, server URL, username and password. The catalog downloads in the background.
3. *(Optional)* In **Settings** type a **TMDB** key to get posters, plots, cast, genres, trailers and suggestions.
   Use the v4 "API Read Access Token" or the 32-character v3 key.
4. *(Optional)* In **Settings** type your Trakt **Client ID** and **Client Secret**, then press connect and scan the QR code.

Nothing about TMDB or Trakt is compiled into the app: both stay off until you add the keys.

## TMDB and Trakt keys

Both services are free for personal use. The app works without them, but with them it is much better. You type the keys in **Settings** (with a remote, the on-screen keyboard works; on a phone it is easier to copy them into a note first).

### TMDB: posters, plots, cast, trailers

What you get: posters and backdrops, plots in your language, cast, genres, ratings, trailers, recommendations, and the TMDB id that merges the same title coming from different categories or providers and lets your favorites, collections and pins follow you from one provider to another.

1. Create a free account on [themoviedb.org](https://www.themoviedb.org) and confirm the email.
2. Open *Profile → Settings → API* ([direct link](https://www.themoviedb.org/settings/api)) and request an API key (type *Developer*; any short description of a personal use is fine).
3. Copy the **API Read Access Token** (the long one, v4) or the 32-character **API Key** (v3) into *Settings → TMDB*.

### Trakt: watch history and progress on every device

What you get: what you watch is saved on your Trakt account and read back, so *watched* marks and *continue watching* follow you between the TV, the PC and the phone (and any other app that uses Trakt). Movies and episodes you finish are sent to Trakt, the ones you already watched there appear as watched here, and the point reached in a title is shared. Suggestions can also be based on your Trakt history. *Settings → Trakt* shows how many watched titles and "continue watching" titles are aligned. Trakt keeps the history; TMDB does not, which is why the two are used together.

1. Create a free account on [trakt.tv](https://trakt.tv).
2. Open [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications) and press **New Application**. Choose any name, put `urn:ietf:wg:oauth:2.0:oob` as *Redirect uri* and leave the rest empty, then save.
3. Copy the **Client ID** and **Client Secret** of the application into *Settings → Trakt*, press connect and scan the QR code (or open the address shown and type the code).

### OpenSubtitles: subtitles for titles that have none

What you get: when a movie or an episode starts without subtitles of its own, and its TMDB id is known (from TMDB or from the provider), the app looks for subtitles on OpenSubtitles in your language (then English) while it plays. A notice says *Downloading subtitles*; when they are found they appear in the player's **Subtitles** list as "<language> (OpenSubtitles)". They are not saved: they stay in memory until the app is closed (and in the browser cache).

1. Create a free account on [opensubtitles.com](https://www.opensubtitles.com).
2. Open the API consumers page of your profile ([opensubtitles.com/consumers](https://www.opensubtitles.com/en/consumers)) and create a consumer (any name): it gives an **API key**.
3. Type the key in *Settings → OpenSubtitles*.

OpenSubtitles limits downloads without logging in to a few a day (5 at the time of writing); every title started without subtitles uses one, the same title again in the same session does not.

The keys stay on your device (they are not part of the app and never sent anywhere but to TMDB / Trakt).

## Custom EPG

If your provider's guide is missing or poor, *Settings → Preferences → Live TV → Custom EPG* accepts the address of an XMLTV guide (`http://` or `https://`). It is saved only if the address answers with a valid XMLTV file; when it is set, it replaces the provider's guide (if it stops working the provider's is used again). The channels are matched by the `epg_channel_id` of the provider, so the guide must use the same ids. Empty the field to go back to the provider's guide.

## Remote control

| Key | Action |
|---|---|
| Arrows | Move the focus |
| OK / Enter | Select (hold on a row of the guide for its actions) |
| Back | Go back / close |
| Channel up / down | In the player: previous / next channel (live) or episode (series) |
| Play / pause / rewind / forward | In the player |
| Left / right in the player | Seek (after OK on the progress bar) |

On the desktop app, which opens as a normal window (the player has a full-screen button), the keyboard is the remote: arrows, `Enter`, `Esc` / `Backspace` for Back, `PageUp` / `PageDown` for channel up / down, `Space` for play / pause.

## Documentation

| Document | Content |
|---|---|
| [`platforms/<name>/README.md`](platforms) | Installation and notes of each platform: [Tizen](platforms/tizen/README.md), [webOS](platforms/webos/README.md), [Android TV / Fire TV](platforms/android/README.md), [desktop](platforms/desktop/README.md) |
| [`docs/BUILD.md`](docs/BUILD.md) | Building from source, running in a browser, packaging, tests, releases and signing, project layout |
| [`docs/MULTIPLATFORM.md`](docs/MULTIPLATFORM.md) | How the platforms share one app: the adapter, decisions, per-platform details and open issues |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design decisions; read before changing the code |
| [`docs/MILESTONES.md`](docs/MILESTONES.md) | Development history, with what has and has not been verified on a real device |
| [`docs/MOCK-TEST.md`](docs/MOCK-TEST.md) | The fake Xtream server and the performance measurements |

## License

No license has been chosen yet.
