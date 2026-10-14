# NeoConfig deployment

## Quick start (Docker)

1. Copy `.env.example` to `.env` and set `JWT_SECRET`, `ENCRYPTION_KEY`, and bootstrap admin credentials.
2. `docker compose up -d --build`
3. Open `http://localhost:3000`
4. Sign in with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (created on first API boot) or register a new org.

API docs: `http://localhost:4000/api/docs`

## One-line Linux agent install

From **Admin → Server agent**, generate an enrollment command:

```bash
curl -fsSL https://APP_DOMAIN/install.sh -o /tmp/NeoConfig-install.sh && sudo bash /tmp/NeoConfig-install.sh --token 'ONE_TIME_TOKEN'
```

The installer downloads a static Go binary, redeems the single-use token, writes `/etc/neoconfig/agent.yaml`, and enables a systemd unit. It does **not** install or modify 3x-ui/Xray.

For production, set `NEOCONFIG_AGENT_SHA256` so the installer verifies the binary checksum before install.

Build agent binaries:

```bash
cd agent
GOOS=linux GOARCH=amd64 go build -o ../dist/releases/1.0.0/neoconfig-agent-linux-amd64 ./cmd/agent
GOOS=linux GOARCH=arm64 go build -o ../dist/releases/1.0.0/neoconfig-agent-linux-arm64 ./cmd/agent
```

Serve `dist/releases/...` from the app origin at `/releases/1.0.0/`.

## Local development

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run db:generate
npm run prisma:migrate:dev --workspace=@NeoConfig/api
npm run dev:api
npm run dev:web
```

## Security notes

- Panel API tokens and subscription URLs are encrypted at rest with `ENCRYPTION_KEY`.
- Browser never receives panel admin credentials.
- Subscription URL fetches enforce SSRF protections (no private IPs, no redirects).
- Agent credentials are hashed; enrollment tokens are single-use and short-lived.
