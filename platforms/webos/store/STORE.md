# LG Seller Lounge (LG Content Store) — submission material

Everything needed to register Xtream IPTV on the LG Seller Lounge (seller.lgappstv.com). Values to paste are in code blocks. Fields
marked **(you)** depend on the seller account.

> Package to upload: **`xtream-iptv-<version>_webos.ipk`** of the release. It has **no online updates** (store apps must not download
> code); `_webos_autoupdate.ipk` is for installation outside the store only.

## 1. Application

| Field | Value |
|---|---|
| App title | `Xtream IPTV` |
| App ID | `com.xtrmiptv.app` (from `appinfo.json`) |
| Version | the release version, e.g. `1.3.0` |
| Supported webOS | webOS 6.0 (2021 TVs) and newer |
| Category | `Entertainment` (sub-category: video / media player, where offered) |
| Price | Free; no in-app purchases, no ads |
| Languages | English (default), Italian |
| Countries | all the countries the seller wants (no regional content) |
| Seller / support e-mail **(you)** | the seller account's data |
| Support / homepage URL | `https://github.com/andreadegiovine/xtream-iptv-client` |
| Privacy policy URL | `https://github.com/andreadegiovine/xtream-iptv-client/blob/main/docs/PRIVACY.md` |

## 2. Texts

Use the same title, short description, description (English and Italian) and keywords as the Samsung submission:
[`platforms/tizen/store/STORE.md`](../../tizen/store/STORE.md#2-title-and-descriptions).

## 3. Images

| Asset | File | Spec |
|---|---|---|
| Store icon | `icon-400x400.png` | 400x400 PNG, square (LG resizes it) |
| App icons in the package | `icon-80x80.png`, `icon-130x130.png` | already in the .ipk (`icon.png`, `largeIcon.png`) |
| Background colour of the icon | `#0c0c12` | flat colour behind the logo |
| Screenshots | `screenshots/1-home.jpg`, `2-movies.jpg`, `3-live-guide.jpg`, `4-detail.jpg` | 1920x1080 JPG (at least 3) |

Regenerate them with `npm run store-assets` and `npm run build && npm run screenshots`.

## 4. Documents LG asks for

- **UX scenario**: [`UX-SCENARIO.md`](UX-SCENARIO.md) (export it to PDF for the upload).
- **Self-checklist**: fill LG's form; the answers for this app are in section 6 below.
- **Test information**: section 5.

## 5. Test information

```
Xtream IPTV is a player: it has no content of its own. To test it without an IPTV subscription, use the M3U option with a public playlist of free, legal channels:

1. At the first start, set any 4-digit parental PIN (twice).
2. Choose "M3U / XMLTV".
3. Name: Test
   M3U playlist URL: https://iptv-org.github.io/iptv/countries/it.m3u
   XMLTV guide URL: leave empty
4. Confirm: the catalog is downloaded; open Live TV and play any channel with OK.

Magic Remote / remote: arrows to move, OK to select, Back to go back, Play/Pause and Channel up/down in the player.
Optional services (TMDB, Trakt, OpenSubtitles) need the tester's own free keys and are not required.
```

## 6. Self-checklist answers

| Topic | Answer |
|---|---|
| Back key | handled everywhere; on Home it asks to exit (`disableBackHistoryAPI: true`) |
| Exit | the exit dialog closes the app |
| Remote navigation | every screen is usable with the arrows and OK; the pointer is not required |
| Video | system player (`<video>`), HLS and MPEG-TS from the user's provider |
| Network loss | an "offline" notice stays until the connection is back; playback retries |
| Resolution | 1920x1080 |
| Content | none shipped; adult categories of a provider are locked behind a parental PIN |
| Data | stored on the TV only; see the privacy policy |
| Third-party services | TMDB, Trakt, OpenSubtitles (optional, user keys), YouTube (trailers) |
