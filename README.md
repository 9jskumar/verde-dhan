# Verde Dhan — AI Stock Intelligence & Global Market Research

A research platform for Indian equities (NSE/BSE) with global indices, forex and commodity context. A deterministic quant engine computes indicators, breakouts and scores from sourced data. Claude explains those results and is checked against them. Scheduled WhatsApp reports deliver the daily view.

**It never places trades, never invents prices, and never treats a score as a probability of profit.**

## Status

| Area | State |
|---|---|
| Quant engine (indicators, breakouts, scoring, risk, global impact) | Built and tested (indicators match TA-Lib) |
| Database schema, RLS, views | Built and tested on local Postgres 16 |
| Web app: all 21 sections, stock detail, login | Built; production build passes; smoke-tested in demo mode |
| Claude research and assistant (with numeric verification) | Built; **pending `ANTHROPIC_API_KEY`** |
| WhatsApp reports and delivery webhooks | Built; **pending Meta credentials, approved templates and recipient opt-in** |
| Angel One (stocks, NIFTY 50 / SENSEX, MCX commodities, currency futures) | Built and unit-tested; **pending the `ANGELONE_*` values and live testing** |
| TradingView charts on Global, Forex, Commodities | Built (display only; not used in scores or reports) |
| Global index numbers for scoring and the 08:00 report | **Pending a data API** (TradingView has none) |
| Brent crude | **Pending** (no MCX contract) |
| News (RSS) | Built; **pending a list of licensed feeds** |
| Supabase project | Created (Mumbai); all migrations applied |
| Deployment to MilesWeb | **Not yet deployed**; guide written |

Nothing marked pending has been tested against the real service.

## Quick start (demo mode)

```bash
npm install
cp .env.example .env.local      # set DEMO_MODE=true, leave the rest empty
npm run dev                      # http://localhost:3000
```

Demo mode uses a fictional universe of twelve companies (symbols start with `DM`), indices that start at 1000 and FX at 1.0. A purple banner is shown on every page. Demo mode never produces news and never simulates portfolios or track records.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (78) |
| `npm run test:db` | Applies all migrations to a throwaway local Postgres and runs RLS and constraint tests |
| `npm run worker` | Long-running scheduler (all jobs, Asia/Kolkata) |
| `npm run job -- <name> [--force]` | Run one job now |
| `npm run job -- preview_reports` | Print WhatsApp report parameters from demo data, no network |

## Documentation

- [Architecture](docs/PROJECT_ARCHITECTURE.md) · [Roadmap and checklist](docs/DEVELOPMENT_ROADMAP.md)
- [Database schema](docs/DATABASE_SCHEMA.md) · [Quant conventions](docs/QUANT_CONVENTIONS.md)
- [API integration plan](docs/API_INTEGRATION_PLAN.md) · [HTTP API](docs/API_DOCUMENTATION.md)
- [Environment variables](docs/ENVIRONMENT_VARIABLES.md) · [Security policy](docs/SECURITY_POLICY.md)
- [WhatsApp templates](docs/WHATSAPP_TEMPLATES.md) · [Testing plan](docs/TESTING_PLAN.md)
- [Deployment guide (MilesWeb)](docs/DEPLOYMENT_GUIDE.md) · [Operations manual](docs/OPERATIONS_MANUAL.md)

## Disclaimer

Verde Dhan is a research tool. Nothing it produces is personalised investment advice. Markets carry risk, including loss of capital.
