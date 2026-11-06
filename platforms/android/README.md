# Android TV and Amazon Fire TV

Packages attached to every [release](../../../../releases) (each with a `.sha256`). They are APK files, not on any store, built from one [Capacitor](https://capacitorjs.com) project with two flavors:

| Device | Package |
|---|---|
| Android TV, Google TV | `xtream-iptv-<version>_androidtv.apk` |
| Amazon Fire TV / Fire TV Stick with **Fire OS** (4K Max, 4K Plus, Cube, Fire TV TVs) | `xtream-iptv-<version>_firetv.apk` |

The app is made for the remote control (D-pad), not for touch. This platform is new: the APKs were first built by the release job and **have not been verified on a real device yet**.

> **Fire TV Sticks with Vega OS are not supported.** The newest Fire TV Sticks (4K Select, new 4K, new HD) run Vega OS, which cannot install APK files.
> Fire OS may also block apps that it considers to give access to unlicensed content.

## Install on Android TV / Google TV

1. On the TV: *Settings → Device Preferences → About*, tap **Build** seven times to enable developer options. Then *Developer options → USB debugging* (or *Network debugging* / *Wireless debugging*) **On**.
2. Find the TV's IP address (*Settings → Network*). On a computer in the same network, with [`adb`](https://developer.android.com/tools/releases/platform-tools) installed:

   ```bash
   adb connect <tv-ip>:5555
   adb install -r xtream-iptv-<version>_androidtv.apk
   ```

   Accept the debugging prompt shown on the TV the first time.
3. Open **Xtream IPTV** from the apps list and add your provider.

Alternative without a computer: copy the APK to a USB drive or a cloud folder, open it with a file manager app on the TV and allow *Install unknown apps* for that app.

## Install on Fire TV

1. *Settings → My Fire TV → Developer Options*: turn **ADB debugging** and **Apps from Unknown Sources** (or *Install unknown apps*) **On**. If Developer Options is missing, open *About* and click the device name seven times.
2. Find the IP address (*Settings → My Fire TV → About → Network*). On a computer in the same network:

   ```bash
   adb connect <fire-tv-ip>:5555
   adb install -r xtream-iptv-<version>_firetv.apk
   ```

   Accept the prompt on the TV.
3. Open the app from *Settings → Applications → Manage Installed Applications* (or from the app list) and add your provider.

Alternative without a computer: install the **Downloader** app from the Amazon Appstore, allow it to install unknown apps, and type the direct URL of the APK from the release page.

## Updating

Releases are signed with `release.keystore` when the build has its secrets; an update installs over the previous version with `adb install -r`. APKs signed with a debug key
(builds without the secrets) cannot be updated by a release signed with another key: uninstall the old one first (`adb uninstall com.xtrmiptv.tv`).

## Notes

- **Player:** ExoPlayer (Media3) draws the video under the app's page; the controls are the app's own. It plays TS, HLS, MKV and MP4, audio tracks, and subtitles; AC3 and other audio depend on the device's decoders.
- **Network:** the app makes the GET requests to providers, images and TMDB natively, so providers without CORS headers and over plain http work, also from the background workers.
- **Remote keys:** D-pad and OK are the arrows and Enter; Back, Play/Pause, Stop, fast forward / rewind, next / previous track and CH+/CH- are passed to the app.
- **Trailers:** open the YouTube app.
- **Versions:** `versionName` is the release tag; `versionCode` is `x*10000 + y*100 + z`.
- **To verify on devices:** network from the workers, the Fire and Android TV remote keys, ExoPlayer (formats, tracks, subtitles), the interface scale and the performance of sticks.

## What is in this folder

| File | Role |
|---|---|
| `platform.js`, `exoEngine.js` | the adapter (see [`docs/MULTIPLATFORM.md`](../../docs/MULTIPLATFORM.md)) and the ExoPlayer video engine |
| `build.js` | launcher icons and TV banner drawn from `logo.svg` |
| `package.json`, `capacitor.config.json` | the Capacitor project (a separate npm project; needs Node.js 22 or newer) |
| `android/` | the Gradle project: `MainActivity`, `ProviderWebViewClient`, `RemoteKeys`, `ExoPlayerPlugin`, `TvHostPlugin`, and the manifests of the two flavors |
| `package.sh` | icons into the project, `cap sync`, `gradlew assemble<Flavor>Release`, renaming and checksums |
| `release.keystore` | signing key (to be created and versioned); passwords come from the `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` secrets |

To build the APKs yourself see [`docs/BUILD.md`](../../docs/BUILD.md#android-tv--fire-tv).
