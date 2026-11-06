# Desktop: Windows, macOS, Linux

Packages attached to every [release](../../../../releases) (each with a `.sha256`). They are an [Electron](https://www.electronjs.org) app and are **not signed**.

| System | Package |
|---|---|
| Windows (x64) | `xtream-iptv-<version>_windows-x64.exe` (installer) |
| macOS, Intel | `xtream-iptv-<version>_macos-x64.dmg` |
| macOS, Apple Silicon | `xtream-iptv-<version>_macos-arm64.dmg` |
| Linux (x64) | `xtream-iptv-<version>_linux-x64.AppImage` and `xtream-iptv-<version>_linux-x64.deb` |

The interface is the TV one (1920x1080, scaled to the window, which opens as a normal window) and is driven by the keyboard. The Windows app has been tried; macOS and Linux packages are built by the release
but not yet tried on those systems.

## Install

### Windows

1. Run `xtream-iptv-<version>_windows-x64.exe`.
2. Windows SmartScreen shows "Windows protected your PC" because the installer is not signed: choose **More info → Run anyway**.

### macOS

1. Open the `.dmg` that matches your Mac (Apple menu → *About This Mac*: *Apple M…* is arm64, *Intel* is x64) and drag **Xtream IPTV** to *Applications*.
2. The app is not signed or notarized, so Gatekeeper blocks the first launch: **right-click the app → Open → Open**. If macOS still says the app is damaged, run
   `xattr -cr "/Applications/Xtream IPTV.app"` in the Terminal and open it again.

### Linux

- **AppImage** (any distribution):

  ```bash
  chmod +x xtream-iptv-<version>_linux-x64.AppImage
  ./xtream-iptv-<version>_linux-x64.AppImage
  ```

  If it does not start, your distribution may need FUSE 2 (`libfuse2`), or run it with `--appimage-extract-and-run`.
- **deb** (Debian, Ubuntu and derivatives): `sudo apt install ./xtream-iptv-<version>_linux-x64.deb`

Then add your provider (see the [main README](../../README.md#first-steps)).

## Keyboard

| Key | Action |
|---|---|
| Arrows | Move the focus |
| `Enter` | Select |
| `Esc` / `Backspace` | Back |
| `PageUp` / `PageDown` | Channel up / down (previous / next channel or episode in the player) |
| `Space`, media keys | Play / pause, and the other player controls |
| `F11` | Toggle full screen (the player also has a full-screen button) |
| `F12` | Developer tools |

The mouse works only where the interface already provides for it (the player progress bar). Only one instance of the app runs at a time.

## Notes

- **Network:** the page runs with `webSecurity` disabled (no CORS, http content allowed), like a TV app. It loads only the app's own files (served as `app://xtream/`);
  navigation to other addresses is blocked and links open in the system browser. Trailers open in the system browser.
- **Video:** Chromium's `<video>` with hls.js (HLS) and mpegts.js (MPEG-TS). **MKV files and AC3 / E-AC3 audio are not supported by Chromium**: some films do not start and some
  channels have no audio. A native player (mpv / libVLC) would solve it and may come later.
- **Window:** the app opens as a normal, resizable 16:9 window (the interface scales with it). The player has a full-screen button (also `F11`) that switches the whole window.

## What is in this folder

| File | Role |
|---|---|
| `platform.js` | the adapter (see [`docs/MULTIPLATFORM.md`](../../docs/MULTIPLATFORM.md)) |
| `electron/main.js`, `electron/preload.js` | the Electron main process, and the preload that lets the page switch its own window to full screen |
| `electron-builder.json` | installer targets (NSIS, dmg, AppImage, deb) |
| `build.js`, `package.sh` | demuxers and icon at build; staging folder and electron-builder at packaging |

To run it from the repository: `npm run desktop` (see [`docs/BUILD.md`](../../docs/BUILD.md#desktop)).
