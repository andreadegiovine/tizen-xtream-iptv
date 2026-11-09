# Building, packaging and releasing

How to build the app from source for every platform, run it in a browser, and how a release is made. To *install* a package, see the guide of the platform in
`platforms/<name>/README.md`. How the platforms share one app is explained in [MULTIPLATFORM.md](MULTIPLATFORM.md).

## Requirements

| For | You need |
|---|---|
| Everything | Node.js 18 or newer and `npm` |
| Android packages | Node.js **22 or newer** (the Capacitor CLI requires it), Java 21 and the Android SDK |
| Tizen signing | `curl` and a Linux machine (the script installs the Tizen Studio CLI), or your own Tizen Studio with a Samsung certificate profile |
| Desktop packages | Node.js; each system builds its own installer (Windows on Windows, macOS on macOS, Linux on Linux) |

The release workflow runs everything on Node 22.

## Setup, tests and lint

```bash
npm ci
npm test            # unit tests (Jest)
npm run lint        # ESLint
```

ESLint blocks the APIs the TV browsers do not have (see [Code constraints](#code-constraints)). The tests run the Tizen adapter as `@platform`.

## Run in a browser

```bash
npm run dev         # http://localhost:8080, Tizen adapter
npm run dev:webos   # the same with the webOS adapter
npm run desktop     # builds the desktop version and opens it in Electron
```

In a desktop browser the remote is emulated with the keyboard: arrows, `Enter`, `Esc` / `Backspace` for Back, `PageUp` / `PageDown` for channel up / down.
The dev server proxies provider calls (`/__proxy`) and streams (`/__media`) to avoid CORS problems, and plays HLS and MPEG-TS with hls.js / mpegts.js (development only).

To try the app without a provider, or to measure performance, use the fake Xtream server: [MOCK-TEST.md](MOCK-TEST.md).

## Build

One build per platform. The platform is picked with `--env platform=<name>`; webpack resolves `@platform` to `platforms/<name>/platform.js` and adds the files listed
by `platforms/<name>/build.js`. The result is always in `dist/`, and `scripts/check-dist.js` runs after every build (it parses the output as ES2019).

| Command | Platform |
|---|---|
| `npm run build:tizen` (also `npm run build`) | Samsung Tizen |
| `npm run build:webos` | LG webOS |
| `npm run build:desktop` | Windows, macOS, Linux |
| `npm run build:android` | Android TV and Fire TV |

`dist/` holds a single platform: build again before packaging another one. The version shown in the app is the `version` of `package.json`; the release workflow sets it from the tag.

Platform icons are not kept in the repository: the build draws them from `logo.svg` (`scripts/platform-icons.js`) into `dist/` (the Android launcher icons and banner go to `dist/android-res/`).

## Package

Every platform has a script that turns `dist/` into the release package. They are the ones the release workflow runs; you can run them locally with the same arguments:
`bash platforms/<name>/package.sh <version> [out-dir]`, where `<version>` is `x.y.z` and `out-dir` defaults to `release/`. Each writes
`xtream-iptv-<version>_<platform>.<ext>` and its `.sha256`.

### Tizen

```bash
npm run build:tizen
CERT_PASSWORD=<password> bash platforms/tizen/package.sh 1.0.0
```

The script installs the Tizen Studio CLI, registers a signing profile with `platforms/tizen/tizencert.p12` (copied to a temporary folder) and signs the `.wgt`.
The certificate is versioned; its password is the `TIZEN_CERT_PASSWORD` secret.

To sign with your own Samsung certificate profile and install without the script:

```bash
npm run build:tizen
tizen package -t wgt -s <your-profile> -- dist
sdb connect <tv-ip>
tizen install -n dist/XtreamIPTV.wgt -t <tv-name>
```

### webOS

```bash
npm run build:webos
bash platforms/webos/package.sh 1.0.0
```

Runs `ares-package` (from `@webos-tools/cli`, fetched with `npx`) and writes an unsigned `.ipk`.

### Desktop

```bash
npm run build:desktop
bash platforms/desktop/package.sh 1.0.0 release linux      # or windows, or macos
```

Puts `dist/` (as `app/`), `electron/main.js` and a `package.json` in a staging folder and runs electron-builder (version pinned in the script). The system argument defaults to
the machine's own; an installer can only be built on its system. Targets: Windows NSIS x64, macOS dmg x64 and arm64, Linux AppImage and deb x64. Nothing is signed.

### Android TV / Fire TV

```bash
npm run build:android
bash platforms/android/package.sh 1.0.0 release all        # or androidtv, or firetv
```

Needs Java 21 and the Android SDK (`ANDROID_HOME`). The script copies the icons from `dist/android-res/` into the Android project, runs `npm ci` and `npx cap sync android` in `platforms/android/`,
then `gradlew assemble<Flavor>Release`. `versionName` is the version and `versionCode` is `x*10000 + y*100 + z`.

Signing: `platforms/android/release.keystore` with the environment variables `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (default `xtream`) and `ANDROID_KEY_PASSWORD` (default: the keystore one).
Without them the APKs are signed with the machine's debug key: they install, but a later version signed with another key does not update them (uninstall first).
The keystore is created once with `keytool -genkeypair -v -keystore platforms/android/release.keystore -alias xtream -keyalg RSA -keysize 2048 -validity 36500`
and committed; its passwords go into the GitHub secrets.

## Releases

Publishing a GitHub release runs `.github/workflows/release.yml`:

1. **`verify`**: validates the tag (it must look like `v1.2.3` or `1.2.3`: Tizen widget versions only accept numeric x.y.z), then `npm ci`, lint and tests.
2. **One job per platform**, all after `verify`, independent of each other (a platform that fails does not stop the others): `tizen`, `webos`, `desktop` (a matrix of Linux, Windows and macOS runners) and `android`.
   Each stamps the version in `package.json`, builds, packages and uploads its files to the release with `gh release upload`.

Assets attached to a release:

| Platform | Files |
|---|---|
| Tizen | `xtream-iptv-<version>_tizen.wgt` (signed) |
| webOS | `xtream-iptv-<version>_webos.ipk` |
| Desktop | `_windows-x64.exe`, `_macos-x64.dmg`, `_macos-arm64.dmg`, `_linux-x64.AppImage`, `_linux-x64.deb` |
| Android | `_androidtv.apk`, `_firetv.apk` |

Every file also has a `.sha256`.

### Secrets

| Secret | Used by | For |
|---|---|---|
| `TIZEN_CERT_PASSWORD` | `tizen` | password of `platforms/tizen/tizencert.p12` |
| `ANDROID_KEYSTORE_PASSWORD` | `android` | password of `platforms/android/release.keystore` (without it, a debug key is used) |
| `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | `android` | optional: key alias (default `xtream`) and key password (default: the keystore one) |

TMDB and Trakt keys are not part of any build: they are typed in the app Settings.

To try a release without publishing a real one, create a pre-release with a tag like `v0.0.1`, then check the jobs and delete the release and the tag.

## Online updates

Installed apps update their web code (JavaScript, styles, fonts) by themselves, without the store or the system (`src/services/updates.js`):

- The release workflow's `pages` job builds every platform and writes `bundles/<version>/<platform>/` and `version.json` on the `gh-pages`
  branch (`scripts/publish-updates.js`, last three versions kept). GitHub Pages must serve that branch (Settings → Pages → Deploy from a
  branch → `gh-pages`, `/ (root)`); the app reads `https://andreadegiovine.github.io/xtream-iptv-client/version.json`.
- At start-up the check is the first thing the app does (5 s at most): a newer build that the installed package can run is downloaded
  ("Updating to version X…" in a notice over the start screen), the app starts again with it and only then runs its usual start-up work. The loader in
  `src/index.html` picks the newer of the package's own copy and the installed build at every start, and falls back to the package's copy when
  the online build cannot be loaded (offline); a build that fails to start is forgotten.
- Native parts are not updated this way (Tizen `config.xml` privileges and the YouTube service, webOS `appinfo.json`, Android plugins, Electron):
  when a release changes them, raise `updates.minShell` in `package.json` to that version; older packages then show a notice asking to install
  the new package instead of loading the build.
- Not used in development builds. The web code is checked by HTTPS only (no signature yet).

## Project layout

```
src/
  core/       env, errors, logger (masks credentials), http, idb, input
  db/         app database and one database per provider
  services/   Xtream client, sync, grouping, title normalisation, TMDB, Trakt, EPG, player engines
  ui/         focus manager, router, top bar, pages, components
  i18n/       en-US and it-IT dictionaries
  styles/     SCSS
  platform/   the contract of a platform adapter (contract.js) and the adapter of the build (index.js)
platforms/
  tizen/      adapter (AVPlay, remote keys, system info, YouTube trailers), config.xml, YouTube service,
              signing certificate, build.js (files webpack copies) and package.sh (signed .wgt)
  webos/      adapter (<video>, Back 461, YouTube app via Luna), appinfo.json, build.js and package.sh (.ipk)
  desktop/    adapter (<video> + hls.js / mpegts.js, keyboard), Electron main process, electron-builder.json and
              package.sh (Windows .exe, macOS .dmg, Linux .AppImage / .deb)
  android/    adapter (ExoPlayer engine, remote keys), Capacitor project (its own package.json) with the Android app
              (ExoPlayer and TvHost plugins, native network client), package.sh (Android TV and Fire TV .apk)
scripts/      check-dist, platform icons, dev proxies, the mock Xtream server and performance tools
logo.svg      the app logo: top bar, start screen, screensaver, and every platform icon (drawn at build time)
test/         Jest tests
docs/         this documentation and the screenshots
```

Each platform folder has a `README.md` with the installation guide and what is in it.

## Code constraints

The TVs run old Chromium builds (Tizen 6: ~76, webOS 6: 79), so the build targets Chrome 76 and ESLint blocks newer APIs: `?.`, `??`, `String.replaceAll`, `.at()`, `structuredClone`.
Terser is set to ES2019 for the same reason, and `scripts/check-dist.js` fails the build if the output is not valid ES2019. CSS must avoid flexbox `gap`, `aspect-ratio` and `inset`.

Anything that depends on a platform goes through the adapter in `platforms/<name>/platform.js` (see the contract in `src/platform/contract.js` and [MULTIPLATFORM.md](MULTIPLATFORM.md));
app code never calls platform APIs directly.
