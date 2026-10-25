# Project architecture

## Principles

1. **Numbers come from code, words come from Claude.** Every price, indicator, score, level and ratio is computed deterministically from stored, sourced data. Claude receives an evidence pack and writes explanation; its output is schema-validated and every number in it must trace back to the pack, or it is discarded.
2. **No data is better than wrong data.** A missing input is `null` and shown as "n/a". It lowers data coverage and can reject a stock. It is never filled with an estimate.
3. **Every record carries provenance**: `source`, `isDemo`, `dataDelaySeconds`, timestamps.
4. **Providers are replaceable.** The app depends on interfaces, not vendors.
5. **Risk flags beat scores.** Mandatory rejections apply after scoring and cannot be outweighed.

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js 16 (App Router, server components, `proxy.ts`), React 19, TypeScript strict |
| UI | Tailwind CSS v4, shadcn-style primitives (`src/components/ui.tsx`), Recharts, lucide icons, next-themes |
| Client state and forms | TanStack Query, React Hook Form + Zod |
| Data | Supabase Postgres with RLS, Supabase Auth (email link) |
| AI | Anthropic SDK, `claude-opus-5-5`, adaptive thinking, structured output via Zod |
| Messaging | WhatsApp Business Cloud API (template messages) |
| Scheduling | `worker/index.ts` (croner) or host cron calling `/api/cron/<job>` |

## Layout

```
src/
  app/(app)/…            21 sections + /stocks/[symbol]; server components read through the repository
  app/api/…              cron, assistant, whatsapp webhook, health
  app/login, auth/…      email sign-in, callback, sign-out
  proxy.ts               refreshes Supabase session cookies
  components/            UI primitives, charts, research and market widgets, forms
  lib/quant/             pure functions: indicators, levels, breakout, fundamentals, scoring, risk, globalImpact, performance
  lib/analysis/          pipeline: bars + statements → StockAnalysis
  lib/providers/         adapters (Angel One, Twelve Data (dormant), RSS, Demo), HTTP policy (rate limit, retry, circuit breaker), validation
  lib/ai/                evidence packs, prompts, Claude calls, verification
  lib/whatsapp/          Cloud API client, report builders, webhook verification
  lib/jobs/              job definitions, idempotent runner, task handlers, IST calendar
  lib/data/              repository (live / demo / unconfigured), server actions
  lib/supabase/          user client (RLS), admin client (jobs only), browser client (auth only)
supabase/migrations/     schema, RLS, seeds, views
supabase/tests/          database test suite
worker/                  scheduler and one-off job runner
```

## Data flow

```
Licensed providers ──► ingest jobs ──► validate (OHLC, staleness, dedupe) ──► Postgres (partitioned prices)
                                                                               │
          compute_analysis (15:45 IST) ◄───────────────────────────────────────┘
          │ indicators → breakout stage → fundamentals → score → rejections → recommendation
          ▼
   stock_analysis  ──► daily_ranking ──► recommendation_history (immutable)
          │                                   │
          ├──► Claude (evidence pack) ──► verify ──► stored narrative or discarded
          ▼
   Web pages (RLS)           WhatsApp jobs ──► notification_jobs ──► dispatcher ──► Meta ──► webhook statuses
```

## Data modes

`src/lib/data/repository.ts` picks one mode per request:

- **live** — Supabase is configured. Pages read stored data as the signed-in user, so RLS applies.
- **demo** — `DEMO_MODE=true` and no Supabase. The real pipeline runs over a fictional universe. Refused in production unless `ALLOW_DEMO_IN_PRODUCTION=true`.
- **unconfigured** — neither. Pages show "pending integration" panels and no numbers.

## Scoring model (summary)

Fundamental 40, Technical 35, Catalyst 9 + Global 6, Valuation 6 + Risk 4. Bands: ≥85 Exceptional, ≥75 High potential, ≥70 Qualified, ≥65 Watchlist, else Do not recommend. Seven mandatory rejections override any score. Details in [QUANT_CONVENTIONS.md](QUANT_CONVENTIONS.md).
