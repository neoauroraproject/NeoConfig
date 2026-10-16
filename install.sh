#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  NeoConfig — one-line installer
#  bash <(curl -fsSL https://raw.githubusercontent.com/neoauroraproject/NeoConfig/main/install.sh)
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_URL="${NEOCONFIG_REPO:-https://github.com/neoauroraproject/NeoConfig.git}"
BRANCH="${NEOCONFIG_BRANCH:-main}"
INSTALL_DIR="${NEOCONFIG_DIR:-/opt/neoconfig}"
CLI_PATH="/usr/local/bin/neoconfig"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}➜${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
die()   { echo -e "${RED}✘ $*${NC}" >&2; exit 1; }

# curl | bash leaves stdin on the pipe; read answers from the terminal instead.
if [[ ! -t 0 && -r /dev/tty ]]; then exec </dev/tty; fi

[[ $EUID -eq 0 ]] || die "Run as root (sudo -i)."
[[ "$(uname -s)" == "Linux" ]] || die "NeoConfig installs on Linux servers."

banner() {
  echo -e "${BOLD}"
  echo "  ┌──────────────────────────────────────┐"
  echo "  │   NeoConfig · white-label sub viewer │"
  echo "  └──────────────────────────────────────┘"
  echo -e "${NC}"
}

install_packages() {
  local missing=()
  for bin in curl git openssl; do command -v "$bin" >/dev/null || missing+=("$bin"); done
  [[ ${#missing[@]} -eq 0 ]] && return
  info "Installing ${missing[*]}…"
  if command -v apt-get >/dev/null; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}" ca-certificates >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q "${missing[@]}"
  elif command -v yum >/dev/null; then yum install -y -q "${missing[@]}"
  else die "Install ${missing[*]} and run again."
  fi
}

install_docker() {
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) found"
    return
  fi
  info "Installing Docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
  ok "Docker installed"
}

ask() { # ask VAR "Question" "default"
  local __var=$1 prompt=$2 def=${3:-} reply
  if [[ -n "$def" ]]; then read -r -p "$(echo -e "${BOLD}?${NC} $prompt [$def]: ")" reply; else read -r -p "$(echo -e "${BOLD}?${NC} $prompt: ")" reply; fi
  printf -v "$__var" '%s' "${reply:-$def}"
}

ask_password() {
  local p1 p2
  while true; do
    read -r -s -p "$(echo -e "${BOLD}?${NC} Admin password (min 8, empty = generate): ")" p1; echo
    if [[ -z "$p1" ]]; then ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16); GENERATED_PW=1; return; fi
    [[ ${#p1} -ge 8 ]] || { warn "At least 8 characters."; continue; }
    read -r -s -p "$(echo -e "${BOLD}?${NC} Repeat password: ")" p2; echo
    [[ "$p1" == "$p2" ]] && { ADMIN_PASSWORD=$p1; return; }
    warn "Passwords do not match."
  done
}

set_env() { # set_env KEY VALUE (file .env)
  local key=$1 val=$2
  val=${val//\\/\\\\}; val=${val//&/\\&}; val=${val//|/\\|}
  if grep -qE "^${key}=" .env; then sed -i "s|^${key}=.*|${key}=${val}|" .env; else echo "${key}=${2}" >> .env; fi
}

public_ip() {
  curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'
}

main() {
  banner
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    warn "NeoConfig is already installed in $INSTALL_DIR."
    echo "    Use: neoconfig   (menu: update, password, uninstall…)"
    exit 0
  fi

  install_packages
  install_docker

  local ip; ip=$(public_ip)
  echo
  info "Point an A record for your domain to ${BOLD}${ip}${NC} before continuing."
  while true; do
    ask DOMAIN "Main domain (e.g. app.example.com)" ""
    DOMAIN=${DOMAIN#http*://}; DOMAIN=${DOMAIN%%/*}
    [[ "$DOMAIN" =~ ^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$ ]] && break
    warn "Enter a domain name; SSL certificates need one."
  done
  ask ACME_EMAIL "Email for SSL notices" "admin@${DOMAIN#*.}"
  ask ADMIN_EMAIL "Admin login email" "admin@${DOMAIN}"
  GENERATED_PW=0
  ask_password

  info "Downloading NeoConfig ($BRANCH)…"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"

  cp .env.example .env
  chmod 600 .env
  set_env NODE_ENV production
  set_env JWT_SECRET "$(openssl rand -hex 32)"
  set_env ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_env BOOTSTRAP_ADMIN_EMAIL "$ADMIN_EMAIL"
  set_env BOOTSTRAP_ADMIN_PASSWORD "$ADMIN_PASSWORD"
  set_env PRIMARY_DOMAIN "$DOMAIN"
  set_env ACME_EMAIL "$ACME_EMAIL"
  set_env PUBLIC_IP "$ip"
  set_env APP_URL "https://${DOMAIN}"
  set_env API_URL "https://${DOMAIN}"
  set_env API_INTERNAL_URL "http://api:4000"
  set_env VAPID_SUBJECT "mailto:${ACME_EMAIL}"

  info "Building and starting (first run takes a few minutes)…"
  docker compose up -d --build

  install -m 0755 neoconfig.sh "$CLI_PATH"
  ok "Command installed: neoconfig"

  info "Waiting for the API…"
  for _ in $(seq 1 60); do
    if docker compose exec -T api wget -qO- http://127.0.0.1:4000/api/v1/health >/dev/null 2>&1; then break; fi
    sleep 3
  done

  echo
  ok "${BOLD}NeoConfig is running${NC}"
  echo -e "   App:    ${BOLD}https://${DOMAIN}${NC}"
  echo -e "   Admin:  ${BOLD}https://${DOMAIN}/admin${NC}"
  echo -e "   Login:  ${ADMIN_EMAIL}"
  if [[ $GENERATED_PW -eq 1 ]]; then echo -e "   Password: ${BOLD}${ADMIN_PASSWORD}${NC}   (shown once — change it with: neoconfig password)"; fi
  echo
  echo -e "   Manage: ${BOLD}neoconfig${NC}  → status, logs, update, password, domain, backup, uninstall"
}

main "$@"
