# Testing plan

## What exists and passes today (2026-10-24)

| Suite | Command | Result |
|---|---|---|
| Unit tests (Vitest), 7 files | `npm test` | **78 passed** |
| Type check | `npm run typecheck` | clean |
| Database: all migrations on Postgres 16 + RLS and constraint tests | `npm run test:db` | **ALL DATABASE TESTS PASSED** |
| Production build | `npm run build` | passes, 30 routes |
| Smoke test, demo mode | `next start` + curl every route | all 24 pages 200, unknown stock 404; cron 401 without secret; assistant 503 without key; webhook 503 without config |
| Visual check | Playwright screenshots at 1400px and 390px, light and dark | no console errors, no horizontal page scroll |

### Unit coverage

- **Indicators** against a TA-Lib 0.8.2 reference fixture (`scripts/generate_talib_fixture.py`): SMA, EMA, RSI, MACD, ATR, ADX, Bollinger; plus published StockCharts examples.
- **Breakouts**: synthetic patterns for each stage (early, confirmed, retest, failed, none), intraday-pending handling, trade-plan arithmetic.
- **Fundamentals, scoring, risk, performance**: growth, CAGR, ratios, basis-mismatch error, every rejection rule, score maxima sum to 100, position sizing, FIFO holdings, drawdown, outcome classification.
- **Impact rules**: TypeScript rules equal the SQL seed.
- **Services**: AI verification (scores, levels, invented numbers, banned phrases, unknown evidence), HTTP retry and circuit breaker, RSS parsing and dedupe, WhatsApp parameter sanitising and signatures, IST calendar, assistant evidence and verification.
- **Demo pipeline**: the full research run on the fictional universe gives stable, expected stages and rejections.

### Database coverage

RLS isolation between two users for every owner table; anon has no access; authenticated cannot write market data; admin-only tables hidden from non-admins; immutability of recommendation history; REJECTED ⇒ AVOID; unique candle and idempotency keys; OHLC checks. A mutation test (RLS disabled on `portfolios`) is caught.

## Not yet tested (needs credentials or a deployed environment)

| Area | Test to run once available |
|---|---|
| Angel One | Log in; fetch NIFTY 50, SENSEX and two stocks' daily candles and compare a week of closes with the Angel One app; check the MCX gold/crude and USDINR front-month contracts match the app |
| CFI bridge | `--dry-run` on the Windows machine; compare each value with the CFI MT5 terminal; run for real and check `v_global_market_latest` and `v_commodities_latest` |
| TradingView | Open Global, Forex and Commodities; confirm every widget symbol loads (no "invalid symbol") in light and dark themes |
| Supabase live | Apply migrations to the real project; sign in; create watchlist and portfolio; check RLS with two accounts |
| Jobs | Run each job once with `npm run job -- <name>`; check `job_runs`; re-run to confirm idempotency |
| Claude | Generate narratives for the Top 3; confirm verification accepts good output and logs rejections |
| WhatsApp | Send each approved template to the opted-in number; confirm webhook statuses arrive |
| Deployment | Health check, every page, cron call from the host scheduler |

## Before each release

`npm run typecheck && npm test && npm run test:db && npm run build`, then a demo-mode smoke test.
