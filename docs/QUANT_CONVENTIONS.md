# Quant conventions

All functions are pure and live in `src/lib/quant/`. Versions are stored with every analysis: indicators, `breakout-v1.0.0`, `score-v1.0.0`.

## Candles

- Only **completed** daily candles are used. Upstox daily candles count as complete after 16:00 IST. A close above resistance on the forming candle sets `intradayCrossPending` but never confirms a breakout.
- Bars are validated before storage: high ≥ max(open, close), low ≤ min(open, close), positive prices, no duplicate timestamps, staleness flagged.

## Indicators (verified against TA-Lib 0.8.2 in `tests/fixtures/talib_reference.json`)

| Indicator | Convention |
|---|---|
| SMA | Arithmetic mean of last n closes |
| EMA | α = 2/(n+1), seeded with the SMA of the first n values |
| RSI(14) | Wilder smoothing |
| MACD(12,26,9) | EMA-based; values converge to TA-Lib after warm-up |
| ATR(14), ADX(14) | Wilder smoothing |
| Bollinger(20,2) | Population standard deviation |
| VWAP(20) | Rolling typical-price × volume over 20 sessions |
| Relative volume | Volume / 20-day average volume (excluding today) |
| Relative strength | 63-session return of stock minus benchmark (NIFTY 50) |

## Breakout stages

Defaults in `DEFAULT_BREAKOUT_CONFIG`: 20-session base, max base depth 12%, approach within 3%, breakout buffer 0.5% above resistance, breakout relative volume ≥ 1.5×, volume and volatility contraction ratios 0.9 and 0.85, retest within 15 sessions and 2% of the level, failure when the close falls 2% below the level.

- **EARLY**: tight base, rising lows, contracting volatility, close within 3% below resistance.
- **CONFIRMED**: completed close > resistance + 0.5% on ≥ 1.5× relative volume, trend and relative strength supportive.
- **RETEST**: broke out within 15 sessions, pulled back to within 2% of the old resistance and is holding it.
- **FAILED**: broke out and closed back below the level by more than the failure buffer. Failed breakouts are rejected.

Each criterion is reported as met / not met / no data (`null`), so the UI can show why a stage was or was not reached.

## Trade plan

- Entry zone: breakout level to level + 2%. Risk is measured from the entry midpoint.
- Stop-loss: max(level − 1.5 × ATR, base low). Invalidation: a close below the stop.
- Targets: entry midpoint + 1.5R and 2.5R; T3 is the larger of 3.5R and the measured move (base height projected from the level). Risk : reward is quoted to **T2**, so it is 2.5 by construction.

## Score (0–100)

| Block | Max | Components |
|---|---|---|
| Fundamental | 40 | revenue growth 5, PAT growth 5, 3y revenue CAGR 4, ROE 6, ROCE 4, D/E 4, interest coverage 4, CFO/PAT 5, promoter pledge 3. Banks/NBFCs replace ROCE, D/E and coverage with ROE and 3y PAT CAGR weightings |
| Technical | 35 | trend alignment 8, 200-DMA slope 3, RSI 4 (55–70 sweet spot), MACD histogram 3, breakout stage 10, relative volume 3, relative strength 4 |
| Catalyst + Global | 15 | net verified catalysts 9, sector global alignment 6 |
| Valuation + Risk | 10 | P/E vs sector median 4, PEG 2, ATR% volatility 4 |

Missing inputs score 0 and lower **coverage** (share of max points with data).

Classification: ≥ 85 Exceptional, ≥ 75 High potential, ≥ 70 Qualified, ≥ 65 Watchlist, otherwise Do not recommend.

### Mandatory rejections (override any score)

| Code | Rule |
|---|---|
| GOVERNANCE_CONCERN | Verified governance issue |
| UNRELIABLE_DATA | Coverage < 70% |
| STALE_DATA | Latest price older than 100 hours |
| INADEQUATE_LIQUIDITY | 20-day average traded value < ₹5 crore |
| SEVERE_TECHNICAL_DETERIORATION | Close < 200-DMA, 50-DMA < 200-DMA and RSI < 35 |
| EXCESSIVE_PROMOTER_PLEDGE | Pledge > 25% |
| FAILED_BREAKOUT | Breakout stage is FAILED |

The database enforces that a REJECTED analysis carries recommendation AVOID.

### Recommendation

Rejected or Do not recommend → AVOID. Watchlist → WATCH. Otherwise by stage: CONFIRMED → BUY_BREAKOUT, RETEST → BUY_ON_RETEST, EARLY → BUY_ON_BREAKOUT, none → WATCH. Claude may explain this but cannot upgrade it.

## Fundamentals

Annual consolidated statements are preferred, standalone otherwise. Mixing bases in one calculation throws `ReportingBasisMismatchError`. Growth is year-on-year; CAGR uses the exact number of years between periods.

## Global impact

`global_market_impact_rules` (23 seeded rules) map an instrument move (e.g. Brent up ≥ 2%) to a sector effect (e.g. Oil Marketing negative) with a confidence weight (low 0.3, medium 0.6, high 1). Sector scores are clamped to −1…+1. Headline sentiment is the average of the six global equity indices. This is a tendency, not a forecast.
