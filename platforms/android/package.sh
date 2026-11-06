#!/usr/bin/env bash
# Builds the Android TV and Fire TV packages from the production build in dist/ (`npm run build:android`).
#
#   bash platforms/android/package.sh <version> [out-dir] [androidtv|firetv|all]
#
# 1. the launcher icons and the TV banner drawn by the build (dist/android-res/) go into the Android project;
# 2. Capacitor (its own package.json here, npm ci) copies dist/ into the app (npx cap sync android);
# 3. Gradle builds the release APK of each flavor, versionName <version>, versionCode x*10000 + y*100 + z.
# Output: <out-dir>/xtream-iptv-<version>_androidtv.apk and _firetv.apk, each with its .sha256 (out-dir: release).
#
# Signing: platforms/android/release.keystore with ANDROID_KEYSTORE_PASSWORD (and ANDROID_KEY_ALIAS, default "xtream";
# ANDROID_KEY_PASSWORD, default the keystore one). Without them the APKs are signed with the debug key of the machine: they install,
# but a later version signed with another key does not update them (uninstall first).
# Needs Java 21 and the Android SDK (ANDROID_HOME): present on the GitHub runners. Run by the "android" job of the release.
set -euo pipefail

VERSION="${1:?version (x.y.z) required}"
ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/../.." && pwd)}"
OUT="${2:-release}"
case "$OUT" in /*) ;; *) OUT="${ROOT}/${OUT}" ;; esac # relative to the repository
WHICH="${3:-all}"
HERE="${ROOT}/platforms/android"
RES="${HERE}/android/app/src/main/res"

if [[ ! "$VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "::error::version must be x.y.z"
  exit 1
fi
VERSION_CODE=$((BASH_REMATCH[1] * 10000 + BASH_REMATCH[2] * 100 + BASH_REMATCH[3]))
if [ ! -d "${ROOT}/dist/android-res" ]; then
  echo "::error::dist/ is not an Android build: run npm run build:android first."
  exit 1
fi

# 1. Icons and banner (from logo.svg), then out of dist/ so that they are not copied into the page's files.
cp -R "${ROOT}/dist/android-res/." "${RES}/"
rm -rf "${ROOT}/dist/android-res"

# 2. Capacitor and the web app.
(cd "$HERE" && npm ci --no-audit --no-fund && npx cap sync android)

# 3. The APKs.
case "$WHICH" in
  androidtv) FLAVORS=(androidtv) ;;
  firetv) FLAVORS=(firetv) ;;
  all) FLAVORS=(androidtv firetv) ;;
  *) echo "::error::unknown flavor '$WHICH' (androidtv, firetv, all)"; exit 1 ;;
esac
TASKS=()
for flavor in "${FLAVORS[@]}"; do TASKS+=("assemble${flavor^}Release"); done
if [ ! -f "${HERE}/release.keystore" ] || [ -z "${ANDROID_KEYSTORE_PASSWORD:-}" ]; then
  echo "::warning::platforms/android/release.keystore or ANDROID_KEYSTORE_PASSWORD missing: the APKs are signed with the debug key."
fi
chmod +x "${HERE}/android/gradlew"
(cd "${HERE}/android" && ./gradlew --no-daemon "${TASKS[@]}" -PxtreamVersionCode="$VERSION_CODE" -PxtreamVersionName="$VERSION")

mkdir -p "$OUT"
checksum() {
  if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi
}
for flavor in "${FLAVORS[@]}"; do
  APK="$(find "${HERE}/android/app/build/outputs/apk/${flavor}/release" -maxdepth 1 -name '*.apk' | head -n1)"
  if [ -z "$APK" ]; then
    echo "::error::No APK produced for ${flavor}"
    exit 1
  fi
  NAME="xtream-iptv-${VERSION}_${flavor}.apk"
  cp "$APK" "${OUT}/${NAME}"
  (cd "$OUT" && checksum "$NAME" > "${NAME}.sha256")
  echo "Packaged ${OUT}/${NAME}"
done
