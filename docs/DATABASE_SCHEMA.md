# Database schema

Postgres on Supabase. Seven migrations in `supabase/migrations/`, applied in order. Every table has RLS enabled. Tested by `npm run test:db` (see TESTING_PLAN.md).

## Access model

| Role | Can |
|---|---|
| `anon` | Nothing. All views and tables are revoked from anon. |
| `authenticated` | Read market and research data; full access to **own** watchlists, portfolios, transactions, alerts and preferences; read own holdings. |
| admin (`user_roles.role = 'admin'`, checked by `is_admin()`) | Additionally read job runs, notification jobs and logs, data-quality issues, provider health, audit log. |
| `service_role` (worker and cron only) | Writes ingested data, analyses, notifications. Never used in the browser or in page rendering. |

Views use `security_invoker = true`, so they respect the caller's RLS. Materialized views are granted to `authenticated` only. Partitions of `market_prices` are locked down; access goes through the parent.

## Tables by migration

**0100 foundation** — `profiles`, `user_roles`, `user_preferences` (risk per trade, capital, exchange), `notification_preferences` (per-report toggles; WhatsApp number only after consent), `user_consents`. Functions `has_role()`, `is_admin()`; trigger `handle_new_user` creates a profile.

**0200 market data**
- `companies` (ISIN unique) and `stocks` (one row per listing; unique exchange + symbol; `provider_ids` jsonb maps vendor instrument keys).
- `data_sources` (each row names a provider; `demo` is seeded and flagged).
- `market_holidays` (drives the trading-day calendar; not hard-coded).
- `market_prices` — partitioned by year 2010–2031 plus default. Unique candle (stock, exchange, interval, timestamp). OHLC validity check. `is_complete`, `source`, `data_delay_seconds`.
- `corporate_actions`, `global_instruments` (seeded), `global_indices`, `forex_prices`, `commodity_prices` (`contract_type` separates spot from futures).

**0300 research data**
- `financial_statements` (basis consolidated / standalone kept separate), `shareholding_patterns`, `fundamental_metrics`, `technical_indicators`.
- `market_news` (deduplicated on canonical URL and content fingerprint), `corporate_announcements`.
- `global_market_impact_rules`, `global_impact_snapshots`.
- `stock_analysis` — one per stock per day, with consistency checks (score bounds, REJECTED ⇒ AVOID) and the full analysis JSON.
- `daily_reports`, `recommendation_history` (**immutable**: an update trigger raises), `recommendation_price_history`, `recommendation_outcomes`, `backtest_runs`, `backtest_results`.

**0400 user data, notifications, jobs**
- Owner-only: `watchlists`, `watchlist_stocks`, `portfolios`, `portfolio_transactions`, `portfolio_holdings` (read-only to users), `price_alerts`.
- `whatsapp_templates` (seeded with the four template names), `notification_jobs` (unique `idempotency_key`, `recipient_hash` not the number), `notification_logs` (phone-redacted provider responses), `notification_delivery_status` (from the webhook; unique per message and status).
- `job_runs` (unique `idempotency_key` = `<job>:<window>`), `data_quality_issues`, `provider_health`, `audit_log`.

**0500** seeds 23 global impact rules. The TypeScript copy (`src/lib/quant/impactRules.ts`) is tested to match.

**0600 views**

| View | Purpose |
|---|---|
| `v_stocks` | Listings joined to companies |
| `mv_latest_stock_prices` / `v_latest_stock_prices` | Last complete daily candle with previous close and change % |
| `v_latest_fundamental_metrics` | Latest metrics per company, consolidated preferred |
| `mv_latest_technical_indicators` / `v_latest_technical_indicators` | Latest indicator row per stock |
| `v_stock_quality_scores` | Latest score breakdown |
| `v_global_market_latest`, `v_forex_latest`, `v_commodities_latest` | Latest quote per instrument |
| `v_sector_performance` | Sector average change |
| `v_breakout_candidates` | Early / confirmed / retest stocks not rejected |
| `v_top_10_opportunities`, `v_top_3_opportunities` | From the latest ranking |
| `v_watchlist_performance` | Return since added, per user |
| `v_recommendation_performance` | Outcomes by list, regime and sector |

`refresh_market_views()` (security definer, executable by `service_role` only) refreshes the materialized views concurrently.

**0700 hardening** fixes the Supabase security advisor findings: fixed `search_path` on trigger functions, and no API execute rights for anonymous users on the security-definer helpers. Remaining advisor notes are intentional: price partitions have RLS with no policies (access goes through the parent table), and the two materialized views are readable by signed-in users only.

**0800 data sources** registers `angelone` (enabled) and `twelvedata` (disabled) in `data_sources`. Price tables reference `data_sources(id)`, so a provider's rows are refused until it is listed.

**0900 CFI source** registers `cfi` (CFI Financial MT5) for global index and Brent readings written by the bridge.

## Applying

```bash
supabase link --project-ref <ref>
supabase db push            # applies migrations in order
```

Or paste each file into the SQL editor in order. Then add the first admin:

```sql
insert into public.user_roles (user_id, role) values ('<auth user id>', 'admin');
```
