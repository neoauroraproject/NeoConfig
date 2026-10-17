#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  NeoConfig — one-line installer (native: systemd + nginx + PostgreSQL)
#  bash <(curl -fsSL https://raw.githubusercontent.com/neoauroraproject/NeoConfig/main/install.sh)
#
#  Downloads the prebuilt release for this CPU from GitHub Releases and
#  hands over to its `neoconfig install`. Nothing is compiled on the server.
#  Pin a version:   NEOCONFIG_VERSION=v1.0.0 bash <(curl …)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="${NEOCONFIG_REPO:-neoauroraproject/NeoConfig}"
RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
die() { echo -e "${RED}✘ $*${NC}" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo -i)."
[[ "$(uname -s)" == Linux ]] || die "NeoConfig installs on Linux servers."
command -v apt-get >/dev/null || die "NeoConfig supports Ubuntu 22.04+ and Debian 12+."
if ! command -v curl >/dev/null || ! command -v xz >/dev/null || ! command -v openssl >/dev/null; then
  apt-get update -qq && apt-get install -y -qq curl ca-certificates xz-utils openssl >/dev/null
fi
# Prebuilt engines need OpenSSL 3 (Ubuntu 22.04+, Debian 12+).
OSSL=$(openssl version 2>/dev/null | awk '{print $2}' | cut -d. -f1)
[[ "${OSSL:-0}" -ge 3 ]] || die "This system has OpenSSL ${OSSL:-?}. NeoConfig needs Ubuntu 22.04+ or Debian 12+."

case "$(uname -m)" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "Unsupported CPU: $(uname -m)" ;;
esac

TAG="${NEOCONFIG_VERSION:-}"
if [[ -z "$TAG" ]]; then
  TAG=$(curl -fsSI "https://github.com/$REPO/releases/latest" | tr -d '\r' | awk -F/ 'tolower($1) ~ /^location:/ {print $NF}')
fi
[[ -n "$TAG" ]] || die "Could not find the latest release on github.com/$REPO"

FILE="neoconfig-linux-$ARCH.tar.xz"
URL="https://github.com/$REPO/releases/download/$TAG/$FILE"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo -e "${CYAN}➜${NC} Downloading NeoConfig $TAG ($ARCH)…"
curl -fL --retry 3 --progress-bar -o "$WORK/$FILE" "$URL" || die "Download failed: $URL"
if curl -fsSL -o "$WORK/$FILE.sha256" "$URL.sha256" 2>/dev/null; then
  (cd "$WORK" && sha256sum -c "$FILE.sha256" >/dev/null) || die "Checksum mismatch"
fi
tar -xJf "$WORK/$FILE" -C "$WORK"

# Prompts read from the terminal even when this script arrives through a pipe.
if [[ ! -t 0 ]] && (exec </dev/tty) 2>/dev/null; then exec </dev/tty; fi
bash "$WORK/neoconfig/neoconfig" install
