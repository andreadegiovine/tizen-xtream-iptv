#!/usr/bin/env bash
# Signs the Tizen widget from the production build in dist/ (`npm run build:tizen`).
#
#   CERT_PASSWORD=... bash platforms/tizen/package.sh <version> [out-dir]
#
# Installs the Tizen Studio CLI, registers the signing profile with platforms/tizen/tizencert.p12 (its password comes from the
# TIZEN_CERT_PASSWORD secret, passed as CERT_PASSWORD) and writes <out-dir>/xtream-iptv-<version>.wgt with its .sha256 (out-dir: release).
# Run by the "tizen" job of .github/workflows/release.yml; it works on any Linux machine with curl.
set -euo pipefail

VERSION="${1:?version (x.y.z) required}"
OUT="${2:-release}"
ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/../.." && pwd)}"
TMP="${RUNNER_TEMP:-$(mktemp -d)}"
TIZEN_STUDIO_VER="${TIZEN_STUDIO_VER:-4.5.1}"
TIZEN_PROFILE="${TIZEN_PROFILE:-xtream}"
STUDIO="${ROOT}/tizen-studio"
DATA="${STUDIO}-data"
TIZEN="${STUDIO}/tools/ide/bin/tizen"
PROFILES="${DATA}/profile/profiles.xml"
SIGNER_PWD="tizenpkcs12passfordsigner"
CERT_SOURCE="${ROOT}/platforms/tizen/tizencert.p12"
SIGN_DIR="${TMP}/tizen-sign" # the certificate is copied here: the CLI writes its password file next to it, outside the repository
CERT="${SIGN_DIR}/tizencert.p12"

if [ -z "${CERT_PASSWORD:-}" ]; then
  echo "::error::Secret TIZEN_CERT_PASSWORD is not set."
  exit 1
fi
if [ ! -f "$CERT_SOURCE" ]; then
  echo "::error::platforms/tizen/tizencert.p12 not found."
  exit 1
fi
if [ ! -f "${ROOT}/dist/config.xml" ]; then
  echo "::error::dist/config.xml not found: run npm run build:tizen first."
  exit 1
fi

trap 'echo "--- Tizen CLI log ---"; cat "${DATA}/cli/logs/cli.log" 2>/dev/null || true' ERR

# Tizen Studio CLI
if [ ! -x "$TIZEN" ]; then
  if ! command -v expect >/dev/null; then sudo apt-get install -y expect; fi
  curl -fsSL -o "${TMP}/tizen-installer" \
    "https://download.tizen.org/sdk/Installer/tizen-studio_${TIZEN_STUDIO_VER}/web-cli_Tizen_Studio_${TIZEN_STUDIO_VER}_ubuntu-64.bin"
  chmod +x "${TMP}/tizen-installer"
  "${TMP}/tizen-installer" --accept-license "$STUDIO"
  rm "${TMP}/tizen-installer"
fi

# Signing profile
mkdir -p "$SIGN_DIR"
cp "$CERT_SOURCE" "$CERT"
"$TIZEN" security-profiles add -n "$TIZEN_PROFILE" -a "$CERT" -p "$CERT_PASSWORD"
"$TIZEN" cli-config "profiles.path=${PROFILES}"
chmod 755 "$PROFILES"

# Replace the password-file references with the actual passwords so signing is non-interactive.
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
CERT_PWD_ESC="$(esc "$CERT_PASSWORD")"
sed -i "s|${CERT%.p12}.pwd|${CERT_PWD_ESC}|g" "$PROFILES"
sed -i "s|${DATA}/tools/certificate-generator/certificates/distributor/tizen-distributor-signer.pwd|${SIGNER_PWD}|g" "$PROFILES"
sed -i "s|password=\"\"|password=\"${SIGNER_PWD}\"|g" "$PROFILES"

# Safety net: answers any password prompt that `tizen package` still raises.
cat > "${TMP}/package.exp" <<'EXP'
set timeout 300
spawn {*}$argv
expect {
  -nocase -re {distributor[^\n]*password[^\n]*:} { send "tizenpkcs12passfordsigner\r"; exp_continue }
  -nocase -re {password[^\n]*:} { send "$env(CERT_PASSWORD)\r"; exp_continue }
  timeout { puts "timeout waiting for tizen package"; exit 1 }
  eof
}
catch wait result
exit [lindex $result 3]
EXP

# Sign the production widget
mkdir -p "${ROOT}/${OUT}"
NAME="xtream-iptv-${VERSION}"
WGT_DIR="${TMP}/wgt-${NAME}"
mkdir -p "$WGT_DIR"
export CERT_PASSWORD
expect "${TMP}/package.exp" "$TIZEN" package -t wgt -s "$TIZEN_PROFILE" -o "$WGT_DIR" -- "${ROOT}/dist"
WGT="$(find "$WGT_DIR" "${ROOT}/dist" -maxdepth 1 -name '*.wgt' | head -n1)"
if [ -z "$WGT" ]; then
  echo "::error::No .wgt produced"
  exit 1
fi
mv "$WGT" "${ROOT}/${OUT}/${NAME}.wgt"
(cd "${ROOT}/${OUT}" && sha256sum "${NAME}.wgt" > "${NAME}.wgt.sha256")
echo "Signed ${OUT}/${NAME}.wgt"
