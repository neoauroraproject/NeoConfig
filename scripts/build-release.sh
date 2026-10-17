#!/usr/bin/env bash
# Builds release/neoconfig-linux-<arch>.tar.xz: Node runtime + compiled API
# (production node_modules, Prisma engines) + Next.js standalone web + CLI.
# Runs on Linux (CI, or any Ubuntu/Debian box). Usage: scripts/build-release.sh [version]
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION=${1:-${VERSION:-$(git describe --tags --always 2>/dev/null || echo dev)}}
case "$(uname -m)" in
  x86_64) ARCH=amd64; NODE_ARCH=x64; ENGINE="debian-openssl-3.0.x" ;;
  aarch64) ARCH=arm64; NODE_ARCH=arm64; ENGINE="linux-arm64-openssl-3.0.x" ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
NODE_VERSION=${NODE_VERSION:-$(node -v | sed 's/^v//')}
OUT=release/neoconfig

echo "==> NeoConfig $VERSION for linux-$ARCH (Node $NODE_VERSION)"
rm -rf release && mkdir -p "$OUT"/{api,web,node/bin}

echo "==> Building"
npm ci --no-audit --no-fund
(cd apps/api && npx prisma generate && npx nest build)
# Same-origin API: the web app talks to /api/v1 through nginx, server-side to 127.0.0.1.
NEXT_PUBLIC_API_URL="" API_INTERNAL_URL="http://127.0.0.1:4000" NEXT_TELEMETRY_DISABLED=1 \
  npm run build --workspace=@neoconfig/web

echo "==> API (production dependencies only)"
cp -r apps/api/dist apps/api/prisma apps/api/package.json "$OUT/api/"
(
  cd "$OUT/api"
  # OpenSSL 3 engines: Ubuntu 22.04+ and Debian 12+ (the installer checks).
  export PRISMA_CLI_BINARY_TARGETS="$ENGINE"
  npm install --omit=dev --no-audit --no-fund --no-package-lock --ignore-scripts=false
  node node_modules/prisma/build/index.js generate
)
# Slim down: keep one query engine (the client's) and the schema engine for
# migrations; drop other platforms, duplicate engines, TypeScript and maps.
M="$OUT/api/node_modules"
find "$M" -type f \( -name 'libquery_engine-*' -o -name 'query_engine-*' -o -name 'schema-engine-*' \) ! -name "*$ENGINE*" -delete
rm -f "$M"/prisma/libquery_engine-* "$M"/@prisma/engines/libquery_engine-*
rm -rf "$M/typescript" "$M"/.cache
find "$M" -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.md' \) -delete

echo "==> Web (Next.js standalone)"
cp -r apps/web/.next/standalone/. "$OUT/web/"
mkdir -p "$OUT/web/apps/web/.next"
cp -r apps/web/.next/static "$OUT/web/apps/web/.next/static"
mkdir -p "$OUT/web/apps/web/public"
cp -r apps/web/public/. "$OUT/web/apps/web/public/"
rm -rf "$OUT/web/apps/web/public/releases"   # legacy agent binaries; not served by installs
rm -f "$OUT"/web/apps/web/.env* "$OUT"/web/.env*
# Build-time only packages that Next's file tracing pulls in.
W="$OUT/web/node_modules"
rm -rf "$W/@img" "$W/sharp" "$W/@esbuild" "$W/esbuild" "$W/typescript" "$W/caniuse-lite"
find "$W" -type f \( -name '*.map' -o -name '*.md' \) -delete

echo "==> Node runtime"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz" \
  | tar -xJ -C "$OUT/node/bin" --strip-components=2 "node-v$NODE_VERSION-linux-$NODE_ARCH/bin/node"

echo "==> CLI"
install -m 0755 neoconfig.sh "$OUT/neoconfig"
echo "$VERSION" > "$OUT/VERSION"

echo "==> Packing"
tar -C release -cf - neoconfig | xz -T0 -6 > "release/neoconfig-linux-$ARCH.tar.xz"
(cd release && sha256sum "neoconfig-linux-$ARCH.tar.xz" > "neoconfig-linux-$ARCH.tar.xz.sha256")
du -sh "$OUT" "release/neoconfig-linux-$ARCH.tar.xz"
