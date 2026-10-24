import { HttpClient, type PolicyOptions } from "./http";
import { dedupeBars } from "./validate";
import {
  DataValidationError,
  type HistoricalSeries,
  type MarketDataProvider,
  type MarketQuote,
  ProviderError,
} from "./types";

/**
 * Upstox (broker market-data API v2) adapter for NSE/BSE equities.
 *
 * Licensing: Upstox market data is provided to account holders under the
 * Upstox API terms; redistribution to third parties generally requires an
 * exchange data-vending licence. Confirm your use case with Upstox before
 * exposing data to anyone other than the account holder. See
 * docs/API_INTEGRATION_PLAN.md.
 *
 * Endpoint shapes follow Upstox's published v2 docs (market-quote/quotes and
 * historical-candle). Verify against the current docs when you obtain
 * credentials; the parsing below fails loudly (DataValidationError) rather
 * than guessing if the payload differs.
 *
 * Symbols are resolved to Upstox instrument keys ("NSE_EQ|<ISIN>") through
 * the `stocks.provider_ids.upstox` column or the resolver passed in.
 */

const BASE = "https://api.upstox.com/v2";

export interface UpstoxOptions {
  accessToken: string;
  resolveInstrumentKey: (symbol: string, exchange: "NSE" | "BSE") => Promise<string | null>;
  http?: Partial<PolicyOptions>;
}

type Candle = [string, number, number, number, number, number, number?];

/**
 * A daily candle is final once the session has closed. NSE/BSE close at
 * 15:30 IST; we wait until 16:00 IST to allow for closing-auction prints.
 */
export function isDailyCandleComplete(candleDate: string, now = new Date()): boolean {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const today = ist.toISOString().slice(0, 10);
  const day = candleDate.slice(0, 10);
  return day < today || (day === today && ist.getUTCHours() >= 16);
}

export class UpstoxProvider implements MarketDataProvider {
  readonly id = "upstox";
  private readonly http: HttpClient;

  constructor(private readonly opts: UpstoxOptions) {
    // Upstox documents per-second and per-minute limits; stay well inside them.
    this.http = new HttpClient({ provider: this.id, rateLimit: { requests: 20, perMs: 1000 }, ...opts.http });
  }

  private headers() {
    return { Authorization: `Bearer ${this.opts.accessToken}`, "Api-Version": "2.0" };
  }

  private async key(symbol: string, exchange: "NSE" | "BSE") {
    const k = await this.opts.resolveInstrumentKey(symbol, exchange);
    if (!k) throw new ProviderError(this.id, `no instrument key mapped for ${exchange}:${symbol}`);
    return k;
  }

  async getQuote(symbol: string, exchange: "NSE" | "BSE" = "NSE"): Promise<MarketQuote> {
    const key = await this.key(symbol, exchange);
    const body = await this.http.getJson<{ status: string; data?: Record<string, UpstoxQuote> }>(
      `${BASE}/market-quote/quotes?instrument_key=${encodeURIComponent(key)}`,
      this.headers(),
    );
    const q = body.data ? Object.values(body.data)[0] : undefined;
    if (body.status !== "success" || !q || typeof q.last_price !== "number") {
      throw new DataValidationError(this.id, [`unexpected quote payload for ${symbol}`]);
    }
    const prev = q.ohlc && typeof q.net_change === "number" ? q.last_price - q.net_change : null;
    return {
      symbol,
      exchange,
      timestamp: q.timestamp ?? new Date().toISOString(),
      lastPrice: q.last_price,
      open: q.ohlc?.open ?? null,
      high: q.ohlc?.high ?? null,
      low: q.ohlc?.low ?? null,
      previousClose: prev,
      changePct: prev && prev > 0 ? ((q.last_price - prev) / prev) * 100 : null,
      volume: q.volume ?? null,
      source: this.id,
      isDemo: false,
      dataDelaySeconds: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getHistoricalPrices(symbol: string, from: string, to: string, exchange: "NSE" | "BSE" = "NSE"): Promise<HistoricalSeries> {
    const key = await this.key(symbol, exchange);
    const url = `${BASE}/historical-candle/${encodeURIComponent(key)}/day/${to}/${from}`;
    const body = await this.http.getJson<{ status: string; data?: { candles?: Candle[] } }>(url, this.headers());
    const candles = body.data?.candles;
    if (body.status !== "success" || !Array.isArray(candles)) {
      throw new DataValidationError(this.id, [`unexpected historical payload for ${symbol}`]);
    }
    const bars = dedupeBars(
      candles.map((c) => ({
        timestamp: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        // Upstox candles are not split-adjusted; adjustment is applied from
        // corporate_actions by the ingestion job.
        adjustedClose: null,
        volume: c[5],
        // The current session's candle is still forming until after close.
        complete: isDailyCandleComplete(c[0]),
      })),
    );
    return { symbol, interval: "1d", bars, source: this.id, isDemo: false, dataDelaySeconds: 0, fetchedAt: new Date().toISOString() };
  }
}

interface UpstoxQuote {
  last_price: number;
  timestamp?: string;
  volume?: number;
  net_change?: number;
  ohlc?: { open: number; high: number; low: number; close: number };
}
