# Environment variables

Parsed and validated in `src/lib/env.ts`. All are optional so the app starts without credentials; each missing group shows as "pending integration". Invalid values stop startup with the **names** of the bad variables (never values). Template: [`.env.example`](../.env.example).

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are safe to expose to browsers (RLS protects the data). Everything else is server-only.

| Variable | Required for | Notes |
|---|---|---|
| `NODE_ENV` | — | `production` on the server |
| `APP_URL` | links in messages | Public base URL |
| `DEMO_MODE` | demo | `true` to use the synthetic universe when Supabase is not configured |
| `ALLOW_DEMO_IN_PRODUCTION` | demo on a server | Must be `true` for demo mode to work with `NODE_ENV=production`. Leave `false` for real deployments. |
| `NEXT_PUBLIC_SUPABASE_URL` | live mode | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | live mode | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | jobs, worker, cron, webhook | **Bypasses RLS.** Server only. Never in client code. |
| `ANTHROPIC_API_KEY` | AI narratives, assistant | |
| `ANTHROPIC_MODEL` | | Default `claude-opus-5-5` |
| `ANTHROPIC_EFFORT` | | `low`…`max`, default `high` |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp | System-user permanent token from Meta Business Manager |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp | Sending number's ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WhatsApp | WABA ID |
| `WHATSAPP_API_VERSION` | | Default `v23.0`; check Meta's current version |
| `WHATSAPP_RECIPIENT` | WhatsApp | Primary recipient, E.164 (e.g. `+91…`) |
| `WHATSAPP_RECIPIENT_OPTED_IN` | WhatsApp | `true` only after the recipient's opt-in is recorded. Nothing is enqueued otherwise. |
| `WHATSAPP_APP_SECRET` | delivery webhook | Verifies `X-Hub-Signature-256` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | delivery webhook | Random string, also entered in Meta's webhook settings |
| `INDIA_MARKET_PROVIDER` | Indian prices, MCX, currency futures | `angelone` or `none` |
| `ANGELONE_API_KEY` | Angel One | App key from the SmartAPI developer portal |
| `ANGELONE_CLIENT_CODE` | Angel One | Angel One client ID |
| `ANGELONE_PIN` | Angel One | Login PIN (MPIN). Secret. |
| `ANGELONE_TOTP_SECRET` | Angel One | TOTP setup key from smartapi.angelone.in/enable-totp. Secret: anyone with it and the PIN can log in. |
| `GLOBAL_MARKET_PROVIDER` | Global, Forex, Commodities pages | `tradingview` (default; browser widgets, display only) or `none` |
| `GLOBAL_DATA_PROVIDER` | global index numbers | `twelvedata` or `none` (default). Not in use. |
| `TWELVEDATA_API_KEY`, `TWELVEDATA_SYMBOL_MAP` | | Only with `GLOBAL_DATA_PROVIDER=twelvedata` |
| `NEWS_RSS_FEEDS` | news | Comma-separated RSS URLs you are licensed to use |
| `CRON_SECRET` | `/api/cron/*` | Long random string; sent as `Authorization: Bearer …` |
| `NOTIFICATION_TIMEZONE` | | Default `Asia/Kolkata` |

Generate secrets with `openssl rand -hex 32`.
