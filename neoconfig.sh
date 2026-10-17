#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  NeoConfig — server manager. Installed as /usr/local/bin/neoconfig
#  neoconfig            interactive menu
#  neoconfig <command>  status | logs | restart | update | password |
#                       domain | backup | doctor | uninstall | version
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

compose() {
  # Servers that cannot reach ghcr.io build locally (set by the installer).
  if [[ "$(env_get NEOCONFIG_BUILD_LOCAL)" == "1" ]]; then
    docker compose -f docker-compose.yml -f docker-compose.build.yml "$@"
  else
    docker compose "$@"
  fi
}
env_get() { grep -E "^$1=" .env 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r'; }
set_env() {
  local key=$1 val=$2
  val=${val//\\/\\\\}; val=${val//&/\\&}; val=${val//|/\\|}
  if grep -qE "^${key}=" .env; then sed -i "s|^${key}=.*|${key}=${val}|" .env; else echo "${key}=${2}" >> .env; fi
}
version() {
  local rev
  rev=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' neoconfig-api-1 2>/dev/null | cut -c1-7)
  echo "${rev:-$(git rev-parse --short HEAD 2>/dev/null)}"
}

wait_healthy() {
  info "Waiting for the API (migrations run on start)…"
  for _ in $(seq 1 40); do
    [[ "$(docker inspect --format '{{.State.Health.Status}}' neoconfig-api-1 2>/dev/null)" == "healthy" ]] && { ok "API is up"; return 0; }
    sleep 3
  done
  warn "API is not healthy yet — check: neoconfig logs api"
  return 1
}

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
  local before branch
  before=$(version)
  branch=$(git rev-parse --abbrev-ref HEAD)
  info "Fetching scripts and settings…"
  git fetch -q --depth 1 origin "$branch" && git reset -q --hard FETCH_HEAD
  install -m 0755 neoconfig.sh "$CLI_PATH"
  open_firewall
  cmd_backup quiet
  if [[ "$(env_get NEOCONFIG_BUILD_LOCAL)" == "1" ]]; then
    info "Building on this server (database migrations run on start)…"
    compose up -d --build
  else
    info "Downloading new images…"
    compose pull -q
    compose up -d
  fi
  wait_healthy
  docker image prune -f >/dev/null 2>&1 || true
  local after; after=$(version)
  if [[ "$before" == "$after" ]]; then ok "Already up to date ($after)"; else ok "Updated $before → $after"; fi
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

open_firewall() {
  # Let's Encrypt and visitors need 80 and 443 reachable from the internet.
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
    echo "ufw: opened 80/tcp, 443/tcp, 443/udp"
  fi
  if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd -q --permanent --add-service=http --add-service=https && firewall-cmd -q --reload
    echo "firewalld: opened http/https"
  fi
}

cmd_doctor() {
  local domain ip resolved bad=0
  domain=$(env_get PRIMARY_DOMAIN)
  echo -e "${BOLD}Checking ${domain:-<no PRIMARY_DOMAIN>}${NC}"

  ip=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || env_get PUBLIC_IP)
  resolved=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
  if [[ -z "$domain" ]]; then warn "PRIMARY_DOMAIN is empty — run: neoconfig domain"; bad=1
  elif [[ -z "$resolved" ]]; then warn "DNS: $domain has no A record. Point it to $ip."; bad=1
  elif [[ " $resolved " == *" $ip "* ]]; then ok "DNS: $domain → $ip"
  elif echo "$resolved" | grep -qE '^(104\.(1[6-9]|2[0-9]|3[01])|172\.6[4-9]|172\.7[01]|188\.114|190\.93|197\.234|198\.41)\.'; then
    warn "DNS: $domain → $resolved (Cloudflare proxy). Turn the orange cloud OFF (DNS only) until the certificate is issued."; bad=1
  else warn "DNS: $domain → $resolved, but this server is $ip."; bad=1
  fi

  for p in 80 443; do
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$p$"; then ok "Port $p is listening"; else warn "Nothing listens on port $p (is the proxy container up?)"; bad=1; fi
  done
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw status | grep -qE "^(80|443)(/tcp)?\s+ALLOW" && ok "ufw allows 80/443" || { warn "ufw is active and may block 80/443 → ufw allow 80,443/tcp"; bad=1; }
  fi

  if [[ -n "$domain" ]]; then
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -H "Host: $domain" http://127.0.0.1/ || true)
    [[ "$code" == 30* ]] && ok "Proxy answers locally (HTTP $code → HTTPS)" || { warn "Proxy did not answer locally on port 80 (got ${code:-nothing})"; bad=1; }
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$domain/api/v1/health" || true)
    if [[ "$code" == 200 ]]; then ok "https://$domain works"
    elif [[ "$code" == 502 || "$code" == 503 ]]; then
      ok "SSL certificate is in place (HTTPS answered)"
      warn "…but the app behind it is not up (HTTP $code). Container state:"
      compose ps --format 'table {{.Service}}	{{.State}}	{{.Status}}'
      echo -e "
${BOLD}Last API log lines:${NC}"
      compose logs --no-color --tail 25 api 2>/dev/null | sed 's/^/  /'
      echo -e "${DIM}Right after an update the API needs ~40s for migrations — run 'neoconfig doctor' again in a minute.${NC}"
      bad=1
    else warn "https://$domain not reachable yet (got ${code:-no answer})"; bad=1
    fi
  fi

  echo -e "\n${BOLD}Certificate log (last lines):${NC}"
  compose logs --no-color proxy 2>/dev/null | grep -iE 'certificate obtained|obtain|acme|challenge|error|failed' | tail -n 12 || true
  echo
  if [[ $bad -eq 0 ]]; then ok "All checks passed."; fi
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
    echo    "   9) Diagnose domain & SSL"
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
      9) cmd_doctor ;;
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
  doctor) cmd_doctor ;;
  logs) shift; cmd_logs "${1:-}" ;;
  restart) cmd_restart ;;
  update) cmd_update ;;
  password) cmd_password ;;
  domain) cmd_domain ;;
  backup) cmd_backup ;;
  uninstall) cmd_uninstall ;;
  version) version ;;
  *) echo "Usage: neoconfig [status|doctor|logs|restart|update|password|domain|backup|uninstall|version]"; exit 1 ;;
esac
