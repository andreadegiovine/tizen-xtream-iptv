# Xtream IPTV — App description for Samsung certification

Content of the Seller Office "App Description File": the filled template is [`App_Description_Xtream_IPTV.pptx`](App_Description_Xtream_IPTV.pptx) (template `App_Description_template_eng_v.1.42`); the sections below are the same content as text, for the
other fields of the submission.

## 1. Application overview

| Item | Value |
|---|---|
| App name | Xtream IPTV |
| Package / App ID | `XtrmIptv01` / `XtrmIptv01.XtreamIPTV` |
| Version | the version of the uploaded `_tizen.wgt` |
| Category | Video |
| Type | Web application (Tizen 6.0+), no in-app purchases, no ads, no login to a service of ours |
| Languages | English, Italian (follows the TV language, can be changed in Settings) |
| Resolution | 1920x1080 |

**Purpose.** Xtream IPTV is a player for the IPTV service the user already subscribes to. The user adds a provider (Xtream Codes
account, or an M3U playlist with an optional XMLTV guide); the app downloads the catalog and plays movies, series and live channels with
the TV's player (AVPlay). The app ships no content and has no content of its own.

## 2. Test account

No account is needed. The app has no login of its own: testers add a "provider", and a public playlist of free, legally broadcast
channels works for any number of testers at the same time.

| Field | Value (same for every model group) |
|---|---|
| Provider kind | M3U / XMLTV |
| Name | Test |
| M3U playlist URL | `https://iptv-org.github.io/iptv/countries/it.m3u` |
| XMLTV guide URL | (leave empty) |

Other public playlists of the same project, if a country's list is down: `https://iptv-org.github.io/iptv/countries/uk.m3u`,
`https://iptv-org.github.io/iptv/categories/news.m3u`.

Scenarios that differ by provider:

| Scenario | How to test it |
|---|---|
| Live TV and programme guide | the playlist above (its channels have a guide when the playlist names one) |
| Movies and series (VOD) | needs an Xtream Codes account of a real provider; the app's behaviour is the same as for live channels (grid → detail page → player) |
| Parental control | at the first start a 4-digit PIN is asked; adult categories of a provider are locked behind it |

## 3. How to start

1. Launch the app: the start screen shows the logo.
2. Set a 4-digit parental PIN (typed twice). Back skips it.
3. Choose **M3U / XMLTV**, type the name and the playlist URL above, press **Confirm**.
4. Home opens; the catalog downloads in the background (a notice says when it is done).
5. Open **Live TV** → **Show all** → a channel → **Play**.

## 4. Main features and screens

| Screen | What it does |
|---|---|
| Home | rows: continue watching, new movies, new series, suggestions |
| Top bar | Home, Search, Movies, TV Series, Live TV, Favorites, Collections, Suggestions, Provider, Settings (some appear only when they have something) |
| Movies / TV Series | sidebar of genres and categories, grid of titles |
| Title page | play / resume, watched, trailer (opens the YouTube app), favourite, collections, episodes, cast, related titles |
| Player | full screen video; controls: progress bar, play/pause, episode buttons, aspect ratio, subtitles, audio |
| Live TV | grid programme guide, channels, genres of the guide, networks, categories, scheduled viewing |
| Search | movies, series, channels, collections, programmes on TV |
| Settings | catalog and guide status, optional services (TMDB, Trakt, OpenSubtitles keys), preferences, diagnostics, reset |

## 5. Remote control keys

| Key | Action |
|---|---|
| Arrows | move the focus |
| OK (Enter) | select; hold on a guide row for its actions |
| Back (Return) | go back / close; on Home asks to exit the app |
| Play, Pause, Play/Pause, Stop | player |
| Rewind, Fast forward | seek in the player |
| Channel up / down | previous / next channel (live) or episode (series) |
| Exit | closes the app (system) |

## 6. Network and data

- Contacts only the addresses the user typed (provider, playlist, guide) and, when the user enables them, TMDB, Trakt and OpenSubtitles
  with the user's own keys; trailers open the TV's YouTube app.
- No analytics, no ads, no account. Data stays on the TV. Privacy policy:
  `https://github.com/andreadegiovine/xtream-iptv-client/blob/main/docs/PRIVACY.md`.
- The store package does not download or run code from outside the package.

## 7. Known limitations

- The app plays what the user's provider streams; a stream that is offline or in a format the TV cannot decode shows an error notice
  and the player retries.
- Embedded subtitles of some files are not delivered by the TV's player; the app then reads text subtitles of MKV / MP4 files itself, or
  offers subtitles from OpenSubtitles (needs the user's key).
- Without an internet connection a notice is shown until the connection is back.

## 8. Contact

Support: the seller account's support e-mail; issues: `https://github.com/andreadegiovine/xtream-iptv-client/issues`.
