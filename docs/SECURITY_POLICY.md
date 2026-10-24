# Security policy

## Secrets

- All credentials are read in `src/lib/env.ts` on the server. Client components never import it. Only the Supabase URL and anon key are public.
- `.env*` files are git-ignored except `.env.example`, which contains no values.
- Logs never print secrets: validation errors list variable names only; outgoing URLs are redacted (`redactUrl`); WhatsApp provider responses are phone-redacted before storage.
- The service-role key is used only by the worker, `/api/cron/*` and the WhatsApp webhook, never during page rendering.

## Authentication and authorisation

- Supabase Auth with passwordless email links. The only personal data collected at sign-in is the email address.
- `proxy.ts` refreshes the session cookie; pages read as the signed-in user, so **RLS applies to every page query**. RLS is never bypassed for user-facing reads.
- Owner-only policies on watchlists, portfolios, transactions, alerts and preferences. Holdings are read-only to users. Operational tables are admin-read only.
- `/api/cron/*` requires a constant-time match of `CRON_SECRET`.
- `/api/webhooks/whatsapp` verifies the Meta HMAC-SHA256 signature over the raw body and drops anything unsigned; the GET handshake compares the verify token in constant time.
- `/api/assistant` requires sign-in in live mode and is rate-limited per user.
- Server actions validate input with Zod, resolve symbols against the tracked universe, and take prices from stored data rather than user input where a price is recorded on the user's behalf.

## AI safety and integrity

- Claude never sees credentials and never calls tools. It receives an evidence pack of computed values.
- Output is parsed against a Zod schema. Then `verify.ts` rejects it if any score differs from the deterministic score, if the recommendation is more bullish than the computed one, if levels are given without a validated plan or differ from it, if any cited evidence id is unknown, if any number in prose does not trace to the evidence, if certainty language is used ("guaranteed", "sure-shot", …), or if the data is stale. Rejected output is not shown.
- User questions to the assistant are wrapped as questions, not instructions, and the same numeric check applies to answers.

## Data integrity

- No synthetic data in live mode. Demo data is fictional (symbols `DM…`), flagged `isDemo` end to end, labelled on every page and prefixed `[DEMO, synthetic data]` in messages. Demo mode is refused in production unless explicitly allowed.
- Recommendation history is immutable (database trigger).
- No automated trading. The app has no broker order endpoints.

## Personal data

- Phone numbers are not stored in notification tables; jobs reference a SHA-256 hash. A user's own WhatsApp number is only stored after explicit consent (`user_consents`).
- Portfolios are the user's own records and visible only to them.

## HTTP hardening

`next.config.ts` sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS; `poweredByHeader` is off.

## Reporting

Report vulnerabilities privately to the project owner. Do not open public issues for security problems.
