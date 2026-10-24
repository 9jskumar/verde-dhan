import type { FinancialStatement } from "../quant/fundamentals";
import { appendBar, appendBase, mulberry32, uptrend } from "../quant/testing/patterns";
import type { Bar } from "../quant/types";
import {
  COMMODITY_KEYS,
  type CommoditiesProvider,
  type CommodityQuote,
  FX_PAIRS,
  type ForexProvider,
  type FxQuote,
  GLOBAL_INDEX_KEYS,
  type GlobalIndicesProvider,
  type HistoricalSeries,
  INDIA_INDEX_KEYS,
  type IndexQuote,
  INSTRUMENT_NAMES,
  type MarketDataProvider,
  type MarketQuote,
  type NewsItem,
  type NewsProvider,
} from "./types";

/**
 * SYNTHETIC DEMO DATA — NOT MARKET DATA.
 *
 * Used only when DEMO_MODE=true so the pipeline and UI can be exercised
 * without vendor credentials. To make confusion with real markets
 * impossible:
 *   - companies are fictional ("Demo … Ltd", symbols prefixed DM);
 *   - every index starts at 1,000.00 and every FX pair / commodity at 1.0000
 *     or 100.00, nowhere near real levels;
 *   - every record carries source="demo" and isDemo=true, and the UI shows
 *     a persistent DEMO banner.
 */

export const DEMO_SOURCE = "demo";

export interface DemoCompany {
  symbol: string;
  name: string;
  sector: string;
  isFinancialSector: boolean;
  pattern: "early" | "confirmed" | "retest" | "failed" | "trend" | "weak";
  quality: "strong" | "average" | "poor";
  governanceConcern?: boolean;
  promoterPledge: number;
}

export const DEMO_UNIVERSE: DemoCompany[] = [
  { symbol: "DMAURORA", name: "Demo Aurora Industrials Ltd", sector: "Industrials", isFinancialSector: false, pattern: "confirmed", quality: "strong", promoterPledge: 0 },
  { symbol: "DMBANYAN", name: "Demo Banyan Software Ltd", sector: "IT Services", isFinancialSector: false, pattern: "early", quality: "strong", promoterPledge: 0 },
  { symbol: "DMCEDAR", name: "Demo Cedar Pharma Ltd", sector: "Pharmaceuticals", isFinancialSector: false, pattern: "retest", quality: "strong", promoterPledge: 2 },
  { symbol: "DMDELTA", name: "Demo Delta Finance Ltd", sector: "Banks", isFinancialSector: true, pattern: "confirmed", quality: "average", promoterPledge: 0 },
  { symbol: "DMEMBER", name: "Demo Ember Metals Ltd", sector: "Metals", isFinancialSector: false, pattern: "early", quality: "average", promoterPledge: 5 },
  { symbol: "DMFALCON", name: "Demo Falcon Auto Ltd", sector: "Automobiles", isFinancialSector: false, pattern: "trend", quality: "strong", promoterPledge: 0 },
  { symbol: "DMGARNET", name: "Demo Garnet Paints Ltd", sector: "Paints", isFinancialSector: false, pattern: "confirmed", quality: "strong", governanceConcern: true, promoterPledge: 0 },
  { symbol: "DMHARBOR", name: "Demo Harbor Logistics Ltd", sector: "Industrials", isFinancialSector: false, pattern: "failed", quality: "average", promoterPledge: 10 },
  { symbol: "DMIRIS", name: "Demo Iris Consumer Ltd", sector: "FMCG", isFinancialSector: false, pattern: "weak", quality: "poor", promoterPledge: 35 },
  { symbol: "DMJADE", name: "Demo Jade Energy Ltd", sector: "Upstream Oil & Gas", isFinancialSector: false, pattern: "retest", quality: "average", promoterPledge: 0 },
  { symbol: "DMKESTREL", name: "Demo Kestrel Aviation Ltd", sector: "Aviation", isFinancialSector: false, pattern: "trend", quality: "poor", promoterPledge: 15 },
  { symbol: "DMLOTUS", name: "Demo Lotus Chemicals Ltd", sector: "Chemicals", isFinancialSector: false, pattern: "early", quality: "strong", promoterPledge: 0 },
];

function seedOf(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Re-dates synthetic bars so the latest completed session is the last weekday. */
function redate(bars: Bar[], end = new Date()): Bar[] {
  const days: string[] = [];
  const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (days.length < bars.length) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10));
  }
  days.reverse();
  return bars.map((b, i) => ({ ...b, timestamp: days[i]! }));
}

export function demoBars(company: DemoCompany): Bar[] {
  const rnd = mulberry32(seedOf(company.symbol));
  const start = 80 + rnd() * 60;
  if (company.pattern === "weak") {
    // Downtrend below a falling 200-DMA.
    return redate(uptrend(280, start * 2, -0.25, seedOf(company.symbol)));
  }
  const trend = uptrend(240, start, 0.12 + rnd() * 0.08, seedOf(company.symbol));
  const last = trend[trend.length - 1]!.close;
  const ceiling = last * 1.03;
  let bars = appendBase(trend, 20, ceiling, 5 + rnd() * 3);
  const bo = (mult: number, vol: number) =>
    (bars = appendBar(bars, { open: ceiling * (mult - 0.01), high: ceiling * (mult + 0.01), low: ceiling * (mult - 0.015), close: ceiling * mult, volume: vol }));
  switch (company.pattern) {
    case "early":
      bars = appendBar(bars, { open: ceiling * 0.98, high: ceiling * 0.995, low: ceiling * 0.975, close: ceiling * 0.99, volume: 450_000 });
      break;
    case "confirmed":
      bars = appendBar(bars, { open: ceiling * 0.995, high: ceiling * 1.04, low: ceiling * 0.99, close: ceiling * 1.03, volume: 2_100_000 });
      break;
    case "retest":
      bo(1.04, 2_200_000);
      bo(1.05, 900_000);
      bo(1.025, 700_000);
      bars = appendBar(bars, { open: ceiling * 1.02, high: ceiling * 1.025, low: ceiling * 1.003, close: ceiling * 1.012, volume: 600_000 });
      break;
    case "failed":
      bo(1.04, 2_200_000);
      bars = appendBar(bars, { open: ceiling, high: ceiling, low: ceiling * 0.95, close: ceiling * 0.96, volume: 1_500_000 });
      break;
    case "trend":
      bars = [...uptrend(261, start, 0.15, seedOf(company.symbol) + 1)];
      break;
  }
  return redate(bars);
}

/** Demo benchmark that drifts slightly lower at the end (so leaders show positive RS). */
export function demoBenchmark(length: number): number[] {
  return Array.from({ length }, (_, i) => (i < length - 40 ? 1000 : 1000 * (1 - 0.004 * (i - (length - 40)))));
}

export function demoStatements(company: DemoCompany): FinancialStatement[] {
  const g = company.quality === "strong" ? 0.18 : company.quality === "average" ? 0.09 : -0.03;
  const margin = company.quality === "strong" ? 0.13 : company.quality === "average" ? 0.08 : 0.03;
  const rows: FinancialStatement[] = [];
  let revenue = 1000;
  for (let y = 2021; y <= 2026; y++) {
    const pat = revenue * margin;
    rows.push({
      basis: "consolidated",
      periodType: "annual",
      period: `FY${y}`,
      periodEnd: `${y}-03-31`,
      revenue,
      ebitda: revenue * (margin + 0.08),
      ebit: revenue * (margin + 0.05),
      pat,
      eps: pat / 50,
      interestExpense: revenue * (company.quality === "poor" ? 0.04 : 0.008),
      totalAssets: revenue * 1.1,
      currentLiabilities: revenue * 0.25,
      totalDebt: revenue * (company.quality === "poor" ? 0.9 : 0.15),
      cashAndEquivalents: revenue * 0.06,
      equity: revenue * 0.55,
      operatingCashFlow: pat * (company.quality === "poor" ? 0.4 : 1.05),
      capex: revenue * 0.05,
      sharesOutstanding: 50,
    });
    revenue *= 1 + g;
  }
  return rows;
}

const now = () => new Date().toISOString();
const meta = () => ({ source: DEMO_SOURCE, isDemo: true, dataDelaySeconds: 0, fetchedAt: now() });

function syntheticSeries(key: string, base: number, length = 260): Bar[] {
  const rnd = mulberry32(seedOf(key));
  const out: Bar[] = [];
  let c = base;
  for (let i = 0; i < length; i++) {
    const o = c;
    c = c * (1 + (rnd() - 0.49) * 0.02);
    out.push({ timestamp: String(i), open: o, high: Math.max(o, c) * 1.004, low: Math.min(o, c) * 0.996, close: c, volume: 0, complete: true });
  }
  return redate(out);
}

const lastTwo = (bars: Bar[]) => [bars[bars.length - 2]!, bars[bars.length - 1]!] as const;

export class DemoProvider implements MarketDataProvider, GlobalIndicesProvider, ForexProvider, CommoditiesProvider, NewsProvider {
  readonly id = DEMO_SOURCE;

  async getQuote(symbol: string): Promise<MarketQuote> {
    const company = DEMO_UNIVERSE.find((c) => c.symbol === symbol);
    if (!company) throw new Error(`unknown demo symbol ${symbol}`);
    const [prev, last] = lastTwo(demoBars(company));
    return {
      ...meta(),
      symbol,
      exchange: "NSE",
      timestamp: last.timestamp,
      lastPrice: last.close,
      open: last.open,
      high: last.high,
      low: last.low,
      previousClose: prev.close,
      changePct: (last.close / prev.close - 1) * 100,
      volume: last.volume,
    };
  }

  async getHistoricalPrices(symbol: string): Promise<HistoricalSeries> {
    const company = DEMO_UNIVERSE.find((c) => c.symbol === symbol);
    if (!company) throw new Error(`unknown demo symbol ${symbol}`);
    return { ...meta(), symbol, interval: "1d", bars: demoBars(company).map((b) => ({ ...b, adjustedClose: null, complete: b.complete !== false })) };
  }

  async getIndexQuotes(keys: readonly string[] = [...INDIA_INDEX_KEYS, ...GLOBAL_INDEX_KEYS]): Promise<IndexQuote[]> {
    return keys.map((key) => {
      const [prev, last] = lastTwo(syntheticSeries(key, 1000));
      return {
        ...meta(),
        symbol: key,
        name: INSTRUMENT_NAMES[key] ?? key,
        currency: "DEMO",
        timestamp: last.timestamp,
        lastValue: last.close,
        previousClose: prev.close,
        absoluteChange: last.close - prev.close,
        percentageChange: (last.close / prev.close - 1) * 100,
        dayHigh: last.high,
        dayLow: last.low,
        marketStatus: "CLOSED",
      };
    });
  }

  async getIndexHistory(symbol: string): Promise<HistoricalSeries> {
    return { ...meta(), symbol, interval: "1d", bars: syntheticSeries(symbol, 1000).map((b) => ({ ...b, adjustedClose: null, complete: true })) };
  }

  async getFxQuotes(pairs: readonly string[] = FX_PAIRS): Promise<FxQuote[]> {
    return pairs.map((pair) => {
      const [prev, last] = lastTwo(syntheticSeries(pair, 1));
      return { ...meta(), pair, timestamp: last.timestamp, bid: null, ask: null, mid: last.close, previousClose: prev.close, percentageChange: (last.close / prev.close - 1) * 100 };
    });
  }

  getFxHistory(pair: string) {
    return this.getIndexHistory(pair).then((s) => ({ ...s, bars: syntheticSeries(pair, 1).map((b) => ({ ...b, adjustedClose: null, complete: true })) }));
  }

  async getCommodityQuotes(instruments: readonly string[] = COMMODITY_KEYS): Promise<CommodityQuote[]> {
    return instruments.map((instrument) => {
      const [prev, last] = lastTwo(syntheticSeries(instrument, 100));
      return {
        ...meta(),
        instrument,
        timestamp: last.timestamp,
        price: last.close,
        currency: "DEMO",
        unit: "unit",
        contractType: instrument === "XAU" || instrument === "XAG" ? "SPOT" : "CONTINUOUS_FUTURE",
        previousClose: prev.close,
        percentageChange: (last.close / prev.close - 1) * 100,
      };
    });
  }

  getCommodityHistory(instrument: string) {
    return Promise.resolve({ ...meta(), symbol: instrument, interval: "1d" as const, bars: syntheticSeries(instrument, 100).map((b) => ({ ...b, adjustedClose: null, complete: true })) });
  }

  async getLatestNews(): Promise<NewsItem[]> {
    // Demo mode deliberately has no news: headlines cannot be synthesised
    // without looking like real reporting.
    return [];
  }
}
