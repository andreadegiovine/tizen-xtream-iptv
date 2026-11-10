# Xtream IPTV — Privacy policy

Last updated: November 2026.

Xtream IPTV is a player for the IPTV service the user already subscribes to. It has no account, no advertising and no analytics.

## What the app stores, and where

Everything stays on the device that runs the app:

- the provider details the user types (server address, username and password, or playlist and guide addresses);
- the downloaded catalog and TV guide;
- favourites, collections, pins, watch history and progress, settings;
- the optional keys the user types for TMDB, Trakt and OpenSubtitles.

Nothing of this is sent to the developer, who runs no server that receives data from the app.

## Who the app talks to

- **The user's IPTV provider**, at the addresses the user typed: to read the catalog and the guide and to play the streams.
- **TMDB** (api.themoviedb.org), only when the user typed a TMDB key: title identifiers and the app language, to read posters, plots, cast and recommendations.
- **Trakt** (api.trakt.tv), only when the user connected a Trakt account: watched titles and playback progress, to keep the user's history in sync.
- **OpenSubtitles** (api.opensubtitles.com), only when the user typed an OpenSubtitles key and asks for subtitles: the title identifier, the language and a hash of the video file (computed from its first and last 64 KB), to find subtitles.
- **YouTube**, only when the user plays a trailer.
- **GitHub Pages** (andreadegiovine.github.io), only in the "autoupdate" packages distributed outside the TV stores: to check for and download a newer version of the app. The store packages never contact it.

Each service handles the data it receives under its own privacy policy.

## Deleting the data

Settings → Device lets the user delete the downloaded data or reset the app; uninstalling the app deletes everything it stored.

## Contact

Questions about this policy: open an issue at https://github.com/andreadegiovine/xtream-iptv-client/issues.
