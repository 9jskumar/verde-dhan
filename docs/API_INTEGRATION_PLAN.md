# API integration plan

Every provider sits behind an interface in `src/lib/providers/types.ts` and goes through `HttpClient` (`http.ts`): token-bucket rate limiting, retries with exponential backoff and jitter on 429/5xx/network errors, a circuit breaker per provider, request timeouts, and URL redaction in logs. Responses are validated (`validate.ts`) before storage: OHLC sanity, duplicate timestamps, staleness.

## Licensing rules

- **NSE and BSE websites are not scraped.** Their terms prohibit automated access. Indian prices come only from a licensed broker or vendor API.
- Real-time exchange data generally needs an exchange data licence for redistribution. Showing a broker API's data to the account holder for personal research is different from showing it to other users. **Before giving other users access, confirm redistribution rights with the vendor.**
- News is ingested only from feeds whose terms permit it. Headline, short summary and link are stored; full articles are not.
- Every stored value records its `source` and declared delay.

## Providers

| Need | Adapter | Status | Notes |
|---|---|---|---|
| NSE/BSE quotes and daily candles | `upstox.ts` (Upstox API v2: market quotes, historical candles) | Built, untested live. Needs `UPSTOX_ACCESS_TOKEN` | Upstox access tokens expire daily; an automated token refresh flow is **pending**. Instrument keys go in `stocks.provider_ids`. |
| NIFTY 50 / SENSEX | Upstox index instruments | Built, untested live | |
| Global indices | `twelvedata.ts` | Built, untested live. Needs `TWELVEDATA_API_KEY` | Index symbols depend on plan, so they are not guessed: set `TWELVEDATA_SYMBOL_MAP`. |
| Forex | `twelvedata.ts` | Built, untested live | Defaults: EUR/USD, GBP/USD, USD/JPY, USD/INR, EUR/INR, GBP/INR, JPY/INR |
| Gold, silver | `twelvedata.ts` (XAU/USD, XAG/USD spot) | Built, untested live | |
| Brent, WTI, natural gas, copper, aluminium, zinc | — | **Pending licence and adapter** | Futures data needs an exchange or vendor licence (e.g. MCX via a licensed vendor, or ICE/CME). Shown as unavailable until then. |
| Fundamentals (statements, shareholding) | Interface only | **Pending vendor choice** | Candidates: a licensed fundamentals vendor, or manual import of filings from exchange disclosure services where the terms allow. |
| Corporate announcements | Interface only | **Pending vendor** | |
| News | `news.ts` (RSS) | Built, tested offline | Configure `NEWS_RSS_FEEDS` with feeds you are allowed to use. |
| AI | Anthropic Messages API | Built, untested live. Needs `ANTHROPIC_API_KEY` | Structured output, adaptive thinking, server-side fallback. |
| Messaging | WhatsApp Cloud API (Graph API) | Built, untested live | See WHATSAPP_TEMPLATES.md. |

## Adding a provider

1. Implement the relevant interface (`MarketDataProvider`, `GlobalIndicesProvider`, …) returning `Provenance` on every record.
2. Use `HttpClient` with the vendor's documented rate limit.
3. Register it in `registry.ts` behind an env switch.
4. Add an offline test with a recorded (sanitised) response shape.

## Freshness and fallback

- A quote older than its expected interval is flagged stale and not used for scoring (stale price data rejects a stock after 100 hours).
- If a provider's circuit is open, the job records the failure in `provider_health` and moves on. **There is no fallback to synthetic data in live mode.** Pages show the last stored value with its timestamp, or nothing.
