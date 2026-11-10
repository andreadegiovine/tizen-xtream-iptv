# Xtream IPTV — UX scenario

Remote keys: arrows (move), OK (select, hold for actions in the guide), Back (back / close), Play/Pause, Rewind/Fast forward,
Channel up/down. Screens are 1920x1080. Screenshots: `screenshots/`.

## 1. First start

1. The start screen shows the logo while the app loads.
2. **Parental PIN**: the user types a 4-digit PIN twice (it locks adult categories of the provider). Back skips it (asked again later).
3. **Kind of provider**: "Xtream API" or "M3U / XMLTV".
4. **Provider data**:
   - Xtream API: name, server URL, username, password.
   - M3U / XMLTV: name, playlist URL, guide URL (optional: the one the playlist names is used).
   OK on a field opens the on-screen keyboard; the "x" in a field empties it. "Confirm" checks the provider; an error is shown under
   the form (wrong address, wrong account, expired account, empty playlist). "Back" returns to the kind of provider.
5. The catalog downloads in the background; Home opens at once.

## 2. Home

Rows: Continue watching, New movies, New series, Suggested (when TMDB or Trakt is set up). Left/Right move in a row (more cards load
while scrolling), Up/Down between rows, Up from the first row reaches the top bar. OK opens a title.

## 3. Top bar

Home, Search, Movies, TV Series, Live TV, Favorites, Collections, Suggestions, Provider, Settings. Favorites, Collections and
Suggestions appear only when they have something; TV Series is not shown for M3U providers. OK opens the section.

## 4. Movies / TV Series

Sidebar (show all, continue watching, favourites, suggestions, genres, categories) on the left, grid on the right. Left/Right move
between sidebar and grid. In a genre or category, Up reaches the pin and heart buttons (pin to the sidebar, add to favourites).

## 5. Title page

Play / resume, restart, watched, trailer (opens YouTube), favourite, add to a collection. Series: season list and episodes. Cast and
related titles below. Back returns to the grid, on the same card.

## 6. Player

Video full screen; any key shows the controls (progress bar, play/pause, episode buttons, aspect ratio, subtitles, audio). Up reaches
the progress bar (Left/Right move it, OK or a pause jumps there). Back hides the controls, then closes the player. Live TV: Channel
up/down change channel; the programme on air and its end time are shown.

## 7. Live TV

Opens on the **Schedule** (grid guide): channels down the left, programmes on a time axis. Left/Right move between programmes, Up/Down
between channels; OK opens the channel page with the programme selected (watch it if on air, or schedule it); OK held on a channel
offers move up/down and remove from the guide. Sidebar: Scheduled, Show all, Favorites, Genres (the guide filtered by programme
genre), Networks, Categories.

## 8. Search

Type with the on-screen keyboard: results for movies, series, channels, collections and programmes on TV in the next 24 hours.
OK on a programme opens its channel with that programme selected.

## 9. Settings

Version and last update check, boxes about the optional services, catalog and guide (update / delete), TMDB, Trakt, OpenSubtitles,
device information, preferences (language, text size, clock, screensaver, player, Live TV grouping, custom guide, parental PIN).

## 10. Exit

Back on Home asks "Exit?"; confirming closes the app.
