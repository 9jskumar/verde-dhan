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
| NSE/BSE quotes and daily candles | `angelone.ts` (SmartAPI: `market/v1/quote`, `historical/v1/getCandleData`) | Built and unit-tested, untested live. Needs the four `ANGELONE_*` values | The app logs in itself (app key, client code, PIN and a TOTP code generated from the TOTP setup key) and re-opens the session every 6 hours or on an invalid-token error. Symbol tokens are looked up once from the published scrip master and stored in `stocks.provider_ids.angelone`. |
| NIFTY 50 / SENSEX | `angelone.ts` (tokens 99926000 NSE, 99919000 BSE) | Built, untested live | |
| Commodities: WTI (MCX CRUDEOIL), gold, silver, natural gas, copper, aluminium, zinc | `angelone.ts` (MCX front-month futures) | Built, untested live | Prices are in INR in the contract's units (gold per 10 g, silver per kg, crude per barrel…) and stored as `FRONT_MONTH_FUTURE` with the contract's expiry. They include the rupee rate, so they are not international spot prices. History is the current contract only, not stitched across rolls. |
| Brent | — | **Pending** | No actively traded MCX contract. The nine Brent impact rules report the instrument as missing rather than using WTI. |
| Forex: USD/INR, EUR/INR, GBP/INR, JPY/INR, EUR/USD, GBP/USD, USD/JPY | `angelone.ts` (NSE currency futures, front month) | Built, untested live | Futures last price, not spot bid/ask. JPY/INR is quoted per 100 yen and converted to per yen. Pairs with no listed contract are left out. |
| Global indices (S&P 500, Nasdaq-100, Dow, FTSE 100, DAX, Nikkei 225) | **Pending** for numbers; TradingView widgets for display | Display built | TradingView has no data API ("We don't have an API that gives access to data", TradingView widget FAQ), so its widgets render in the browser only and never feed scores, AI evidence or reports. The dormant `twelvedata.ts` adapter can be enabled with `GLOBAL_DATA_PROVIDER=twelvedata` if a global data API is chosen later. |
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
