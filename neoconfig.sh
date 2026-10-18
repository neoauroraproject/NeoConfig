#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  NeoConfig — installer and server manager (native, no Docker)
#
#  neoconfig                 interactive menu
#  neoconfig <command>       status | doctor | logs | restart | update |
#                            rollback | password | domain | ssl | backup |
#                            uninstall | version
#
#  Layout
#    /opt/neoconfig/releases/<version>/   node + api + web (prebuilt)
#    /opt/neoconfig/current -> releases/<version>
#    /opt/neoconfig/.env                  settings and secrets
#    systemd: neoconfig-api, neoconfig-web, neoconfig-ssl.path
#    nginx:   /etc/nginx/conf.d/neoconfig-<domain>.conf
#    certs:   acme.sh (Let's Encrypt) → /etc/neoconfig/ssl/<domain>/
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="${NEOCONFIG_REPO:-neoauroraproject/NeoConfig}"
ROOT="/opt/neoconfig"
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
ENV_FILE="$ROOT/.env"
BACKUP_DIR="$ROOT/backups"
QUEUE="/var/lib/neoconfig/ssl"
WEBROOT="/var/www/neoconfig-acme"
SSL_DIR="/etc/neoconfig/ssl"
NGINX_CONF="/etc/nginx/conf.d"
PROXY_SNIPPET="/etc/nginx/neoconfig-proxy.conf"
ACME="/root/.acme.sh/acme.sh"
CLI="/usr/local/bin/neoconfig"
SVC_USER="neoconfig"
API_PORT=4000
WEB_PORT=3000

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
info() { echo -e "${CYAN}➜${NC} $*"; }
ok()   { echo -e "${GREEN}✔${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
die()  { echo -e "${RED}✘ $*${NC}" >&2; exit 1; }

need_root() { [[ $EUID -eq 0 ]] || die "Run as root (sudo -i)."; }

# ---------- .env (values are single-quoted: safe for bash, systemd and dotenv) ----------
env_get() { [[ -f "$ENV_FILE" ]] || return 0; grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//" -e 's/^"//' -e 's/"$//'; }
env_set() {
  local key=$1 val=$2
  [[ "$val" == *"'"* ]] && die "Value for $key may not contain a single quote."
  mkdir -p "$(dirname "$ENV_FILE")"; touch "$ENV_FILE"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    local tmp; tmp=$(mktemp)
    awk -v k="$key" -v v="'$val'" 'index($0, k"=")==1 {print k"="v; next} {print}' "$ENV_FILE" > "$tmp" && cat "$tmp" > "$ENV_FILE" && rm -f "$tmp"
  else
    echo "${key}='${val}'" >> "$ENV_FILE"
  fi
}

node_bin() { echo "$CURRENT/node/bin/node"; }
version() { cat "$CURRENT/VERSION" 2>/dev/null || echo "not installed"; }
is_domain() { [[ ${#1} -le 253 && "$1" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]]; }
public_ip() { curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || curl -4fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'; }
resolve4() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' | sed 's/ $//'; }
has_ipv6() { [[ -s /proc/net/if_inet6 ]]; }
api_healthy() { curl -fsS --max-time 3 "http://127.0.0.1:$API_PORT/api/v1/health" >/dev/null 2>&1; }

arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    *) die "Unsupported CPU: $(uname -m) (amd64 and arm64 are supported)" ;;
  esac
}

ask() { # ask VAR "Question" "default"   (a preset VAR is kept as-is)
  local __v=$1 q=$2 d=${3:-} r
  [[ -n "${!__v:-}" ]] && return
  r=""
  if [[ -n "$d" ]]; then read -r -p "$(echo -e "${BOLD}?${NC} $q [$d]: ")" r || true; else read -r -p "$(echo -e "${BOLD}?${NC} $q: ")" r || true; fi
  printf -v "$__v" '%s' "${r:-$d}"
}

# ═══════════════════════════ releases ═══════════════════════════

latest_tag() {
  # The /releases/latest redirect carries the tag; no API rate limits.
  curl -fsSI "https://github.com/$REPO/releases/latest" 2>/dev/null | tr -d '\r' | awk -F/ 'tolower($1) ~ /^location:/ {print $NF}'
}

# fetch_release <tag> → prints the extracted release dir
fetch_release() {
  local tag=$1 a file url tmp dir
  a=$(arch)
  file="neoconfig-linux-$a.tar.xz"
  url="https://github.com/$REPO/releases/download/$tag/$file"
  dir="$RELEASES/$tag"
  if [[ -x "$dir/node/bin/node" ]]; then echo "$dir"; return; fi
  tmp=$(mktemp -d)
  info "Downloading NeoConfig $tag ($a)…" >&2
  curl -fL --retry 3 --progress-bar -o "$tmp/$file" "$url" >&2 || die "Download failed: $url"
  if curl -fsSL -o "$tmp/$file.sha256" "$url.sha256" 2>/dev/null; then
    (cd "$tmp" && sha256sum -c "$file.sha256" >/dev/null) || die "Checksum mismatch for $file"
  fi
  mkdir -p "$dir"
  tar -xJf "$tmp/$file" -C "$dir" --strip-components=1
  rm -rf "$tmp"
  chown -R root:root "$dir"
  echo "$dir"
}

prune_releases() {
  local keep; keep=$(readlink -f "$CURRENT" 2>/dev/null || true)
  ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's#/$##' | tail -n +4 | while read -r d; do
    [[ "$(readlink -f "$d")" == "$keep" ]] || rm -rf "$d"
  done
}

# ═══════════════════════════ system setup ═══════════════════════════

install_packages() {
  command -v apt-get >/dev/null || die "This installer supports Ubuntu and Debian (apt)."
  info "Installing nginx, PostgreSQL and tools…"
  export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1
  apt-get update -qq
  apt-get install -y -qq nginx postgresql postgresql-client curl ca-certificates openssl tar xz-utils cron socat iproute2 >/dev/null
  systemctl enable --now postgresql nginx cron >/dev/null 2>&1 || true
  ok "Packages ready"
}

ensure_user() {
  id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$ROOT" --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
  mkdir -p "$QUEUE" "$WEBROOT/.well-known/acme-challenge" "$SSL_DIR" "$BACKUP_DIR"
  chown "$SVC_USER:$SVC_USER" "$QUEUE"; chmod 0750 "$QUEUE"
}

setup_database() {
  local pw exists
  exists=$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='neoconfig'" 2>/dev/null || true)
  if [[ "$exists" == "1" && "$(env_get DATABASE_URL)" == *"@127.0.0.1:5432/"* ]]; then return; fi
  pw=$(openssl rand -hex 24)
  if [[ "$exists" == "1" ]]; then
    runuser -u postgres -- psql -qc "ALTER ROLE neoconfig WITH LOGIN PASSWORD '$pw'"
  else
    runuser -u postgres -- psql -qc "CREATE ROLE neoconfig WITH LOGIN PASSWORD '$pw'"
  fi
  if [[ "$(runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='neoconfig'")" != "1" ]]; then
    runuser -u postgres -- createdb -O neoconfig neoconfig
  fi
  env_set DATABASE_URL "postgresql://neoconfig:${pw}@127.0.0.1:5432/neoconfig?schema=public"
  ok "Database ready"
}

write_units() {
  # Point Prisma at the bundled engines so it never tries to download any.
  local qe se
  qe=$(basename "$(ls "$CURRENT"/api/node_modules/.prisma/client/libquery_engine-*.so.node 2>/dev/null | head -n1)")
  se=$(basename "$(ls "$CURRENT"/api/node_modules/@prisma/engines/schema-engine-* 2>/dev/null | head -n1)")
  cat > /etc/systemd/system/neoconfig-api.service <<EOF
[Unit]
Description=NeoConfig API
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$CURRENT/api
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=$API_PORT NEOCONFIG_SSL_QUEUE=$QUEUE NPM_CONFIG_UPDATE_NOTIFIER=false
Environment=PRISMA_QUERY_ENGINE_LIBRARY=$CURRENT/api/node_modules/.prisma/client/$qe
Environment=PRISMA_SCHEMA_ENGINE_BINARY=$CURRENT/api/node_modules/@prisma/engines/$se
Environment=PRISMA_HIDE_UPDATE_MESSAGE=1 CHECKPOINT_DISABLE=1
ExecStartPre=$CURRENT/node/bin/node node_modules/prisma/build/index.js migrate deploy
ExecStart=$CURRENT/node/bin/node dist/main.js
Restart=always
RestartSec=3
TimeoutStartSec=180
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/neoconfig-web.service <<EOF
[Unit]
Description=NeoConfig web app
After=neoconfig-api.service

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$CURRENT/web/apps/web
Environment=NODE_ENV=production HOSTNAME=127.0.0.1 PORT=$WEB_PORT API_INTERNAL_URL=http://127.0.0.1:$API_PORT NEXT_TELEMETRY_DISABLED=1
ExecStart=$CURRENT/node/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  # Certificates for brand domains added in the admin panel: the API drops a
  # request file, this root unit validates it and does the privileged work.
  cat > /etc/systemd/system/neoconfig-ssl.path <<EOF
[Unit]
Description=NeoConfig certificate requests

[Path]
PathExistsGlob=$QUEUE/*.issue
PathExistsGlob=$QUEUE/*.remove

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/neoconfig-ssl.service <<EOF
[Unit]
Description=NeoConfig certificate worker

[Service]
Type=oneshot
ExecStart=$CLI ssl-process
EOF

  systemctl daemon-reload
}

write_proxy_snippet() {
  cat > "$PROXY_SNIPPET" <<'EOF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header Connection "";
proxy_read_timeout 90s;
EOF
}

open_firewall() {
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
    ok "ufw: opened 80/tcp and 443/tcp"
  fi
  if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd -q --permanent --add-service=http --add-service=https && firewall-cmd -q --reload
    ok "firewalld: opened http/https"
  fi
  return 0
}

# ═══════════════════════════ nginx + certificates ═══════════════════════════

listen_lines() { # listen_lines <port> [extra]
  local extra=${2:-}
  echo "    listen $1${extra:+ $extra};"
  if has_ipv6; then echo "    listen [::]:$1${extra:+ $extra};"; fi
}

app_locations() {
  cat <<EOF
    client_max_body_size 6m;
    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; default_type text/plain; }
    location /api/v1/ { proxy_pass http://127.0.0.1:$API_PORT; include $PROXY_SNIPPET; }
    location / { proxy_pass http://127.0.0.1:$WEB_PORT; include $PROXY_SNIPPET; }
EOF
}

# Before a certificate exists the site is served over plain HTTP, so it is
# usable immediately and Let's Encrypt can reach the challenge path.
vhost_http() {
  local d=$1
  {
    echo "# NeoConfig — $d (HTTP only, no certificate yet)"
    echo "server {"
    listen_lines 80
    echo "    server_name $d;"
    app_locations
    echo "}"
  } > "$NGINX_CONF/neoconfig-$d.conf"
}

vhost_https() {
  local d=$1
  {
    echo "# NeoConfig — $d"
    echo "server {"
    listen_lines 80
    echo "    server_name $d;"
    echo "    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; default_type text/plain; }"
    echo "    location / { return 301 https://\$host\$request_uri; }"
    echo "}"
    echo "server {"
    listen_lines 443 "ssl http2"
    echo "    server_name $d;"
    echo "    ssl_certificate $SSL_DIR/$d/fullchain.pem;"
    echo "    ssl_certificate_key $SSL_DIR/$d/key.pem;"
    echo "    ssl_protocols TLSv1.2 TLSv1.3;"
    echo "    ssl_session_cache shared:neoconfig:10m;"
    echo "    ssl_session_timeout 1d;"
    app_locations
    echo "}"
  } > "$NGINX_CONF/neoconfig-$d.conf"
}

nginx_reload() {
  if ! nginx -t >/dev/null 2>&1; then nginx -t; return 1; fi
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
}

step() { echo -e "   ${DIM}… $*${NC}" >&2; }
reachable() { curl -fsS -o /dev/null --connect-timeout 8 --max-time 15 "$1" 2>/dev/null; }

# Prints a reason on stdout and returns 1 on failure (never blocks for long).
install_acme() {
  [[ -x "$ACME" ]] && return 0
  step "installing acme.sh"
  local email tmp
  email=$(env_get ACME_EMAIL); email=${email:-admin@example.com}
  tmp=$(mktemp -d)
  if ! curl -fsSL --connect-timeout 10 --max-time 120 -o "$tmp/acme.tar.gz" \
      https://github.com/acmesh-official/acme.sh/archive/refs/heads/master.tar.gz; then
    rm -rf "$tmp"; echo "Could not download acme.sh from GitHub"; return 1
  fi
  tar -xzf "$tmp/acme.tar.gz" -C "$tmp"
  (cd "$tmp"/acme.sh-master && timeout 120 ./acme.sh --install --home /root/.acme.sh --accountemail "$email" >/dev/null 2>&1) || true
  rm -rf "$tmp"
  [[ -x "$ACME" ]] || { echo "acme.sh could not be installed"; return 1; }
}

cert_expiry() { openssl x509 -enddate -noout -in "$SSL_DIR/$1/fullchain.pem" 2>/dev/null | cut -d= -f2; }

# ssl_issue <domain> → 0 on success; prints a one-line result either way
ssl_issue() {
  local d=$1 ip resolved log rc reason="" email m ca
  local -a cas=()
  is_domain "$d" || { echo "Invalid domain name"; return 1; }
  step "checking DNS"
  ip=$(public_ip); resolved=$(resolve4 "$d")
  if [[ -z "$resolved" ]]; then echo "DNS: $d has no A record (point it to $ip)"; return 1; fi
  if [[ " $resolved " != *" $ip "* ]]; then
    echo "DNS: $d points to $resolved, not this server ($ip). Behind Cloudflare? Switch the record to DNS only."
    return 1
  fi
  if ! m=$(install_acme); then echo "$m"; return 1; fi
  write_proxy_snippet
  if [[ ! -f "$SSL_DIR/$d/fullchain.pem" ]]; then
    vhost_http "$d"
    nginx_reload >/dev/null || { echo "nginx configuration test failed"; return 1; }
  fi

  # Use whichever certificate authority this server can actually reach.
  step "checking which certificate authorities are reachable"
  reachable https://acme-v02.api.letsencrypt.org/directory && cas+=(letsencrypt)
  reachable https://acme.zerossl.com/v2/DV90 && cas+=(zerossl)
  if [[ ${#cas[@]} -eq 0 ]]; then
    echo "This server cannot reach Let's Encrypt or ZeroSSL (outbound HTTPS to them is blocked)"; return 1
  fi
  email=$(env_get ACME_EMAIL); email=${email:-admin@example.com}
  log=$(mktemp)
  rc=1
  for ca in "${cas[@]}"; do
    step "requesting a certificate from $ca (up to 5 minutes)"
    if [[ $ca == zerossl ]]; then
      timeout 90 "$ACME" --register-account -m "$email" --server zerossl >/dev/null 2>&1 || true
    fi
    set +e
    timeout 300 "$ACME" --issue -d "$d" -w "$WEBROOT" --server "$ca" --keylength ec-256 >"$log" 2>&1
    rc=$?
    set -e
    [[ $rc -eq 0 || $rc -eq 2 ]] && break   # 2 = already valid
    if [[ $rc -eq 124 ]]; then reason="$ca timed out"
    else reason="$ca: $(grep -vE "Please add '--debug'|See: https|wiki|^\s*$" "$log" | tail -n1 | sed -e 's/\[[0-9;]*m//g' -e 's/^\[[^]]*\] //' | cut -c1-200)"; fi
    step "$reason"
  done
  rm -f "$log"
  if [[ $rc -ne 0 && $rc -ne 2 ]]; then
    echo "Could not get a certificate for $d ($reason). Port 80 must be reachable from the internet."
    return 1
  fi
  step "installing the certificate"
  mkdir -p "$SSL_DIR/$d"
  if ! timeout 60 "$ACME" --install-cert -d "$d" --ecc \
      --key-file "$SSL_DIR/$d/key.pem" \
      --fullchain-file "$SSL_DIR/$d/fullchain.pem" \
      --reloadcmd "systemctl reload nginx" >/dev/null 2>&1; then
    echo "Certificate installation failed"; return 1
  fi
  chmod 600 "$SSL_DIR/$d/key.pem"
  vhost_https "$d"
  if ! nginx_reload >/dev/null; then
    vhost_http "$d"; nginx_reload >/dev/null || true
    echo "nginx rejected the HTTPS configuration"; return 1
  fi
  echo "Certificate valid until $(cert_expiry "$d")"
}

ssl_remove() {
  local d=$1
  is_domain "$d" || return 1
  if [[ "$d" == "$(env_get PRIMARY_DOMAIN)" ]]; then echo "The main domain cannot be removed here"; return 1; fi
  rm -f "$NGINX_CONF/neoconfig-$d.conf"
  if [[ -x "$ACME" ]]; then "$ACME" --remove -d "$d" --ecc >/dev/null 2>&1 || true; fi
  rm -rf "${SSL_DIR:?}/$d" "/root/.acme.sh/${d}_ecc"
  nginx_reload >/dev/null || true
  echo "Removed"
}

json_str() { printf '%s' "$1" | tr -d '\r' | tr '\n' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

write_result() { # write_result <domain> <true|false> <message>
  local exp=""; [[ "$2" == true ]] && exp=$(cert_expiry "$1")
  printf '{"ok":%s,"message":"%s","at":"%s","expires":"%s"}\n' "$2" "$(json_str "$3")" "$(date -u +%FT%TZ)" "$(json_str "$exp")" > "$QUEUE/$1.result"
  chown "$SVC_USER:$SVC_USER" "$QUEUE/$1.result" 2>/dev/null || true
}

# Root worker for requests the API queued (brand domains from the admin panel).
cmd_ssl_process() {
  shopt -s nullglob
  local f d action msg
  for f in "$QUEUE"/*.issue "$QUEUE"/*.remove; do
    action=${f##*.}; d=$(basename "$f" ".$action")
    rm -f "$f"
    is_domain "$d" || continue
    if [[ "$action" == issue ]]; then
      # Never trust the file alone: the API must confirm the domain belongs to a brand.
      if ! curl -fsS --max-time 5 "http://127.0.0.1:$API_PORT/api/v1/public/domain-check?domain=$d" >/dev/null 2>&1; then
        write_result "$d" false "This domain is not connected to any brand"
        continue
      fi
      if msg=$(ssl_issue "$d" 2>&1); then write_result "$d" true "$msg"; else write_result "$d" false "$msg"; fi
    else
      ssl_remove "$d" >/dev/null 2>&1 || true
      rm -f "$QUEUE/$d.result"
    fi
  done
}

cmd_ssl() {
  local sub=${1:-list} d=${2:-} msg f
  case "$sub" in
    add|issue|renew)
      [[ -n "$d" ]] || die "Usage: neoconfig ssl add <domain>"
      if msg=$(ssl_issue "$d"); then ok "$d: $msg"; else die "$d: $msg"; fi ;;
    remove)
      [[ -n "$d" ]] || die "Usage: neoconfig ssl remove <domain>"
      ssl_remove "$d" && ok "$d removed" ;;
    list)
      shopt -s nullglob
      for f in "$NGINX_CONF"/neoconfig-*.conf; do
        d=$(basename "$f" .conf); d=${d#neoconfig-}
        if [[ -f "$SSL_DIR/$d/fullchain.pem" ]]; then echo -e "  ${GREEN}●${NC} $d  ${DIM}until $(cert_expiry "$d")${NC}"
        else echo -e "  ${YELLOW}●${NC} $d  ${DIM}HTTP only (no certificate)${NC}"; fi
      done ;;
    *) die "Usage: neoconfig ssl [list|add <domain>|remove <domain>]" ;;
  esac
}

# ═══════════════════════════ install / migrate ═══════════════════════════

OLD_ENV=""
MIGRATE_DUMP=""

# An earlier Docker-based install keeps its data; move it over once.
migrate_from_docker() {
  [[ -f "$ROOT/docker-compose.yml" ]] || return 0
  warn "Found the previous Docker-based install — moving it to the native setup."
  local stamp; stamp=$(date +%Y%m%d-%H%M%S)
  if command -v docker >/dev/null; then
    MIGRATE_DUMP="/root/neoconfig-docker-$stamp.sql"
    if (cd "$ROOT" && docker compose exec -T db pg_dump -U neoconfig --no-owner --no-privileges neoconfig) > "$MIGRATE_DUMP" 2>/dev/null && [[ -s "$MIGRATE_DUMP" ]]; then
      ok "Database exported to $MIGRATE_DUMP"
    else
      warn "Could not export the old database; starting with an empty one."
      rm -f "$MIGRATE_DUMP"; MIGRATE_DUMP=""
    fi
    (cd "$ROOT" && docker compose down) >/dev/null 2>&1 || true
  fi
  # Keep the old secrets: encrypted panel credentials need the same ENCRYPTION_KEY.
  if [[ -f "$ROOT/.env" ]]; then cp "$ROOT/.env" "/root/neoconfig-docker-$stamp.env"; OLD_ENV="/root/neoconfig-docker-$stamp.env"; fi
  mv "$ROOT" "/opt/neoconfig-docker-$stamp"
  ok "Old install moved to /opt/neoconfig-docker-$stamp (containers stopped, data volume kept)"
}

restore_dump() {
  [[ -n "$MIGRATE_DUMP" && -s "$MIGRATE_DUMP" ]] || return 0
  info "Restoring your data…"
  local url pw
  url=$(env_get DATABASE_URL); pw=$(echo "$url" | sed -E 's#^[^:]+://[^:]+:([^@]+)@.*#\1#')
  PGPASSWORD="$pw" psql -q -h 127.0.0.1 -U neoconfig -d neoconfig -f "$MIGRATE_DUMP" >/dev/null 2>&1 || true
  ok "Data restored"
}

import_old_env() {
  [[ -n "$OLD_ENV" && -f "$OLD_ENV" ]] || return 0
  local line k v
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^([A-Z0-9_]+)=(.*)$ ]] || continue
    k=${BASH_REMATCH[1]}; v=${BASH_REMATCH[2]}
    v=${v%$'\r'}; v=${v#\'}; v=${v%\'}; v=${v#\"}; v=${v%\"}
    case "$k" in DATABASE_URL|API_INTERNAL_URL|NEOCONFIG_TAG|NEOCONFIG_REGISTRY|NEOCONFIG_BUILD_LOCAL|PORT|NODE_ENV|ALLOW_PRIVATE_PANELS) continue ;; esac
    [[ -z "$v" || "$v" == *"'"* ]] && continue
    env_set "$k" "$v"
  done < "$OLD_ENV"
}

check_ports_free() {
  local p who
  for p in 80 443; do
    who=$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -oE 'users:\(\("[^"]+' | head -n1 | cut -d'"' -f2 || true)
    if [[ -n "$who" && "$who" != nginx ]]; then
      die "Port $p is used by '$who'. Stop it first — NeoConfig serves the site with nginx on 80/443."
    fi
  done
}

wait_api() {
  local _
  for _ in $(seq 1 60); do api_healthy && return 0; sleep 2; done
  return 1
}

cmd_install() {
  need_root
  if [[ ! -t 0 ]] && (exec </dev/tty) 2>/dev/null; then exec </dev/tty; fi
  local src; src=$(cd "$(dirname "$(readlink -f "$0")")" && pwd)
  [[ -x "$src/node/bin/node" ]] || die "Run this from an extracted NeoConfig release."
  echo -e "${BOLD}\n  NeoConfig installer${NC}   ${DIM}t.me/neoaurora${NC}\n"

  if [[ -L "$CURRENT" && -f "$ENV_FILE" ]]; then
    warn "NeoConfig is already installed. Use: neoconfig update"
    exit 0
  fi
  migrate_from_docker

  local ip; ip=$(public_ip)
  DOMAIN=${NEOCONFIG_DOMAIN:-}; ACME_EMAIL=${NEOCONFIG_EMAIL:-}
  ADMIN_EMAIL=${NEOCONFIG_ADMIN_EMAIL:-}; ADMIN_PASSWORD=${NEOCONFIG_ADMIN_PASSWORD:-}
  local pre_domain="" pre_email=""
  if [[ -n "$OLD_ENV" ]]; then
    pre_domain=$(ENV_FILE=$OLD_ENV env_get PRIMARY_DOMAIN)
    pre_email=$(ENV_FILE=$OLD_ENV env_get ACME_EMAIL)
  fi
  echo -e "Point your domain's A record to ${BOLD}$ip${NC} (on Cloudflare: DNS only)."
  while :; do
    ask DOMAIN "Main domain (e.g. app.example.com)" "$pre_domain"
    DOMAIN=$(echo "$DOMAIN" | tr 'A-Z' 'a-z'); DOMAIN=${DOMAIN#http*://}; DOMAIN=${DOMAIN%%/*}
    is_domain "$DOMAIN" && break
    warn "Enter a domain name."; DOMAIN=""
  done
  ask ACME_EMAIL "Email for certificate notices" "${pre_email:-admin@${DOMAIN#*.}}"
  local generated=0
  if [[ -z "$OLD_ENV" ]]; then
    ask ADMIN_EMAIL "Admin login email" "admin@$DOMAIN"
    if [[ -z "$ADMIN_PASSWORD" ]]; then
      local p1 p2
      while :; do
        read -r -s -p "$(echo -e "${BOLD}?${NC} Admin password (min 8, empty = generate): ")" p1; echo
        if [[ -z "$p1" ]]; then ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-16); generated=1; break; fi
        if [[ ${#p1} -lt 8 || "$p1" == *"'"* ]]; then warn "At least 8 characters, no single quotes."; continue; fi
        read -r -s -p "$(echo -e "${BOLD}?${NC} Repeat: ")" p2; echo
        [[ "$p1" == "$p2" ]] && { ADMIN_PASSWORD=$p1; break; }
        warn "Passwords do not match."
      done
    fi
  fi

  check_ports_free
  install_packages
  ensure_user

  local tag; tag=$(cat "$src/VERSION")
  mkdir -p "$RELEASES"
  if [[ "$src" != "$RELEASES/$tag" ]]; then rm -rf "${RELEASES:?}/$tag"; cp -a "$src" "$RELEASES/$tag"; fi
  ln -sfn "$RELEASES/$tag" "$CURRENT"
  ln -sfn "$CURRENT/neoconfig" "$CLI"

  import_old_env
  if [[ -z "$(env_get JWT_SECRET)" ]]; then env_set JWT_SECRET "$(openssl rand -hex 32)"; fi
  if [[ -z "$(env_get ENCRYPTION_KEY)" ]]; then env_set ENCRYPTION_KEY "$(openssl rand -hex 32)"; fi
  if [[ -z "$OLD_ENV" ]]; then
    env_set BOOTSTRAP_ADMIN_EMAIL "$ADMIN_EMAIL"
    env_set BOOTSTRAP_ADMIN_PASSWORD "$ADMIN_PASSWORD"
  fi
  [[ -n "$(env_get APP_NAME)" ]] || env_set APP_NAME "NeoConfig"
  [[ -n "$(env_get JWT_EXPIRES_IN)" ]] || env_set JWT_EXPIRES_IN "7d"
  env_set PRIMARY_DOMAIN "$DOMAIN"
  env_set ACME_EMAIL "$ACME_EMAIL"
  env_set PUBLIC_IP "$ip"
  env_set APP_URL "https://$DOMAIN"
  env_set API_URL "https://$DOMAIN"
  [[ -n "$(env_get VAPID_SUBJECT)" ]] || env_set VAPID_SUBJECT "mailto:$ACME_EMAIL"

  setup_database
  chown root:"$SVC_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  restore_dump
  write_units
  write_proxy_snippet
  open_firewall

  info "Starting NeoConfig…"
  systemctl enable --now neoconfig-api >/dev/null 2>&1
  if ! wait_api; then journalctl -u neoconfig-api -n 40 --no-pager || true; die "The API did not start (log above)."; fi
  systemctl enable --now neoconfig-web neoconfig-ssl.path >/dev/null 2>&1
  ok "API and web are running"

  vhost_http "$DOMAIN"; nginx_reload
  info "Requesting the Let's Encrypt certificate for $DOMAIN…"
  local msg ssl_ok=0
  if msg=$(ssl_issue "$DOMAIN"); then ok "$msg"; ssl_ok=1; else warn "$msg"; fi

  local scheme=https; [[ $ssl_ok -eq 1 ]] || scheme=http
  echo
  ok "${BOLD}NeoConfig $tag is installed${NC}"
  echo -e "   App:    ${BOLD}$scheme://$DOMAIN${NC}"
  echo -e "   Admin:  ${BOLD}$scheme://$DOMAIN/admin${NC}"
  [[ $ssl_ok -eq 1 ]] || echo -e "   ${DIM}HTTPS: fix the issue above, then run: neoconfig ssl add $DOMAIN${NC}"
  if [[ -z "$OLD_ENV" ]]; then
    echo -e "   Login:  $ADMIN_EMAIL"
    [[ $generated -eq 1 ]] && echo -e "   Password: ${BOLD}$ADMIN_PASSWORD${NC}  (shown once — change with: neoconfig password)"
  else
    echo -e "   Login:  your existing admin account (data was moved over)"
  fi
  echo -e "\n   Manage: ${BOLD}neoconfig${NC}"
  echo -e "   News & support: ${BOLD}https://t.me/neoaurora${NC}"
}

# ═══════════════════════════ day-to-day ═══════════════════════════

cmd_status() {
  echo -e "${BOLD}NeoConfig${NC} $(version)   ${DIM}$(env_get PRIMARY_DOMAIN)${NC}"
  local s
  for s in neoconfig-api neoconfig-web nginx postgresql neoconfig-ssl.path; do
    if systemctl is-active --quiet "$s"; then echo -e "  ${GREEN}●${NC} $s"
    else echo -e "  ${RED}●${NC} $s  ${DIM}($(systemctl is-active "$s" 2>/dev/null || true))${NC}"; fi
  done
  if api_healthy; then ok "API healthy"; else warn "API not answering on 127.0.0.1:$API_PORT"; fi
  echo -e "${BOLD}Domains${NC}"; cmd_ssl list
}

cmd_logs() {
  local s=${1:-}
  if [[ -z "$s" ]]; then echo "Which? [api/web/nginx/ssl, empty = api+web]"; read -r s; fi
  case "$s" in
    api) journalctl -u neoconfig-api -f -n 200 ;;
    web) journalctl -u neoconfig-web -f -n 200 ;;
    nginx) tail -n 200 -f /var/log/nginx/error.log ;;
    ssl) journalctl -u neoconfig-ssl -f -n 100 ;;
    *) journalctl -u neoconfig-api -u neoconfig-web -f -n 200 ;;
  esac
}

cmd_restart() {
  systemctl restart neoconfig-api
  if wait_api; then ok "API up"; else warn "API not healthy yet — neoconfig logs api"; fi
  systemctl restart neoconfig-web
  nginx_reload || true
  ok "Restarted"
}

cmd_backup() {
  mkdir -p "$BACKUP_DIR"
  local stamp; stamp=$(date +%Y%m%d-%H%M%S)
  local file="$BACKUP_DIR/neoconfig-$stamp.sql.gz"
  runuser -u postgres -- pg_dump neoconfig | gzip > "$file"
  cp "$ENV_FILE" "$BACKUP_DIR/.env.$stamp"
  chmod 600 "$BACKUP_DIR/.env.$stamp" "$file"
  ls -1t "$BACKUP_DIR"/neoconfig-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
  ls -1t "$BACKUP_DIR"/.env.* 2>/dev/null | tail -n +11 | xargs -r rm -f
  [[ "${1:-}" == quiet ]] || ok "Backup saved: $file (keeps the last 10)"
}

switch_to() { # switch_to <release dir>; rolls back on failure
  local prev; prev=$(readlink -f "$CURRENT")
  ln -sfn "$1" "$CURRENT"
  write_units
  systemctl restart neoconfig-api
  if wait_api; then
    systemctl restart neoconfig-web
    return 0
  fi
  warn "The new version did not start — rolling back."
  journalctl -u neoconfig-api -n 20 --no-pager || true
  ln -sfn "$prev" "$CURRENT"; write_units
  systemctl restart neoconfig-api
  if wait_api; then ok "Previous version is running again"; else warn "Previous version is not healthy — neoconfig logs api"; fi
  systemctl restart neoconfig-web
  return 1
}

cmd_update() {
  local tag current dir
  current=$(version)
  tag=${1:-$(latest_tag)}
  [[ -n "$tag" ]] || die "Could not reach GitHub to check for updates."
  if [[ "$tag" == "$current" ]]; then ok "Already on the latest version ($current)"; return; fi
  info "Updating $current → $tag"
  dir=$(fetch_release "$tag")
  cmd_backup quiet
  if switch_to "$dir"; then
    ln -sfn "$CURRENT/neoconfig" "$CLI"
    prune_releases
    ok "Updated to $tag"
  else
    die "Update failed; still on $current."
  fi
}

cmd_rollback() {
  local cur prev
  cur=$(readlink -f "$CURRENT")
  prev=$(ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's#/$##' | while read -r d; do [[ "$(readlink -f "$d")" == "$cur" ]] || echo "$d"; done | head -n1)
  [[ -n "$prev" ]] || die "No previous version to roll back to."
  info "Rolling back to $(basename "$prev")"
  if switch_to "$prev"; then ln -sfn "$CURRENT/neoconfig" "$CLI"; ok "Now running $(version)"; fi
}

cmd_password() {
  local email newEmail p1 p2 out
  read -r -p "Account email (empty = owner): " email
  read -r -p "New login email (empty = keep): " newEmail
  while :; do
    read -r -s -p "New password (min 8): " p1; echo
    if [[ ${#p1} -lt 8 || "$p1" == *"'"* ]]; then warn "At least 8 characters, no single quotes."; continue; fi
    read -r -s -p "Repeat: " p2; echo
    [[ "$p1" == "$p2" ]] && break
    warn "Passwords do not match."
  done
  out=$(cd "$CURRENT/api" && set -a && . "$ENV_FILE" && set +a && printf '%s' "$p1" | TARGET_EMAIL="$email" NEW_EMAIL="$newEmail" runuser -u "$SVC_USER" -m -- "$(node_bin)" dist/cli/reset-password.js 2>&1) || die "${out#ERROR }"
  ok "Password changed for ${out#OK }; existing sessions were signed out."
  if [[ -z "$email" ]]; then
    env_set BOOTSTRAP_ADMIN_PASSWORD "$p1"
    if [[ -n "$newEmail" ]]; then env_set BOOTSTRAP_ADMIN_EMAIL "$newEmail"; fi
  fi
}

cmd_domain() {
  local cur d msg; cur=$(env_get PRIMARY_DOMAIN)
  read -r -p "Main domain [$cur]: " d
  d=$(echo "${d:-$cur}" | tr 'A-Z' 'a-z'); d=${d#http*://}; d=${d%%/*}
  is_domain "$d" || die "Not a domain name."
  if msg=$(ssl_issue "$d"); then ok "$d: $msg"; else warn "$d: $msg"; vhost_http "$d"; nginx_reload; fi
  if [[ -n "$cur" && "$d" != "$cur" ]]; then rm -f "$NGINX_CONF/neoconfig-$cur.conf"; nginx_reload; fi
  env_set PRIMARY_DOMAIN "$d"; env_set APP_URL "https://$d"; env_set API_URL "https://$d"
  systemctl restart neoconfig-api; wait_api || true
  ok "Main domain is now $d"
}

cmd_doctor() {
  local d ip resolved bad=0 code s p
  d=$(env_get PRIMARY_DOMAIN); ip=$(public_ip)
  echo -e "${BOLD}NeoConfig $(version) — checking ${d:-<no domain>}${NC}"
  for s in neoconfig-api neoconfig-web nginx postgresql; do
    if systemctl is-active --quiet "$s"; then ok "$s running"; else warn "$s is not running → systemctl status $s"; bad=1; fi
  done
  if api_healthy; then ok "API answers locally"; else warn "API does not answer → neoconfig logs api"; bad=1; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$WEB_PORT/" || true)
  if [[ "$code" == 200 ]]; then ok "Web app answers locally"; else warn "Web app answered ${code:-nothing} → neoconfig logs web"; bad=1; fi
  if nginx -t >/dev/null 2>&1; then ok "nginx configuration valid"; else warn "nginx configuration has errors → nginx -t"; bad=1; fi

  resolved=$(resolve4 "$d")
  if [[ -z "$resolved" ]]; then warn "DNS: $d has no A record → point it to $ip"; bad=1
  elif [[ " $resolved " == *" $ip "* ]]; then ok "DNS: $d → $ip"
  else warn "DNS: $d → $resolved, but this server is $ip (Cloudflare? use DNS only)"; bad=1; fi

  for p in 80 443; do
    if ss -ltnH "sport = :$p" 2>/dev/null | grep -q .; then ok "Port $p listening"; else warn "Nothing listens on port $p"; bad=1; fi
  done
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    if ufw status | grep -qE "^443(/tcp)?\s+ALLOW"; then ok "ufw allows 443"; else warn "ufw may block 80/443 → ufw allow 80/tcp && ufw allow 443/tcp"; bad=1; fi
  fi
  if [[ -f "$SSL_DIR/$d/fullchain.pem" ]]; then ok "Certificate valid until $(cert_expiry "$d")"
  else warn "No certificate for $d yet → neoconfig ssl add $d"; bad=1; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$d:443:127.0.0.1" "https://$d/api/v1/health" || true)
  if [[ "$code" == 200 ]]; then ok "https://$d is served correctly by this server"
  elif [[ "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$d:443:127.0.0.1" "https://$d/api/v1/health" || true)" == 200 ]]; then
    warn "HTTPS works but the certificate is not trusted → neoconfig ssl add $d"; bad=1
  else warn "HTTPS on this server did not answer (got ${code:-nothing}) → nginx -t, neoconfig logs nginx"; bad=1; fi
  echo
  if [[ $bad -eq 0 ]]; then
    ok "Everything on this server is working."
    echo -e "${DIM}If a browser still cannot open the site, the block is between that network and this server (provider firewall or ISP).${NC}"
  fi
}

cmd_uninstall() {
  warn "This removes NeoConfig from this server."
  local wipe confirm f d
  read -r -p "Delete the database too? [y/N]: " wipe
  read -r -p "Type 'neoconfig' to confirm: " confirm
  [[ "$confirm" == neoconfig ]] || die "Cancelled."
  if [[ ! "$wipe" =~ ^[Yy]$ ]]; then
    cmd_backup quiet
    local keep; keep="/root/neoconfig-backups-$(date +%Y%m%d-%H%M%S)"; cp -r "$BACKUP_DIR" "$keep"
    info "Backup kept in $keep"
  fi
  systemctl disable --now neoconfig-web neoconfig-api neoconfig-ssl.path >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/neoconfig-api.service /etc/systemd/system/neoconfig-web.service \
        /etc/systemd/system/neoconfig-ssl.service /etc/systemd/system/neoconfig-ssl.path
  systemctl daemon-reload
  shopt -s nullglob
  for f in "$NGINX_CONF"/neoconfig-*.conf; do
    d=$(basename "$f" .conf); d=${d#neoconfig-}
    if [[ -x "$ACME" ]]; then "$ACME" --remove -d "$d" --ecc >/dev/null 2>&1 || true; fi
    rm -f "$f"
  done
  rm -f "$PROXY_SNIPPET"; nginx_reload >/dev/null 2>&1 || true
  if [[ "$wipe" =~ ^[Yy]$ ]]; then
    runuser -u postgres -- dropdb --if-exists neoconfig || true
    runuser -u postgres -- psql -qc "DROP ROLE IF EXISTS neoconfig" || true
  fi
  rm -rf "$ROOT" "$QUEUE" "$SSL_DIR" "$WEBROOT" "$CLI"
  userdel "$SVC_USER" >/dev/null 2>&1 || true
  ok "NeoConfig removed. nginx and PostgreSQL stay installed."
}

menu() {
  local c d
  while :; do
    clear || true
    echo -e "${BOLD}  NeoConfig${NC} $(version)   ${DIM}$(env_get PRIMARY_DOMAIN)${NC}"
    echo -e "  ${DIM}t.me/neoaurora · github.com/neoauroraproject/NeoConfig${NC}"
    echo    "  ─────────────────────────────────"
    echo    "   1) Status"
    echo    "   2) Diagnose (domain, SSL, services)"
    echo    "   3) Logs"
    echo    "   4) Restart"
    echo    "   5) Update"
    echo    "   6) Change admin password"
    echo    "   7) Change main domain"
    echo    "   8) Certificates (list / issue)"
    echo    "   9) Back up database"
    echo    "  10) Roll back to previous version"
    echo -e "  11) ${RED}Uninstall${NC}"
    echo    "   0) Exit"
    echo
    read -r -p "  Choose: " c; echo
    case "$c" in
      1) cmd_status ;;
      2) cmd_doctor ;;
      3) cmd_logs ;;
      4) cmd_restart ;;
      5) cmd_update ;;
      6) cmd_password ;;
      7) cmd_domain ;;
      8) cmd_ssl list; read -r -p "Issue/renew a certificate for (empty = skip): " d; if [[ -n "$d" ]]; then cmd_ssl add "$d" || true; fi ;;
      9) cmd_backup ;;
      10) cmd_rollback ;;
      11) cmd_uninstall; exit 0 ;;
      0|q|"") exit 0 ;;
      *) warn "Unknown option" ;;
    esac
    echo; read -r -p "  Press Enter to continue…" _
  done
}

main() {
  local cmd=${1:-}
  [[ $# -gt 0 ]] && shift
  if [[ "$cmd" != install ]]; then
    need_root
    [[ -L "$CURRENT" ]] || die "NeoConfig is not installed. Install: bash <(curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh)"
  fi
  case "$cmd" in
    "") menu ;;
    install) cmd_install "$@" ;;
    status) cmd_status ;;
    doctor) cmd_doctor ;;
    logs) cmd_logs "${1:-}" ;;
    restart) cmd_restart ;;
    update) cmd_update "${1:-}" ;;
    rollback) cmd_rollback ;;
    password) cmd_password ;;
    domain) cmd_domain ;;
    ssl) cmd_ssl "$@" ;;
    ssl-process) cmd_ssl_process ;;
    backup) cmd_backup ;;
    uninstall) cmd_uninstall ;;
    version) version ;;
    *) echo "Usage: neoconfig [status|doctor|logs|restart|update|rollback|password|domain|ssl|backup|uninstall|version]"; exit 1 ;;
  esac
}

main "$@"
