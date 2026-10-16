#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  NeoConfig — server manager. Installed as /usr/local/bin/neoconfig
#  neoconfig            interactive menu
#  neoconfig <command>  status | logs | restart | update | password |
#                       domain | backup | uninstall | version
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="${NEOCONFIG_DIR:-/opt/neoconfig}"
BACKUP_DIR="$INSTALL_DIR/backups"
CLI_PATH="/usr/local/bin/neoconfig"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
info() { echo -e "${CYAN}➜${NC} $*"; }
ok()   { echo -e "${GREEN}✔${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
die()  { echo -e "${RED}✘ $*${NC}" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo neoconfig)."
[[ -d "$INSTALL_DIR" ]] || die "NeoConfig is not installed in $INSTALL_DIR."
cd "$INSTALL_DIR"

compose() { docker compose "$@"; }
env_get() { grep -E "^$1=" .env 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r'; }
set_env() {
  local key=$1 val=$2
  val=${val//\\/\\\\}; val=${val//&/\\&}; val=${val//|/\\|}
  if grep -qE "^${key}=" .env; then sed -i "s|^${key}=.*|${key}=${val}|" .env; else echo "${key}=${2}" >> .env; fi
}
version() { git describe --tags --always 2>/dev/null || git rev-parse --short HEAD; }

cmd_status() {
  echo -e "${BOLD}NeoConfig${NC} $(version) · ${DIM}$INSTALL_DIR${NC}"
  echo -e "Domain: ${BOLD}$(env_get PRIMARY_DOMAIN)${NC}"
  compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
  if compose exec -T api wget -qO- http://127.0.0.1:4000/api/v1/health >/dev/null 2>&1; then ok "API healthy"; else warn "API not answering"; fi
}

cmd_logs() {
  local svc=${1:-}
  [[ -n "$svc" ]] || { echo "Service? [api/web/proxy/db, empty = all]"; read -r svc; }
  compose logs -f --tail 200 $svc
}

cmd_restart() { info "Restarting…"; compose restart; ok "Restarted"; }

cmd_update() {
  info "Checking for updates…"
  local before; before=$(git rev-parse HEAD)
  git fetch -q origin
  local branch; branch=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$(git rev-parse "origin/$branch")" == "$before" ]]; then ok "Already up to date ($(version))"; return; fi
  cmd_backup quiet
  git reset -q --hard "origin/$branch"
  info "Rebuilding (database migrations run on start)…"
  compose up -d --build
  install -m 0755 neoconfig.sh "$CLI_PATH"
  docker image prune -f >/dev/null 2>&1 || true
  ok "Updated $(git rev-parse --short "$before") → $(version)"
}

cmd_password() {
  local email newEmail p1 p2
  read -r -p "Account email (empty = owner): " email
  read -r -p "New login email (empty = keep): " newEmail
  while true; do
    read -r -s -p "New password (min 8): " p1; echo
    [[ ${#p1} -ge 8 ]] || { warn "At least 8 characters."; continue; }
    read -r -s -p "Repeat: " p2; echo
    [[ "$p1" == "$p2" ]] && break
    warn "Passwords do not match."
  done
  local out
  out=$(printf '%s' "$p1" | compose exec -T -e TARGET_EMAIL="$email" -e NEW_EMAIL="$newEmail" api node dist/cli/reset-password.js 2>&1) || die "${out#ERROR }"
  ok "Password changed for ${out#OK }; existing sessions were signed out."
  # Keep the bootstrap entry in step so a reinstall does not resurrect the old password.
  if [[ -z "$email" ]]; then
    set_env BOOTSTRAP_ADMIN_PASSWORD "$p1"
    [[ -n "$newEmail" ]] && set_env BOOTSTRAP_ADMIN_EMAIL "$newEmail"
  fi
}

cmd_domain() {
  local current; current=$(env_get PRIMARY_DOMAIN)
  read -r -p "Main domain [$current]: " d
  d=${d:-$current}; d=${d#http*://}; d=${d%%/*}
  [[ "$d" =~ ^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$ ]] || die "Not a domain name."
  set_env PRIMARY_DOMAIN "$d"
  set_env APP_URL "https://$d"
  set_env API_URL "https://$d"
  compose up -d >/dev/null
  ok "Main domain is now $d (certificate is issued on the first visit)."
  echo -e "${DIM}Brand domains are managed in the admin panel → Brands → Domain.${NC}"
}

cmd_backup() {
  mkdir -p "$BACKUP_DIR"
  local file="$BACKUP_DIR/neoconfig-$(date +%Y%m%d-%H%M%S).sql.gz"
  compose exec -T db pg_dump -U neoconfig neoconfig | gzip > "$file"
  cp .env "$BACKUP_DIR/.env.$(date +%Y%m%d-%H%M%S)"
  chmod 600 "$BACKUP_DIR"/.env.* "$file"
  ls -1t "$BACKUP_DIR"/neoconfig-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
  [[ "${1:-}" == "quiet" ]] || ok "Backup saved: $file (keeps the last 10)"
}

cmd_uninstall() {
  warn "This stops NeoConfig and removes $INSTALL_DIR."
  read -r -p "Delete the database too? [y/N]: " wipe
  read -r -p "Type 'neoconfig' to confirm: " confirm
  [[ "$confirm" == "neoconfig" ]] || die "Cancelled."
  if [[ ! "$wipe" =~ ^[Yy]$ ]]; then
    cmd_backup quiet
    local keep="/root/neoconfig-backups-$(date +%Y%m%d-%H%M%S)"
    cp -r "$BACKUP_DIR" "$keep"
    info "Database backup kept in $keep"
    compose down
  else
    compose down -v
  fi
  cd /
  rm -rf "$INSTALL_DIR" "$CLI_PATH"
  ok "NeoConfig removed."
}

menu() {
  while true; do
    clear || true
    echo -e "${BOLD}  NeoConfig${NC} $(version)   ${DIM}$(env_get PRIMARY_DOMAIN)${NC}"
    echo    "  ─────────────────────────────────"
    echo    "   1) Status"
    echo    "   2) Logs"
    echo    "   3) Restart"
    echo    "   4) Update"
    echo    "   5) Change admin password"
    echo    "   6) Change main domain"
    echo    "   7) Back up database"
    echo -e "   8) ${RED}Uninstall${NC}"
    echo    "   0) Exit"
    echo
    read -r -p "  Choose: " choice
    echo
    case "$choice" in
      1) cmd_status ;;
      2) cmd_logs ;;
      3) cmd_restart ;;
      4) cmd_update ;;
      5) cmd_password ;;
      6) cmd_domain ;;
      7) cmd_backup ;;
      8) cmd_uninstall; exit 0 ;;
      0|q|"") exit 0 ;;
      *) warn "Unknown option" ;;
    esac
    echo; read -r -p "  Press Enter to continue…" _
  done
}

case "${1:-}" in
  "") menu ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "${1:-}" ;;
  restart) cmd_restart ;;
  update) cmd_update ;;
  password) cmd_password ;;
  domain) cmd_domain ;;
  backup) cmd_backup ;;
  uninstall) cmd_uninstall ;;
  version) version ;;
  *) echo "Usage: neoconfig [status|logs|restart|update|password|domain|backup|uninstall|version]"; exit 1 ;;
esac
