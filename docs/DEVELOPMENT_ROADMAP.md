# Development roadmap and implementation checklist

Status as of 2026-10-24. "Built" means implemented with tests where testable offline. "Pending integration" means the code exists but has not run against the real service because credentials or licences are missing.

## Phase 1 — Foundation ✅
- [x] Next.js 16 + TypeScript strict + Tailwind v4 project, light/dark theme, responsive shell, 21-section navigation
- [x] Environment validation, data modes (live / demo / unconfigured), security headers
- [x] Supabase schema (44 tables plus yearly price partitions), RLS, 16 views, seeds; local database test suite

## Phase 2 — Quant engine ✅
- [x] Indicators verified against TA-Lib
- [x] Support/resistance, breakout stages with per-criterion reporting, ATR-based trade plans
- [x] Fundamentals with basis separation; scoring 40/35/15/10 with seven mandatory rejections
- [x] Position sizing, FIFO holdings, drawdown, recommendation outcome evaluation
- [x] Global impact engine with 23 seeded rules

## Phase 3 — Data providers 🟡
- [x] HTTP policy: rate limit, retry, circuit breaker, timeouts, redaction; validation and dedupe
- [x] Demo provider (fictional universe, clearly labelled)
- [ ] Upstox adapter — **built, pending `UPSTOX_ACCESS_TOKEN` and live verification**
- [ ] Upstox daily token refresh automation — **not built**
- [ ] Twelve Data adapter — **built, pending `TWELVEDATA_API_KEY` and live verification**
- [ ] Energy and base-metal futures — **pending licence; no adapter**
- [ ] Fundamentals and corporate announcements vendor — **pending vendor choice; interface only**
- [ ] RSS news — **built, pending licensed feed list**

## Phase 4 — AI layer 🟡
- [x] Evidence packs, prompts, Zod schemas, verification (scores, levels, numbers, wording, staleness)
- [x] Research assistant API and UI with verification
- [ ] Live Claude calls — **pending `ANTHROPIC_API_KEY`**

## Phase 5 — Web application ✅ (demo verified, live pending Supabase)
- [x] Dashboard, Indian/Global/Forex/Commodities, Screener, Breakouts, Fundamentals, Technicals, Top 10, Top 3, Sectors, News, Watchlist, Portfolio, Risk, Performance, Assistant, Notifications, Settings, Admin, stock detail
- [x] Email-link sign-in, session refresh, sign-out
- [ ] Live-mode testing with a real Supabase project — **pending project creation**
- [ ] Price alerts UI (table exists) — not built
- [ ] Backtesting UI (tables exist) — not built

## Phase 6 — Notifications and jobs 🟡
- [x] 14 scheduled jobs, idempotent runner, worker and `/api/cron`
- [x] WhatsApp client, report builders, template definitions, webhook with signature check
- [ ] Meta template approval and recipient opt-in — **pending (owner action)**
- [ ] Live send test — **pending credentials**

## Phase 7 — Deployment ⬜
- [x] Standalone build, MilesWeb guide (VPS and cPanel)
- [ ] Deploy and verify on MilesWeb — **not done**

## Known limitations
- Sector performance uses an equal-weighted average of tracked stocks, not official sector indices.
- The assistant rate limiter is per server instance (in memory).
- Catalyst scoring uses verified catalyst counts; automatic catalyst extraction from announcements is not built.
