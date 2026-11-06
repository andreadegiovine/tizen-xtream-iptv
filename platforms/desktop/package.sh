#!/usr/bin/env bash
# Packages the desktop app from the production build in dist/ (`npm run build:desktop`) for one system.
#
#   bash platforms/desktop/package.sh <version> [out-dir] [linux|windows|macos]
#
# Puts the build (app/), the Electron main process (electron/main.js, preload.js) and a package.json in a staging folder and runs electron-builder
# (npx, pinned version; Electron is downloaded by it) with electron-builder.json:
#   linux    xtream-iptv-<version>_linux-x64.AppImage and .deb
#   windows  xtream-iptv-<version>_windows-x64.exe (NSIS installer)
#   macos    xtream-iptv-<version>_macos-x64.dmg and _macos-arm64.dmg
# each with its .sha256, in out-dir (release). Nothing is signed: Windows shows the SmartScreen warning, macOS asks to open it with
# right click → Open. Run by the "desktop" jobs of .github/workflows/release.yml, each on its own system (the system of the machine
# when none is given).
set -euo pipefail

VERSION="${1:?version (x.y.z) required}"
ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/../.." && pwd)}"
OUT="${2:-release}"
case "$OUT" in /*) ;; [A-Za-z]:*) ;; *) OUT="${ROOT}/${OUT}" ;; esac # relative to the repository
SYSTEM="${3:-}"
if [ -z "$SYSTEM" ]; then
  case "$(uname -s)" in Linux*) SYSTEM=linux ;; Darwin*) SYSTEM=macos ;; *) SYSTEM=windows ;; esac
fi
TMP="${RUNNER_TEMP:-$(mktemp -d)}"
BUILDER_VERSION="${BUILDER_VERSION:-26.18.0}"
HERE="${ROOT}/platforms/desktop"

if [ ! -f "${ROOT}/dist/index.html" ] || [ ! -f "${ROOT}/dist/icon.png" ]; then
  echo "::error::dist/ is not a desktop build: run npm run build:desktop first."
  exit 1
fi

STAGE="${TMP}/desktop-app"
rm -rf "$STAGE"
mkdir -p "${STAGE}/app" "${STAGE}/build" "$OUT"
cp -R "${ROOT}/dist/." "${STAGE}/app/"
cp "${HERE}/electron/main.js" "${STAGE}/main.js"
cp "${HERE}/electron/preload.js" "${STAGE}/preload.js"
cp "${ROOT}/dist/icon.png" "${STAGE}/build/icon.png" # electron-builder makes the .ico / .icns from it
cat > "${STAGE}/package.json" <<JSON
{
  "name": "xtream-iptv",
  "productName": "Xtream IPTV",
  "version": "${VERSION}",
  "description": "Xtream Codes IPTV client",
  "author": { "name": "Xtream IPTV", "email": "noreply@xtream-iptv.invalid" },
  "homepage": "https://github.com",
  "license": "UNLICENSED",
  "desktopName": "xtream-iptv.desktop",
  "main": "main.js"
}
JSON

case "$SYSTEM" in
  linux) TARGET=--linux ;;
  windows) TARGET=--win ;;
  macos) TARGET=--mac ;;
  *) echo "::error::unknown system '$SYSTEM' (linux, windows, macos)"; exit 1 ;;
esac

export CSC_IDENTITY_AUTO_DISCOVERY=false # no signing (macOS would look for a certificate in the keychain)
npx --yes "electron-builder@${BUILDER_VERSION}" "$TARGET" --projectDir "$STAGE" --config "${HERE}/electron-builder.json" --publish never

checksum() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi
}
FOUND=0
for file in "${STAGE}"/out/xtream-iptv-*; do
  [ -f "$file" ] || continue
  case "$file" in *.AppImage|*.deb|*.exe|*.dmg) ;; *) continue ;; esac
  name="$(basename "$file")"
  mv "$file" "${OUT}/${name}"
  (cd "$OUT" && checksum "$name" > "${name}.sha256")
  echo "Packaged ${OUT}/${name}"
  FOUND=1
done
if [ "$FOUND" = 0 ]; then
  echo "::error::No package produced"
  exit 1
fi
