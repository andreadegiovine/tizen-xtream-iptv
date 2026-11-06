# Multi-platform: analysis, decisions and plan

Status: **platform structure done (patch 104); Tizen, LG webOS (patch 108), desktop (patch 110) and Android TV / Fire TV (patch 111) implemented.** The other platforms have not
been tried; the points marked "to verify" are hypotheses.

How to install each platform: `platforms/<name>/README.md`. How to build and release: [BUILD.md](BUILD.md).

## Principles

- **One logic and one core.** Pages, focus, database, sync, workers, EPG, player controller are the same for all platforms
  (`src/`). There is no touch code.
- **Everything about a platform lives in `platforms/<name>/`**: JS adapter, manifest, list of icons (drawn from `logo.svg`), certificates, native plugins,
  packaging script.
- **GitHub release → one package per platform**: `.github/workflows/release.yml` has a `verify` job (tag, lint, test) and one job per
  platform that builds, signs and attaches the package to the release.
- **iOS excluded** for now.
- **Android for TV only**: Fire TV (first) and Android TV, remote control and D-pad, no touch.
- **Desktop**: Windows, macOS and Linux (same interface, keyboard as the remote).

## Decisions taken

| Topic | Decision |
| --- | --- |
| Android container | **Capacitor** |
| Android player | **Native ExoPlayer (Media3)**, driven from JS like AVPlay: video below, HTML controls on top |
| Android distribution | **APK only**, attached to the GitHub release (no store) |
| Order | **webOS, desktop (Windows, macOS, Linux, at low cost), then Android (Fire TV)** |
| Desktop | **Electron**; packages not signed for now (macOS too) |
| Certificates | stay versioned in `platforms/<name>/`; without the password they are unusable and the passwords are in GitHub secrets |
| Trailers | only Tizen has a plugin (local service); the other platforms open the YouTube app |
| APK | two, from the same project with two Gradle flavors: `_androidtv.apk` and `_firetv.apk` |

## Structure (done)

```
src/platform/contract.js     the contract of an adapter, the defaults (browser), the check used by the tests
src/platform/index.js        the build's adapter (`import adapter from '@platform'`)
platforms/tizen/
  platform.js                Tizen adapter
  avplayEngine.js            AVPlay video engine
  avplaySpike.js             player lab of the Diagnostics page
  youtubeEngine.js           trailers (iframe served by the local service)
  keys.js                    Samsung keys (10009, 10252, 427/428) and media-key registration
  systemInfo.js              tizen.systeminfo (panel, RAM, network)
  config.xml                 manifest (the 117 px icon is drawn at build from logo.svg)
  youtube/                   YouTube player page and service on the TV
  tizencert.p12              signing certificate (password in the TIZEN_CERT_PASSWORD secret)
  build.js                   what webpack copies next to the app and page options (webapis.js)
  package.sh                 signs the .wgt (Tizen Studio CLI), used by the release `tizen` job
```

- The build chooses the platform with `--env platform=<name>` (default `tizen`): `npm run build:tizen`; `npm run build` and
  `npm run dev` use Tizen. Webpack resolves `@platform` to `platforms/<name>/platform.js` and adds the files of `build.js`.
  In the Jest tests `@platform` is the Tizen adapter.
- The Tizen `dist/` is identical to before the reorganization (same files, same `config.xml`, same service).
- **Icons:** no images in the platform folders. The logo is `logo.svg` in the repository root (also used by the top bar, the screensaver and
  the start screen); each platform's `build.js` lists the icons (`icons: [{ file, size }]`) and the build
  draws them as PNG (`scripts/platform-icons.js`, `@resvg/resvg-js`), also in the release jobs.
- A contract test (`test/platforms/contract.test.js`) checks that every `platforms/*/platform.js` respects the contract.

### The adapter contract (`src/platform/contract.js`)

All entries are optional: missing ones get the behavior of a browser.

| Entry | What it does | Tizen |
| --- | --- | --- |
| `keyCodes` | remote keys added to the common ones (arrows, OK, 415/19/413/417/412, Esc/Backspace, PageUp/PageDown) | 10009 Back, 10252 Play/Pause, 427/428 channels |
| `registerKeys()` | asks the platform for the media keys | `tvinputdevice.registerKey` |
| `exit()` | closes the app | `tizen.application…exit()` |
| `createEngine()` | video engine (same contract as `createHtml5Engine`) | AVPlay, `<video>` in the browser |
| `createTrailerEngine()` | engine that plays `youtube:<id>` inside the app, or null | iframe + `localhost:8125` service |
| `openTrailer(id)` | opens the trailer outside the app (webOS: YouTube app); with neither of the two, no trailer button | — |
| `createDiagnosticPlayer()` | player lab of Diagnostics | `avplaySpike` |
| `runtimeChecks()` | extra rows in the Diagnostics checks | tizen, webapis, AVPlay |
| `display / memory / networkType` | system data for the Device table | `tizen.systeminfo` |

## Release (done: Tizen, webOS, desktop, Android)

- `verify`: validates the tag (`v1.2.3`), `npm ci`, lint, test.
- `tizen`: version in `package.json`, `npm run build:tizen`, `platforms/tizen/package.sh <version> release` (installs the Tizen Studio
  CLI, registers the profile with the certificate copied into a temporary folder, signs), uploads `xtream-iptv-<version>_tizen.wgt` and `.sha256`.
- Package name: `xtream-iptv-<version>_<platform>.<extension>` (e.g. `xtream-iptv-1.0.1_tizen.wgt`).
- `webos`: version, `npm run build:webos`, `platforms/webos/package.sh <version> release`, uploads `xtream-iptv-<version>_webos.ipk` and `.sha256`.
- Each new platform adds a job of the same shape (`android`, desktop): each depends only on `verify`, so a
  platform that fails does not block the others.
- Versions: Tizen wants x.y.z; Android also needs an integer `versionCode`, derived from the tag (1.2.3 → 10203).

## LG webOS (done, patch 108; to try on the TV)

**Recommended minimum: webOS 6.0 (LG 2021, Chromium 79).** The current build target (Chrome 76) works without changing Babel, SCSS or polyfills.

Chromium by version: webOS 4 (2018-19) 53; webOS 5 (2020) 68; webOS 6 (2021) 79; webOS 22 (2022) 87; 23 → 94; 24 → 108; 25 → 120; 26 → 132.

```
platforms/webos/
  platform.js       adapter: Back key 461, exit (window.close), <video> engine, trailer in the YouTube app, UHD panel
  luna.js           calls to system services (PalmServiceBridge, without webOSTV.js): YouTube launch, system information
  appinfo.json      id com.xtrmiptv.app, 1920x1080, disableBackHistoryAPI (Back reaches the page), requiredACG
  build.js          icons (icon.png 80 px, largeIcon.png 130 px, drawn from logo.svg) and appinfo.json with the version
  package.sh        ares-package (@webos-tools/cli via npx, --no-minify) → xtream-iptv-<version>_webos.ipk
```

- Build: `npm run build:webos`; `npm run dev:webos` to try it in the browser. `webos` job in the release.
- Installation: the `.ipk` is not signed and installs on a TV in **developer mode** (see `platforms/webos/README.md`).
  The LG Content Store has its own publishing procedure.
- `requiredACG`: `application.launcher` (YouTube launch) and `systemconfig.query` (system information). Ignored up to webOS 25,
  applied from webOS 26, mandatory from webOS 27.
- Remote: Back = 461; Play/Pause/Stop/Fast-forward/Rewind and CH+/CH- use the standard codes already common.
- Trailer: the TV's YouTube app (`youtube.leanback.v4`, `contentTarget` with the video URL: to verify on the TV).
- Video: the page's `<video>` element. HLS: version 7 from webOS 6. The native player does not support fast forward/rewind nor
  speeds other than 1.0; seek works. Live: m3u8 (`pickLiveFormat` already prefers it).

**To verify on the TV:**
- direct calls to the provider (`file://` origin, CORS) and images / http streams;
- playback of MPEG-TS, MKV and the other provider streams, aspect ratio (object-fit), audio tracks and subtitles of the `<video>`;
- Magic Remote keys and the pointer (the focus stays key-driven);
- performance on the 2021 models.
- webOS 5 (2020) would require a lower Babel target and polyfills; webOS 4 and earlier are not worth it.

## Desktop: Windows, macOS, Linux (done, patch 110; to try on the systems)

```
platforms/desktop/
  platform.js            adapter: <video> with hls.js / mpegts.js (HLS and MPEG-TS), Space and media keys, exit
                         (window.close), trailer in the system browser, Electron version in the Diagnostics checks
  build.js               demux: true (hls.js / mpegts.js in the build), 512 px icon from logo.svg
  electron/main.js       Electron main process: a full-screen window, the app served as app://xtream/
                         (normal origin for workers and IndexedDB), 1920x1080 interface scaled to the window (zoom),
                         F11 full screen, F12 developer tools, a single instance
  electron-builder.json  packages: Windows NSIS x64, macOS dmg x64 and arm64, Linux AppImage and deb x64; Electron 44.9.3
  package.sh             staging folder (build + main.js + package.json) and electron-builder 26.18.0 via npx
```

- Build: `npm run build:desktop`; `npm run desktop` opens it in Electron from the repository. `desktop` job of the release, one per system
  (Linux on ubuntu, Windows on windows, macOS on macos): `xtream-iptv-<version>_linux-x64.AppImage` / `.deb`,
  `_windows-x64.exe`, `_macos-x64.dmg`, `_macos-arm64.dmg`, each with its `.sha256`.
- **Network:** the page runs with `webSecurity` disabled (no CORS, no blocking of http content), like a TV app. The page
  comes only from the app files: navigation to other addresses is blocked and `window.open` goes to the system browser.
- **Video:** Chromium's `<video>` with hls.js (HLS) and mpegts.js (MPEG-TS). The TV builds do not contain these two modules
  (`__JS_DEMUX__`). Limits: MKV and AC3/E-AC3 audio are not supported by Chromium (MKV films that do not start, channels without audio);
  the full solution is a native player (mpv / libVLC) as a plugin.
- **Signing:** none. Windows shows the SmartScreen warning; on macOS the app opens with right-click → Open (Gatekeeper). Signing
  needs a Windows certificate and the Apple Developer account (notarization).
- **Controls:** keyboard (arrows, Enter, Esc / Backspace, PageUp / PageDown, Space, media keys). The mouse works only where the
  interface already provides for it (player bar).
- **Window:** known issue to fix — the app opens full screen; it should be a normal window, with a player button to send the video full screen.
- Verified in Electron 44.9.3 (Linux, with the mock without CORS headers): startup, provider configuration, sync in the workers, home;
  AppImage and deb packages created locally. Windows (tried on a PC after patch 110) works; macOS: only in the release jobs.

## Android TV / Fire TV (done, patch 111; not compiled locally, to try on the devices)

Fire OS 7 and 8 are based on Android 9 and 11: a single Capacitor 8.5.3 project in `platforms/android/` with two flavors, **androidtv**
(Leanback required) and **firetv** (Leanback not required); the code is the same.

```
platforms/android/
  platform.js            adapter: ExoPlayer (exoEngine.js), keys from the activity, exit, trailer in the YouTube app, screen
  exoEngine.js           video engine with the same contract as AVPlay, on top of the ExoPlayer plugin (commands and events)
  build.js               launcher icons (mipmap) and 320x180 TV banner drawn from logo.svg in dist/android-res/
  package.json           Capacitor (@capacitor/android, cli, core 8.5.3): a separate npm project, does not touch the web app
  capacitor.config.json  webDir ../../dist, androidScheme http, mixed content allowed
  package.sh             icons into the project, npm ci + cap sync, gradlew assemble<Flavor>Release → xtream-iptv-<v>_androidtv.apk / _firetv.apk
  android/               Gradle project (generated by `cap add android`, then adapted)
    app/src/main/java/com/xtrmiptv/tv/
      MainActivity.java          viewport at 1920 (useWideViewPort + overview), transparent WebView, keys, network client
      ProviderWebViewClient.java every GET to another host made natively and returned with Access-Control-Allow-Origin: *
      RemoteKeys.java            Back, media and channel keys → keydown 10000 + Android code
      ExoPlayerPlugin.java       ExoPlayer (Media3 1.6.1) in a PlayerView under the WebView: TS, HLS, MKV, MP4, device AC3,
                                 audio tracks, ExoPlayer-drawn subtitles, aspect ratio (fit / fill / zoom), pause in background
      TvHostPlugin.java          exit, opening links (YouTube), device information
    app/src/androidtv, app/src/firetv   manifests of the two flavors
```

- **Network:** CapacitorHttp is not needed. `ProviderWebViewClient` intercepts GET requests to hosts other than `localhost` (provider
  API, images, TMDB) also from workers, makes them with `HttpURLConnection` (redirects followed, also from http to https) and
  returns them to the page with `Access-Control-Allow-Origin: *`. Other requests (Trakt POSTs, which has CORS) go normally.
  Clear-text traffic allowed (`usesCleartextTraffic`), page served over http (`androidScheme`).
- **Keys:** D-pad and OK arrive as arrows and Enter; Back, Play/Pause, Play, Pause, Stop, fast forward/rewind, next/previous
  track and CH+/CH- are intercepted by the activity and passed to the page (`window.__xtreamKey`).
- **Video:** `kind: 'exoplayer'`; time, duration, buffer and tracks arrive as events every 500 ms and are kept in JS for the
  contract's synchronous getters. With the app in the background the video pauses.
- **Signing:** `platforms/android/release.keystore` (to be created with `keytool` and versioned, like the Tizen certificate) and the secrets
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (default `xtream`), `ANDROID_KEY_PASSWORD`. Without them the APKs are signed with the
  machine's debug key: they install, but the next version does not update them (uninstall first).
- **Versions:** versionName = tag, versionCode = x*10000 + y*100 + z.
- **Release:** `android` job (ubuntu, Java 21, runner's Android SDK, Node 22): `xtream-iptv-<v>_androidtv.apk` and `_firetv.apk` with `.sha256`.
- **Not verified:** the APK was not compiled here (Android SDK and Google repositories not reachable from this environment): the first
  compilation will be that of the release job. To try on the devices: network from workers, Fire and Android TV remote keys,
  ExoPlayer (formats, tracks, subtitles), interface scale, stick performance.

### Distribution caveats

- **The new Fire TV Sticks (4K Select, new 4K, new HD) use Vega OS**, not Android: no APK, no sideload. Amazon has
  confirmed that future sticks will all be Vega. "Firestick" therefore means the Fire OS models (4K Max, 4K Plus, Cube, Fire TV
  TVs). A Vega port would be a separate project (React Native): out of scope.
- **Fire OS blocks apps that Amazon judges to give access to unlicensed content** (on opening since 2025, on installation since
  2026). The criteria are not public: it is not known whether a generic Xtream client could end up there. An uncontrollable risk.
- **Google: developer verification also for apps outside the Play Store** (from 2026 in some countries, global from 2027); there is a reduced
  tier for hobbyists that limits distribution to a few devices. To follow for the Android TV APK.

## Open issues

- **Desktop window (reported on Windows):** the app must open as a normal window, not full screen; the player needs a button to send the video full screen (F11 does it for the whole window today).
- Tizen aspect ratio ("format"): cause not found; waiting for the TV logs (see patches 106–107 in MILESTONES).

## Order of work

1. ~~Platform interface in the core, Tizen in `platforms/tizen/`~~ (patch 104; to verify on the Samsung TV that nothing changed).
2. ~~Multi-package release with Tizen only~~ (patch 104).
3. ~~webOS: `platforms/webos/` (adapter, `appinfo.json`, icons, `package.sh`), `webos` job in the release~~ (patch 108); tests on the TV.
4. ~~Android / Fire TV: Capacitor project in `platforms/android/`, native network, keys, viewport~~ (patch 111).
5. ~~ExoPlayer plugin with the same features as AVPlay~~ (patch 111).
6. First compilation in the release job, tests on the devices and measurements with the mock.
7. ~~Desktop (Windows, macOS, Linux) with Electron~~ (patch 110); tests on the systems, then possibly a native player (mpv / libVLC) for MKV and AC3.
