#!/usr/bin/env bash
# NeoConfig one-line Linux installer
# Example:
#   curl -fsSL https://APP_DOMAIN/install.sh -o /tmp/neoconfig-install.sh && sudo bash /tmp/neoconfig-install.sh --token 'TOKEN'
#
# WARNING: You are about to run a privileged installer. Review this script before use.
# The enrollment token is single-use and short-lived. Panel admin credentials are NEVER placed in this command.

set -euo pipefail

TOKEN=""
API_URL=""
APP_URL=""
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/neoconfig"
SERVICE_NAME="neoconfig-agent"
AGENT_VERSION="${NEOCONFIG_AGENT_VERSION:-1.0.0}"
SHA256_PIN="${NEOCONFIG_AGENT_SHA256:-}"

usage() {
  cat <<EOF
Usage: sudo bash install.sh --token TOKEN [--api-url URL] [--app-url URL]

Options:
  --token      One-time enrollment token from the admin panel (required)
  --api-url    Backend API origin (default: derived from app URL)
  --app-url    Public app origin that hosts releases (default: script host)
  --help       Show this help

This installer downloads a single static binary agent. It does NOT install or
modify 3x-ui, Xray, or firewall rules.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --app-url) APP_URL="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

if [[ -z "$TOKEN" ]]; then
  echo "--token is required" >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
if [[ "$OS" != "linux" ]]; then
  echo "This installer currently supports Linux only." >&2
  exit 1
fi

if [[ -z "$APP_URL" ]]; then
  APP_URL="${NEOCONFIG_APP_URL:-https://localhost}"
fi
APP_URL="${APP_URL%/}"
if [[ -z "$API_URL" ]]; then
  API_URL="${NEOCONFIG_API_URL:-$APP_URL}"
fi
API_URL="${API_URL%/}"

BINARY_NAME="neoconfig-agent-linux-${ARCH}"
DOWNLOAD_URL="${APP_URL}/releases/${AGENT_VERSION}/${BINARY_NAME}"
TMP_BIN="$(mktemp)"

echo "==> NeoConfig agent installer"
echo "    OS/Arch : ${OS}/${ARCH}"
echo "    Download: ${DOWNLOAD_URL}"
echo "    WARNING : Review remote scripts before running with root privileges."

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN"

if [[ -n "$SHA256_PIN" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$TMP_BIN" | awk '{print $1}')"
  else
    ACTUAL="$(shasum -a 256 "$TMP_BIN" | awk '{print $1}')"
  fi
  if [[ "$ACTUAL" != "$SHA256_PIN" ]]; then
    echo "Checksum mismatch. Aborting." >&2
    rm -f "$TMP_BIN"
    exit 1
  fi
  echo "    Checksum verified."
else
  echo "    NOTE: No SHA256 pin configured (set NEOCONFIG_AGENT_SHA256 for production)."
fi

install -m 0755 "$TMP_BIN" "${INSTALL_DIR}/neoconfig-agent"
rm -f "$TMP_BIN"
mkdir -p "$CONFIG_DIR"
chmod 0700 "$CONFIG_DIR"

echo "==> Enrolling with backend"
"${INSTALL_DIR}/neoconfig-agent" --enroll --token "$TOKEN" --api-url "$API_URL" --config "${CONFIG_DIR}/agent.yaml"

echo "==> Installing systemd service"
cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=NeoConfig Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/neoconfig-agent --config ${CONFIG_DIR}/agent.yaml
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${CONFIG_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

echo ""
echo "Installation complete."
echo "  Binary : ${INSTALL_DIR}/neoconfig-agent"
echo "  Config : ${CONFIG_DIR}/agent.yaml"
echo "  Service: systemctl status ${SERVICE_NAME}"
echo ""
echo "Uninstall:"
echo "  sudo systemctl disable --now ${SERVICE_NAME} && sudo rm -f ${INSTALL_DIR}/neoconfig-agent /etc/systemd/system/${SERVICE_NAME}.service && sudo rm -rf ${CONFIG_DIR}"
