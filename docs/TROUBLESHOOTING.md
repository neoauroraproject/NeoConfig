# Troubleshooting

## API will not start

- Ensure `DATABASE_URL` points to a running PostgreSQL instance.
- Run `npm run db:generate` then `npx prisma migrate deploy` inside `apps/api`.
- Confirm `JWT_SECRET` and `ENCRYPTION_KEY` are set (see `.env.example`).

## Subscription shows Unknown quota / expiry

- The link may be a single connection URI without subscription metadata.
- Prefer a full subscription URL that supports `?format=info` or `subscription-userinfo` headers.
- Or register the 3x-ui panel in Admin and ensure the client's `subId` matches.

## Panel test fails

- `baseUrl` must include the panel web base path (example from OpenAPI servers: `/R8JJdluxTpdzcdkywn`).
- Prefer an API token from Settings → Security → API Token.
- The backend does not follow redirects and blocks private IPs.

## Agent install

- Review `install.sh` before running with sudo.
- Token is single-use and expires (default 30 minutes).
- Pin checksum with `NeoConfig_AGENT_SHA256` in production.
- Host agent binaries at `/releases/1.0.0/neoconfig-agent-linux-amd64`.

## PWA install

- Requires HTTPS (or localhost).
- iOS: Share → Add to Home Screen.
- Changing branding does not automatically rewrite an already-installed PWA identity; reinstall after icon/name changes.
