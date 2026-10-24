import { HttpClient, type PolicyOptions } from "./http";
import { dedupeBars } from "./validate";
import {
  type CommoditiesProvider,
  type CommodityQuote,
  DataValidationError,
  type ForexProvider,
  type FxQuote,
  type GlobalIndicesProvider,
  type HistoricalSeries,
  type IndexQuote,
  INSTRUMENT_NAMES,
  ProviderError,
} from "./types";

/**
 * Twelve Data adapter for global indices, forex and commodities.
 *
 * Licensing: Twelve Data's terms distinguish personal and commercial use;
 * index data coverage and real-time vs delayed access depend on the plan.
 * Confirm the plan covers each instrument before enabling it.
 *
 * Instrument identifiers differ between vendors, so internal keys are
 * mapped explicitly here and can be overridden with TWELVEDATA_SYMBOL_MAP.
 * Keys with no mapping are reported as "not configured" rather than guessed.
 */

const BASE = "https://api.twelvedata.com";

/** Defaults are only the identifiers that are unambiguous on Twelve Data. */
export const DEFAULT_TWELVEDATA_SYMBOLS: Record<string, string> = {
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDINR: "USD/INR",
  EURINR: "EUR/INR",
  GBPINR: "GBP/INR",
  JPYINR: "JPY/INR",
  XAU: "XAU/USD",
  XAG: "XAG/USD",
};

const COMMODITY_META: Record<string, { unit: string; contractType: CommodityQuote["contractType"] }> = {
  XAU: { unit: "troy oz", contractType: "SPOT" },
  XAG: { unit: "troy oz", contractType: "SPOT" },
  BRENT: { unit: "bbl", contractType: "CONTINUOUS_FUTURE" },
  WTI: { unit: "bbl", contractType: "CONTINUOUS_FUTURE" },
  NATGAS: { unit: "MMBtu", contractType: "CONTINUOUS_FUTURE" },
  COPPER: { unit: "lb", contractType: "CONTINUOUS_FUTURE" },
  ALUMINIUM: { unit: "tonne", contractType: "CONTINUOUS_FUTURE" },
  ZINC: { unit: "tonne", contractType: "CONTINUOUS_FUTURE" },
};

interface TdQuote {
  symbol?: string;
  name?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  high?: string;
  low?: string;
  close?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  is_market_open?: boolean;
  status?: string;
  code?: number;
  message?: string;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface TwelveDataOptions {
  apiKey: string;
  symbolMap?: Record<string, string>;
  http?: Partial<PolicyOptions>;
}

export class TwelveDataProvider implements GlobalIndicesProvider, ForexProvider, CommoditiesProvider {
  readonly id = "twelvedata";
  private readonly http: HttpClient;
  private readonly symbols: Record<string, string>;

  constructor(private readonly opts: TwelveDataOptions) {
    this.symbols = { ...DEFAULT_TWELVEDATA_SYMBOLS, ...(opts.symbolMap ?? {}) };
    // Free plans allow ~8 requests/minute; paid plans more. Default conservatively.
    this.http = new HttpClient({ provider: this.id, rateLimit: { requests: 8, perMs: 60_000 }, cacheTtlMs: 30_000, ...opts.http });
  }

  vendorSymbol(key: string): string {
    const s = this.symbols[key];
    if (!s) throw new ProviderError(this.id, `no Twelve Data symbol configured for ${key}; set TWELVEDATA_SYMBOL_MAP`);
    return s;
  }

  isConfigured(key: string) {
    return key in this.symbols;
  }

  private async quote(key: string): Promise<TdQuote> {
    const q = await this.http.getJson<TdQuote>(`${BASE}/quote?symbol=${encodeURIComponent(this.vendorSymbol(key))}&apikey=${encodeURIComponent(this.opts.apiKey)}`);
    if (q.status === "error" || num(q.close) === null) {
      throw new DataValidationError(this.id, [`${key}: ${q.message ?? "missing close"}`]);
    }
    return q;
  }

  private meta(q: TdQuote) {
    return {
      timestamp: q.timestamp ? new Date(q.timestamp * 1000).toISOString() : (q.datetime ?? new Date().toISOString()),
      source: this.id,
      isDemo: false,
      // Delay depends on plan; treat as delayed unless the plan is real-time.
      dataDelaySeconds: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Per-instrument failures and unmapped keys from the most recent batch call. */
  lastFailures: { key: string; reason: string }[] = [];

  private async settle<T>(keys: readonly string[], fn: (k: string) => Promise<T>): Promise<T[]> {
    const configured = keys.filter((k) => this.isConfigured(k));
    this.lastFailures = keys.filter((k) => !this.isConfigured(k)).map((key) => ({ key, reason: "symbol not configured" }));
    const results = await Promise.allSettled(configured.map(fn));
    const out: T[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") out.push(r.value);
      else this.lastFailures.push({ key: configured[i]!, reason: (r.reason as Error)?.message ?? "failed" });
    });
    return out;
  }

  getIndexQuotes(keys: readonly string[]): Promise<IndexQuote[]> {
    return this.settle(keys, async (key) => {
      const q = await this.quote(key);
      return {
        ...this.meta(q),
        symbol: key,
        name: INSTRUMENT_NAMES[key] ?? q.name ?? key,
        currency: q.currency ?? "",
        lastValue: num(q.close)!,
        previousClose: num(q.previous_close),
        absoluteChange: num(q.change),
        percentageChange: num(q.percent_change),
        dayHigh: num(q.high),
        dayLow: num(q.low),
        marketStatus: q.is_market_open === undefined ? "UNKNOWN" : q.is_market_open ? "OPEN" : "CLOSED",
      } satisfies IndexQuote;
    });
  }

  getFxQuotes(pairs: readonly string[]): Promise<FxQuote[]> {
    return this.settle(pairs, async (pair) => {
      const q = await this.quote(pair);
      return {
        ...this.meta(q),
        pair,
        bid: null,
        ask: null,
        mid: num(q.close)!,
        previousClose: num(q.previous_close),
        percentageChange: num(q.percent_change),
      } satisfies FxQuote;
    });
  }

  getCommodityQuotes(instruments: readonly string[]): Promise<CommodityQuote[]> {
    return this.settle(instruments, async (instrument) => {
      const q = await this.quote(instrument);
      const meta = COMMODITY_META[instrument] ?? { unit: "unit", contractType: "CONTINUOUS_FUTURE" as const };
      return {
        ...this.meta(q),
        instrument,
        price: num(q.close)!,
        currency: q.currency ?? "USD",
        unit: meta.unit,
        contractType: meta.contractType,
        previousClose: num(q.previous_close),
        percentageChange: num(q.percent_change),
      } satisfies CommodityQuote;
    });
  }

  private async history(key: string, from: string, to: string): Promise<HistoricalSeries> {
    const url = `${BASE}/time_series?symbol=${encodeURIComponent(this.vendorSymbol(key))}&interval=1day&start_date=${from}&end_date=${to}&order=ASC&apikey=${encodeURIComponent(this.opts.apiKey)}`;
    const body = await this.http.getJson<{ status?: string; message?: string; values?: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[] }>(url);
    if (body.status === "error" || !Array.isArray(body.values)) {
      throw new DataValidationError(this.id, [`${key}: ${body.message ?? "missing values"}`]);
    }
    const today = new Date().toISOString().slice(0, 10);
    const bars = dedupeBars(
      body.values.map((v) => ({
        timestamp: v.datetime,
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        adjustedClose: null,
        volume: num(v.volume) ?? 0,
        complete: v.datetime.slice(0, 10) < today,
      })),
    );
    return { symbol: key, interval: "1d", bars, source: this.id, isDemo: false, dataDelaySeconds: 0, fetchedAt: new Date().toISOString() };
  }

  getIndexHistory(symbol: string, from: string, to: string) {
    return this.history(symbol, from, to);
  }
  getFxHistory(pair: string, from: string, to: string) {
    return this.history(pair, from, to);
  }
  getCommodityHistory(instrument: string, from: string, to: string) {
    return this.history(instrument, from, to);
  }
}
