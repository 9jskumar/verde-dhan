import type { BreakoutStage } from "./breakout";
import type { FundamentalMetrics } from "./fundamentals";
import { round } from "./types";

/**
 * 100-point stock scoring model (Part 12).
 *
 *   Fundamental quality           40
 *   Technical strength            35
 *   Catalysts & global alignment  15
 *   Valuation & risk              10
 *
 * Each sub-component is scored deterministically from a measured input.
 * When an input is missing the sub-component scores 0 and its points are
 * recorded in `missing`; if too much of the model is missing the stock is
 * rejected for unreliable data rather than ranked on partial evidence.
 *
 * Mandatory rejection conditions always force recommendation = AVOID,
 * whatever the numerical score. A high score never overrides a risk flag.
 */

export const SCORING_MODEL_VERSION = "score-v1.0.0";

export interface ScoringInput {
  symbol: string;
  sector: string | null;
  /** Banks/NBFCs/insurers: leverage and ROCE are not meaningful. */
  isFinancialSector: boolean;
  fundamentals: FundamentalMetrics | null;
  ownership: { promoterHolding: number | null; promoterPledge: number | null };
  valuation: { pe: number | null; peg: number | null; sectorMedianPe: number | null };
  technical: {
    close: number | null;
    sma50: number | null;
    sma200: number | null;
    sma200Prior: number | null; // SMA200 twenty sessions ago, for slope
    rsi14: number | null;
    macdHistogram: number | null;
    relativeVolume: number | null;
    relativeStrength: number | null; // fraction, 0.05 = +5% vs benchmark
    atrPct: number | null; // ATR / close × 100
    breakoutStage: BreakoutStage | null;
  };
  catalysts: {
    positiveVerified: number;
    negativeVerified: number;
    /** Verified material governance concern (auditor resignation, SEBI order, fraud…). */
    governanceConcern: boolean;
  };
  /** −1 … +1 from the global impact engine for this stock's sector; null if not run. */
  globalAlignment: number | null;
  liquidity: { averageTradedValue20d: number | null };
  data: { latestPriceAt: string | null; now: string; maxPriceAgeHours?: number };
}

export interface ScoringConfig {
  minAverageTradedValue: number; // ₹ per session
  maxPromoterPledgePct: number;
  minDataCoverage: number; // 0..1 share of the 100 points that had inputs
  maxPriceAgeHours: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  minAverageTradedValue: 5_00_00_000, // ₹5 crore
  maxPromoterPledgePct: 25,
  minDataCoverage: 0.7,
  // Covers a weekend plus a market holiday between daily closes.
  maxPriceAgeHours: 100,
};

export type Classification =
  | "EXCEPTIONAL"
  | "HIGH_POTENTIAL"
  | "QUALIFIED"
  | "WATCHLIST"
  | "DO_NOT_RECOMMEND"
  | "REJECTED";

export type RejectionCode =
  | "GOVERNANCE_CONCERN"
  | "UNRELIABLE_DATA"
  | "STALE_DATA"
  | "INADEQUATE_LIQUIDITY"
  | "SEVERE_TECHNICAL_DETERIORATION"
  | "EXCESSIVE_PROMOTER_PLEDGE"
  | "FAILED_BREAKOUT";

export interface ComponentScore {
  name: string;
  points: number;
  max: number;
  input: number | string | null;
}

export interface ScoreResult {
  version: string;
  symbol: string;
  fundamental: number;
  technical: number;
  catalystGlobal: number;
  valuationRisk: number;
  total: number;
  coverage: number;
  classification: Classification;
  rejections: RejectionCode[];
  components: ComponentScore[];
  missing: string[];
}

/** Linear interpolation of x between [x0 → 0 points, x1 → max points], clamped. */
function ramp(x: number, x0: number, x1: number, max: number): number {
  if (x1 === x0) return x >= x1 ? max : 0;
  const t = (x - x0) / (x1 - x0);
  return Math.max(0, Math.min(1, t)) * max;
}

export function classify(total: number): Exclude<Classification, "REJECTED"> {
  if (total >= 85) return "EXCEPTIONAL";
  if (total >= 75) return "HIGH_POTENTIAL";
  if (total >= 70) return "QUALIFIED";
  if (total >= 65) return "WATCHLIST";
  return "DO_NOT_RECOMMEND";
}

export function scoreStock(input: ScoringInput, cfg: ScoringConfig = DEFAULT_SCORING_CONFIG): ScoreResult {
  const components: ComponentScore[] = [];
  const missing: string[] = [];
  let available = 0;
  let possible = 0;

  const add = (group: string, name: string, max: number, value: number | null, scorer: (v: number) => number) => {
    possible += max;
    if (value === null || !Number.isFinite(value)) {
      missing.push(`${group}: ${name}`);
      components.push({ name: `${group}: ${name}`, points: 0, max, input: null });
      return 0;
    }
    available += max;
    const pts = Math.max(0, Math.min(max, scorer(value)));
    components.push({ name: `${group}: ${name}`, points: round(pts, 2)!, max, input: round(value, 4) });
    return pts;
  };

  const f = input.fundamentals;
  const t = input.technical;

  // ---- Fundamental quality (40) ---------------------------------------------
  let fundamental = 0;
  fundamental += add("Fundamental", "Revenue growth %", 5, f?.revenueGrowth ?? null, (v) => ramp(v, 0, 20, 5));
  fundamental += add("Fundamental", "PAT growth %", 5, f?.patGrowth ?? null, (v) => ramp(v, 0, 25, 5));
  fundamental += add("Fundamental", "3y revenue CAGR %", 4, f?.revenueCagr3y ?? null, (v) => ramp(v, 0, 15, 4));
  fundamental += add("Fundamental", "ROE %", 6, f?.roe ?? null, (v) => ramp(v, 8, 20, 6));
  if (input.isFinancialSector) {
    // Leverage / ROCE / interest cover don't apply to lenders; their 12
    // points are reallocated to ROE quality and earnings growth persistence.
    fundamental += add("Fundamental", "ROE % (financials weighting)", 6, f?.roe ?? null, (v) => ramp(v, 10, 18, 6));
    fundamental += add("Fundamental", "3y PAT CAGR % (financials weighting)", 6, f?.patCagr3y ?? null, (v) => ramp(v, 0, 20, 6));
  } else {
    fundamental += add("Fundamental", "ROCE %", 4, f?.roce ?? null, (v) => ramp(v, 10, 22, 4));
    fundamental += add("Fundamental", "Debt/Equity", 4, f?.debtEquity ?? null, (v) => 4 - ramp(v, 0.3, 1.5, 4));
    fundamental += add("Fundamental", "Interest coverage ×", 4, f?.interestCoverage ?? null, (v) => ramp(v, 1.5, 6, 4));
  }
  fundamental += add("Fundamental", "CFO/PAT", 5, f?.cfoPatRatio ?? null, (v) => ramp(v, 0.5, 1, 5));
  fundamental += add("Fundamental", "Promoter pledge %", 3, input.ownership.promoterPledge, (v) => 3 - ramp(v, 0, 20, 3));

  // ---- Technical strength (35) ------------------------------------------------
  let technical = 0;
  const trendValue =
    t.close === null || t.sma50 === null || t.sma200 === null
      ? null
      : (t.close > t.sma50 ? 1 : 0) + (t.sma50 > t.sma200 ? 1 : 0) + (t.close > t.sma200 ? 1 : 0);
  technical += add("Technical", "Trend alignment (close > 50DMA > 200DMA)", 8, trendValue, (v) => (v / 3) * 8);
  const slope = t.sma200 !== null && t.sma200Prior !== null && t.sma200Prior > 0 ? (t.sma200 / t.sma200Prior - 1) * 100 : null;
  technical += add("Technical", "200DMA slope %", 3, slope, (v) => ramp(v, 0, 2, 3));
  // RSI sweet spot 55–70: momentum without being stretched.
  technical += add("Technical", "RSI(14)", 4, t.rsi14, (v) => (v < 40 ? 0 : v <= 55 ? ramp(v, 40, 55, 4) : v <= 70 ? 4 : v <= 80 ? 4 - ramp(v, 70, 80, 3) : 0.5));
  technical += add("Technical", "MACD histogram > 0", 3, t.macdHistogram, (v) => (v > 0 ? 3 : 0));
  const stagePoints: Record<BreakoutStage, number> = { CONFIRMED: 10, RETEST: 9, EARLY: 7, NONE: 2, FAILED: 0 };
  technical += add("Technical", "Breakout setup", 10, t.breakoutStage ? stagePoints[t.breakoutStage] : null, (v) => v);
  technical += add("Technical", "Relative volume", 3, t.relativeVolume, (v) => ramp(v, 0.8, 2, 3));
  technical += add("Technical", "Relative strength vs NIFTY", 4, t.relativeStrength, (v) => ramp(v, -0.02, 0.1, 4));

  // ---- Catalysts & global alignment (15) -------------------------------------
  let catalystGlobal = 0;
  const net = input.catalysts.positiveVerified - input.catalysts.negativeVerified;
  catalystGlobal += add("Catalyst", "Net verified catalysts", 9, net, (v) => ramp(v, -1, 3, 9));
  catalystGlobal += add("Global", "Sector global alignment", 6, input.globalAlignment, (v) => ramp(v, -1, 1, 6));

  // ---- Valuation & risk (10) -------------------------------------------------
  let valuationRisk = 0;
  const peRel = input.valuation.pe !== null && input.valuation.sectorMedianPe ? input.valuation.pe / input.valuation.sectorMedianPe : null;
  valuationRisk += add("Valuation", "P/E vs sector median", 4, peRel, (v) => 4 - ramp(v, 0.8, 1.8, 4));
  valuationRisk += add("Valuation", "PEG", 2, input.valuation.peg, (v) => 2 - ramp(v, 1, 2.5, 2));
  valuationRisk += add("Risk", "Volatility (ATR %)", 4, t.atrPct, (v) => 4 - ramp(v, 2, 6, 4));

  const total = round(fundamental + technical + catalystGlobal + valuationRisk, 2)!;
  const coverage = possible === 0 ? 0 : available / possible;

  // ---- Mandatory rejections ---------------------------------------------------
  const rejections: RejectionCode[] = [];
  if (input.catalysts.governanceConcern) rejections.push("GOVERNANCE_CONCERN");
  if (coverage < cfg.minDataCoverage) rejections.push("UNRELIABLE_DATA");
  const maxAge = input.data.maxPriceAgeHours ?? cfg.maxPriceAgeHours;
  if (!input.data.latestPriceAt || Date.parse(input.data.now) - Date.parse(input.data.latestPriceAt) > maxAge * 3_600_000) {
    rejections.push("STALE_DATA");
  }
  if (input.liquidity.averageTradedValue20d === null || input.liquidity.averageTradedValue20d < cfg.minAverageTradedValue) {
    rejections.push("INADEQUATE_LIQUIDITY");
  }
  if (
    t.close !== null && t.sma50 !== null && t.sma200 !== null && t.rsi14 !== null &&
    t.close < t.sma200 && t.sma50 < t.sma200 && t.rsi14 < 35
  ) {
    rejections.push("SEVERE_TECHNICAL_DETERIORATION");
  }
  if (input.ownership.promoterPledge !== null && input.ownership.promoterPledge > cfg.maxPromoterPledgePct) {
    rejections.push("EXCESSIVE_PROMOTER_PLEDGE");
  }
  if (t.breakoutStage === "FAILED") rejections.push("FAILED_BREAKOUT");

  return {
    version: SCORING_MODEL_VERSION,
    symbol: input.symbol,
    fundamental: round(fundamental, 2)!,
    technical: round(technical, 2)!,
    catalystGlobal: round(catalystGlobal, 2)!,
    valuationRisk: round(valuationRisk, 2)!,
    total,
    coverage: round(coverage, 3)!,
    classification: rejections.length ? "REJECTED" : classify(total),
    rejections,
    components,
    missing,
  };
}

export type Recommendation = "BUY_BREAKOUT" | "BUY_ON_BREAKOUT" | "BUY_ON_RETEST" | "WATCH" | "AVOID";

/**
 * Deterministic recommendation from score + breakout stage. The AI layer
 * may explain this but cannot upgrade it.
 */
export function recommendationFor(score: ScoreResult, stage: BreakoutStage | null): Recommendation {
  if (score.classification === "REJECTED" || score.classification === "DO_NOT_RECOMMEND") return "AVOID";
  if (score.classification === "WATCHLIST") return "WATCH";
  switch (stage) {
    case "CONFIRMED":
      return "BUY_BREAKOUT";
    case "RETEST":
      return "BUY_ON_RETEST";
    case "EARLY":
      return "BUY_ON_BREAKOUT";
    default:
      return "WATCH";
  }
}

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  EXCEPTIONAL: "Exceptional candidate",
  HIGH_POTENTIAL: "High potential",
  QUALIFIED: "Qualified opportunity",
  WATCHLIST: "Watchlist",
  DO_NOT_RECOMMEND: "Do not recommend",
  REJECTED: "Rejected (risk flag)",
};
