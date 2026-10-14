# 3x-ui API mapping (from docs/api310.json)

Source of truth: OpenAPI 3.0.3 title **3X-UI Panel API** version **3.x**.

## Authentication

- Bearer: `Authorization: Bearer <token>` from Settings → Security → API Token
- Cookie: `POST /login` with `{ username, password, twoFactorCode? }` → cookie `3x-ui`

## Endpoints used by NeoConfig

| Internal need | Documented operation |
|---|---|
| Connectivity test | `GET /panel/api/server/status` |
| Client metadata | `GET /panel/api/clients/get/{email}` |
| Traffic counters | `GET /panel/api/clients/traffic/{email}` → `ClientTraffic` |
| Match subId | `GET /panel/api/clients/list` |
| Protocol URLs | `GET /panel/api/clients/subLinks/{subId}` |
| Renewal calendar preview | `POST /panel/api/clients/renewalPreview` |
| Public subscription info | `GET /{subPath}{subid}?format=info` |
| Public metadata headers | `HEAD /{subPath}{subid}` |

## ClientTraffic → NormalizedSubscription

| API field | Internal field | Notes |
|---|---|---|
| `up` | `uploadBytes` | int64 bytes |
| `down` | `downloadBytes` | int64 bytes |
| `up+down` | `totalUsedBytes` | computed |
| `total` | `quotaBytes` / `quotaKind` | `0` → unlimited |
| `total - used` | `remainingBytes` | only when quota known |
| `expiryTime` | `expiryAt` / `expiryKind` | ms; `0` → none; negative → unknown (first-use) |
| `enable` | `enabled` + status | false → disabled |
| `subId` / `email` | `subscriptionId` / display name | |

## Explicit unknowns

If a field is absent or untrusted, NeoConfig exposes `unknown` rather than inventing zeros or 100% usage.
