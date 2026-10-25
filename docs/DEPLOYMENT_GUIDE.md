# Deployment guide (MilesWeb)

The app is a standard Node.js server (Next.js `output: "standalone"`), so it runs on MilesWeb without moving to Vercel. **It has not been deployed yet**; follow and verify each step.

## Requirements

- Node.js **20.9 or newer** (Next.js 16).
- About 1 GB RAM for the build. If the plan is smaller, build locally or in CI and upload the output.
- HTTPS on the domain (MilesWeb provides free SSL).

## Option A: MilesWeb VPS or cloud (recommended)

Runs both the web server and the background worker.

```bash
# on the server
git clone <repo> verde-dhan && cd verde-dhan
npm ci
cp .env.example .env.production   # fill in values (never commit)
npm run build
cp -r .next/static .next/standalone/.next/static   # standalone needs static assets copied in
[ -d public ] && cp -r public .next/standalone/public

npm i -g pm2
set -a; . ./.env.production; set +a        # pm2 captures the current environment
PORT=3000 HOSTNAME=127.0.0.1 pm2 start .next/standalone/server.js --name verde-web
pm2 start npm --name verde-worker -- run worker
pm2 save && pm2 startup
```

Put Nginx (or the panel's proxy) in front of port 3000 with SSL.

## Option B: shared hosting with cPanel "Setup Node.js App"

1. Build locally: `npm ci && npm run build`, then copy `.next/static` (and `public` if present) into `.next/standalone/`.
2. Upload `.next/standalone/` to the app directory.
3. In **Setup Node.js App**: Node 20+, application root = that directory, startup file `server.js`. Add the environment variables in the panel.
4. Shared hosting usually cannot keep a background worker alive. Use **cPanel → Cron Jobs** to call the HTTP endpoints instead:

```
*/15 9-15 * * 1-5  curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/ingest_india_prices
*/30 * * * *       curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/ingest_global_markets
45 15 * * 1-5      … /api/cron/compute_analysis
50 15 * * 1-5      … /api/cron/refresh_views
10 16 * * 1-5      … /api/cron/daily_ranking
0 8 * * 1-5        … /api/cron/whatsapp_global_premarket
30 8 * * 1-5       … /api/cron/whatsapp_india_premarket
30 16 * * 1-5      … /api/cron/whatsapp_daily_close
* * * * *          … /api/cron/dispatch_notifications
```

The full list and cron expressions are in `src/lib/jobs/definitions.ts` and on the Admin page. **Check the server's timezone:** the expressions above are IST. If cron runs in UTC, subtract 5:30 or set `CRON_TZ=Asia/Kolkata` if the panel supports it. Jobs are idempotent per window, so an accidental double call does nothing.

Limitations on shared hosting: per-process memory and CPU caps can kill long jobs, and minute-level cron may not be allowed (then dispatch runs less often and messages go out late).

## CFI Financial bridge (global indices and Brent)

CFI publishes prices through MetaTrader 5, and MT5 can only be read by a program on the same Windows machine as the CFI MT5 terminal. So this part does not run on MilesWeb Linux hosting. Run it on a Windows PC or a Windows VPS that stays on:

1. Install the CFI MT5 terminal and log in. Use the **investor (read-only) password**: it can read prices but cannot trade.
2. Install Python 3.10+ and `pip install -r bridge/cfi_mt5/requirements.txt`.
3. Run `python bridge/cfi_mt5/cfi_mt5_bridge.py --env-file .env.local --list-symbols` and set `CFI_SYMBOL_MAP`. The CFI MT5 names (checked on a live CFI terminal) are `{"SPX":"US500_SPOT","NDX":"US100_Spot","DJI":"US30_SPOT","FTSE":"UK100_SPOT","DAX":"GER30_SPOT","N225":"JPN225_SPOT","BRENT":"BRENT"}`. Note the mixed case in `US100_Spot`.
4. Check with `--dry-run`, then run it for real.
5. Schedule it in Windows Task Scheduler every 15 minutes, or run it with `--loop 900`. The 08:00 IST global report uses whatever was stored last, so the bridge must have run shortly before 07:55 IST.
6. Set `GLOBAL_DATA_PROVIDER=cfi_mt5` on the web server and worker.

## Supabase

1. Create a project (Mumbai region `ap-south-1` keeps latency low for Indian users).
2. Apply migrations (see DATABASE_SCHEMA.md).
3. Auth → URL configuration: Site URL = `https://YOUR_DOMAIN`; add `https://YOUR_DOMAIN/auth/callback` to redirect URLs.
4. Copy URL, anon key and service-role key into the server environment.
5. Insert the first admin role.

## WhatsApp

1. Meta Business Manager: verify the business, add the phone number, create a system user with `whatsapp_business_messaging` permission, generate a permanent token.
2. Submit the templates in WHATSAPP_TEMPLATES.md and wait for approval.
3. Webhook: callback URL `https://YOUR_DOMAIN/api/webhooks/whatsapp`, verify token = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; subscribe to `messages`.
4. Record the recipient's opt-in, then set `WHATSAPP_RECIPIENT_OPTED_IN=true`.

## Verify after deploy

1. `curl https://YOUR_DOMAIN/api/health` → `{"ok":true,"mode":"live"}`.
2. Sign in, open every section.
3. Admin page: every intended integration shows "configured".
4. `curl -X POST -H "Authorization: Bearer …" https://YOUR_DOMAIN/api/cron/data_quality` → `SUCCEEDED`.
5. Only then announce the deployment as working.
