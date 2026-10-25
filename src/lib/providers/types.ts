/**
 * Provider-independent market data contracts (Part 7).
 *
 * Every adapter normalises vendor payloads into these shapes and tags each
 * record with its source, delay and fetch time. Nothing downstream ever
 * talks to a vendor format directly, so a vendor can be swapped through
 * configuration alone.
 */

export interface Provenance {
  source: string;
  /** true only for the synthetic demo generator. */
  isDemo: boolean;
  /** Vendor-declared delay (0 = real-time). */
  dataDelaySeconds: number;
  fetchedAt: string;
}

export interface MarketQuote extends Provenance {
  symbol: string;
  exchange: "NSE" | "BSE";
  timestamp: string;
  lastPrice: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  changePct: number | null;
  volume: number | null;
}

export interface HistoricalPrice {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number | null;
  volume: number;
  /** false for the current, still-forming session. */
  complete: boolean;
}

export interface HistoricalSeries extends Provenance {
  symbol: string;
  interval: "1d";
  bars: HistoricalPrice[];
}

export type MarketStatus = "PRE_OPEN" | "OPEN" | "CLOSED" | "HOLIDAY" | "UNKNOWN";

export interface IndexQuote extends Provenance {
  /** Internal canonical key, e.g. SPX, NDX, DJI, FTSE, DAX, N225, NIFTY50, SENSEX. */
  symbol: string;
  name: string;
  currency: string;
  timestamp: string;
  lastValue: number;
  previousClose: number | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  marketStatus: MarketStatus;
}

export interface FxQuote extends Provenance {
  pair: string; // EURUSD, USDINR…
  timestamp: string;
  bid: number | null;
  ask: number | null;
  mid: number;
  previousClose: number | null;
  percentageChange: number | null;
}

export interface CommodityQuote extends Provenance {
  instrument: string; // BRENT, WTI, XAU, XAG, NATGAS, COPPER, ALUMINIUM, ZINC
  timestamp: string;
  price: number;
  currency: string;
  unit: string;
  /** Spot and futures are never conflated. */
  contractType: "SPOT" | "FRONT_MONTH_FUTURE" | "CONTINUOUS_FUTURE";
  /** Expiry date (YYYY-MM-DD) of the contract quoted; required for FRONT_MONTH_FUTURE. */
  contractMonth?: string | null;
  previousClose: number | null;
  percentageChange: number | null;
}

export interface NewsItem extends Provenance {
  headline: string;
  summary: string | null;
  url: string;
  publisher: string;
  publishedAt: string;
  country: string | null;
}

export interface CorporateAnnouncement extends Provenance {
  symbol: string;
  exchange: "NSE" | "BSE";
  announcementType: string;
  headline: string;
  description: string | null;
  url: string;
  announcedAt: string;
}

export interface MarketDataProvider {
  readonly id: string;
  getQuote(symbol: string, exchange?: "NSE" | "BSE"): Promise<MarketQuote>;
  getHistoricalPrices(symbol: string, from: string, to: string, exchange?: "NSE" | "BSE"): Promise<HistoricalSeries>;
}

export interface FundamentalsProvider {
  readonly id: string;
  /** Raw statements; calculations happen in lib/quant/fundamentals.ts. */
  getFinancialStatements(isin: string): Promise<unknown[]>;
}

export interface GlobalIndicesProvider {
  readonly id: string;
  getIndexQuotes(symbols: readonly string[]): Promise<IndexQuote[]>;
  getIndexHistory(symbol: string, from: string, to: string): Promise<HistoricalSeries>;
}

export interface ForexProvider {
  readonly id: string;
  getFxQuotes(pairs: readonly string[]): Promise<FxQuote[]>;
  getFxHistory(pair: string, from: string, to: string): Promise<HistoricalSeries>;
}

export interface CommoditiesProvider {
  readonly id: string;
  getCommodityQuotes(instruments: readonly string[]): Promise<CommodityQuote[]>;
  getCommodityHistory(instrument: string, from: string, to: string): Promise<HistoricalSeries>;
}

export interface NewsProvider {
  readonly id: string;
  getLatestNews(opts?: { since?: string; limit?: number }): Promise<NewsItem[]>;
}

export interface CorporateAnnouncementsProvider {
  readonly id: string;
  getAnnouncements(opts?: { since?: string; symbols?: string[] }): Promise<CorporateAnnouncement[]>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(
    public readonly capability: string,
    public readonly requiredEnv: string[],
  ) {
    super(`${capability}: no provider configured (set ${requiredEnv.join(", ")})`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

export class DataValidationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly issues: string[],
  ) {
    super(`[${provider}] invalid data: ${issues.slice(0, 5).join("; ")}`);
    this.name = "DataValidationError";
  }
}

export const GLOBAL_INDEX_KEYS = ["SPX", "NDX", "DJI", "FTSE", "DAX", "N225"] as const;
export const INDIA_INDEX_KEYS = ["NIFTY50", "SENSEX"] as const;
export const FX_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDINR", "EURINR", "GBPINR", "JPYINR"] as const;
export const COMMODITY_KEYS = ["BRENT", "WTI", "XAU", "XAG", "NATGAS", "COPPER", "ALUMINIUM", "ZINC"] as const;

export const INSTRUMENT_NAMES: Record<string, string> = {
  NIFTY50: "NIFTY 50",
  SENSEX: "SENSEX",
  SPX: "S&P 500",
  NDX: "Nasdaq-100",
  DJI: "Dow Jones",
  FTSE: "FTSE 100",
  DAX: "DAX",
  N225: "Nikkei 225",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDINR: "USD/INR",
  EURINR: "EUR/INR",
  GBPINR: "GBP/INR",
  JPYINR: "JPY/INR",
  BRENT: "Brent crude",
  WTI: "WTI crude",
  XAU: "Gold (spot)",
  XAG: "Silver (spot)",
  NATGAS: "Natural gas",
  COPPER: "Copper",
  ALUMINIUM: "Aluminium",
  ZINC: "Zinc",
};
