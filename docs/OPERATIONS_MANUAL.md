# Operations manual

## Daily timeline (IST, trading days)

| Time | Job | Output |
|---|---|---|
| every 30 min | `ingest_global_markets` | global indices, FX, gold/silver |
| every 20 min | `ingest_news` | deduplicated headlines |
| 07:40 | `global_impact` | rule-based sector impact (+ Claude narrative if configured) |
| 08:00 | `whatsapp_global_premarket` | enqueues report |
| 08:30 | `whatsapp_india_premarket` | enqueues report |
| 09:00–15:45 every 15 min | `ingest_india_prices`, `exceptional_alerts` | quotes; threshold alerts |
| 15:45 | `compute_analysis` | indicators, breakouts, scores |
| 15:50 | `refresh_views` | materialized views |
| 16:10 | `daily_ranking` | Top 10 / Top 3, recommendation history |
| 16:30 | `whatsapp_daily_close` | enqueues report |
| 18:30 | `recommendation_performance` | outcomes of past calls |
| hourly | `data_quality` | stale data, gaps, provider health |
| every minute | `dispatch_notifications` | sends due WhatsApp jobs, retries failures with backoff |

Holidays come from `market_holidays`. **Load each year's NSE holiday list into that table** (from NSE's published circular) before the year starts; without it, holidays are treated as trading days and jobs run on stale data (the staleness rules will then reject stocks rather than produce false signals).

## Routine checks

- **Admin page**: integrations, last 30 job runs, provider circuits, open data-quality issues.
- `job_runs` with `status = 'FAILED'` in the last day: read `error`, fix, then re-run with `npm run job -- <name> --force` or `POST /api/cron/<name>?force=1`.
- `notification_jobs` stuck in `FAILED` after max retries: check `notification_logs` (provider error code). Common: 131047 (24-hour window, so a template is required), 132000/132018 (template parameter mismatch or formatting), 131026 (recipient not on WhatsApp or not opted in).

## Credentials that expire

| Credential | Lifetime | Action |
|---|---|---|
| Angel One session | refreshed automatically | The app logs in with the PIN and a TOTP code; nothing to do daily. If you change your PIN or reset TOTP, update `ANGELONE_PIN` / `ANGELONE_TOTP_SECRET`. |
| WhatsApp system-user token | permanent unless revoked | Rotate if leaked |
| Anthropic key, Angel One app key | until revoked | Rotate yearly or if leaked |

After changing an environment variable, restart the web process and the worker (`pm2 restart verde-web verde-worker`).

## Incidents

- **Provider outage**: the circuit opens after repeated failures; pages show the last stored values with timestamps. Nothing is synthesised. Reports sent during an outage say "n/a" for missing values.
- **Wrong data from a provider**: mark the rows' `source` in `data_quality_issues`, delete the bad candles, re-run ingestion and `compute_analysis --force`. Recommendation history is immutable by design; add a note in `audit_log` rather than editing it.
- **Leaked secret**: revoke at the provider first, then replace the variable and restart.
- **Stop all WhatsApp messages**: set `WHATSAPP_RECIPIENT_OPTED_IN=false` and restart. Pending jobs are skipped.

## Backups

Supabase takes daily backups on paid plans; enable point-in-time recovery for production. Export `recommendation_history` monthly if the plan has short retention.

## Adding a stock to the universe

Insert into `companies` and `stocks` (with the vendor instrument key in `provider_ids`). The next ingest picks it up; it is scored once it has enough history (200+ sessions for the 200-DMA).
