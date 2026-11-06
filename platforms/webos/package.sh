#!/usr/bin/env bash
# Packages the LG webOS app from the production build in dist/ (`npm run build:webos`).
#
#   bash platforms/webos/package.sh <version> [out-dir]
#
# Uses ares-package of @webos-tools/cli (installed on the fly with npx) and writes <out-dir>/xtream-iptv-<version>_webos.ipk with its
# .sha256 (out-dir: release). The .ipk is not signed: it installs on a TV in Developer Mode (ares-install, or the Developer Mode app);
# the LG Content Store has its own submission process. Run by the "webos" job of .github/workflows/release.yml; works on any machine with Node.
set -euo pipefail

VERSION="${1:?version (x.y.z) required}"
ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/../.." && pwd)}"
OUT="${2:-release}"
case "$OUT" in /*) ;; *) OUT="${ROOT}/${OUT}" ;; esac # relative to the repository
TMP="${RUNNER_TEMP:-$(mktemp -d)}"
ARES_VERSION="${ARES_VERSION:-3.2.6}"

if [ ! -f "${ROOT}/dist/appinfo.json" ]; then
  echo "::error::dist/appinfo.json not found: run npm run build:webos first."
  exit 1
fi

IPK_DIR="${TMP}/ipk"
rm -rf "$IPK_DIR"
mkdir -p "$IPK_DIR" "$OUT"
# --no-minify: the build is already minified for Chromium 79 (ares' own minifier would rewrite it).
npx --yes -p "@webos-tools/cli@${ARES_VERSION}" ares-package --no-minify -o "$IPK_DIR" "${ROOT}/dist"
IPK="$(find "$IPK_DIR" -maxdepth 1 -name '*.ipk' | head -n1)"
if [ -z "$IPK" ]; then
  echo "::error::No .ipk produced"
  exit 1
fi
NAME="xtream-iptv-${VERSION}_webos"
mv "$IPK" "${OUT}/${NAME}.ipk"
(cd "$OUT" && sha256sum "${NAME}.ipk" > "${NAME}.ipk.sha256")
echo "Packaged ${OUT}/${NAME}.ipk"
