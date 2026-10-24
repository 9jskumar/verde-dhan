# HTTP API

All endpoints are Next.js route handlers under `src/app/api` and `src/app/auth`. Responses are JSON unless noted. No endpoint returns secrets.

## `GET /api/health`

Public liveness check.

```json
{ "ok": true, "mode": "live" | "demo" | "unconfigured", "time": "2026-10-24T10:00:00.000Z" }
```

## `POST /api/cron/{job}`

Runs one scheduled job. For host cron when the worker is not used.

- Header: `Authorization: Bearer <CRON_SECRET>` (constant-time compare). Missing or wrong → `401`.
- `{job}`: one of `ingest_india_prices`, `ingest_global_markets`, `ingest_news`, `compute_analysis`, `global_impact`, `daily_ranking`, `whatsapp_global_premarket`, `whatsapp_india_premarket`, `whatsapp_daily_close`, `exceptional_alerts`, `dispatch_notifications`, `recommendation_performance`, `data_quality`, `refresh_views`. Unknown → `404`.
- Query `?force=1` bypasses the idempotency window (manual re-runs only).
- `503` with `status: "pending_integration"` when the service-role key is missing.

Response (`200`, or `500` when the job failed):

```json
{ "job": "daily_ranking", "key": "daily_ranking:2026-10-23", "status": "SUCCEEDED" | "SKIPPED" | "FAILED", "reason": "…", "metrics": {}, "error": "…" }
```

A second call in the same window returns `SKIPPED` with a reason such as `window already succeeded`. Non-trading days return `SKIPPED` for trading-day jobs.

## `POST /api/assistant`

Ask the research assistant. Signed-in users only in live mode; 6 requests per minute per user.

Request: `{ "question": "3–1000 chars", "symbol": "optional NSE symbol" }`

| Status | Meaning |
|---|---|
| 200 `status: "ok"` | `answer: { answer, evidenceIds, insufficientData, followUps }`, `evidence` (cited items), `isDemo`, `model` |
| 400 | invalid body |
| 401 | not signed in |
| 404 | symbol not in the analysed universe |
| 409 | no research stored yet |
| 422 `status: "rejected"` | Claude's answer failed schema or numeric verification and was withheld; `issues` lists why |
| 429 | rate limited |
| 503 `status: "pending_integration"` | `ANTHROPIC_API_KEY` missing |

## `GET /api/webhooks/whatsapp`

Meta subscription handshake: returns `hub.challenge` as text when `hub.mode=subscribe` and `hub.verify_token` matches; `403` otherwise; `503` if not configured.

## `POST /api/webhooks/whatsapp`

Delivery status callbacks. Requires a valid `X-Hub-Signature-256` over the raw body (`401` otherwise). Stores `sent`/`delivered`/`read`/`failed` statuses in `notification_delivery_status` (idempotent per message and status). Returns `{ "received": n }`; `500` if storage failed so Meta retries.

## Auth routes

- `GET /auth/callback?code=…` — completes the email-link sign-in, redirects to `/` (or `/login?error=link`).
- `POST /auth/signout` — ends the session, redirects to `/login` (303).

## Server actions (forms, not public HTTP)

`createWatchlist`, `addToWatchlist`, `removeFromWatchlist`, `createPortfolio`, `recordTransaction`, `savePreferences`, `saveNotificationPreferences` in `src/lib/data/actions.ts`. All run as the signed-in user under RLS and validate input with Zod.
