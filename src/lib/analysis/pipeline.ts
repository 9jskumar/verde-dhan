import { type BreakoutResult, detectBreakout } from "../quant/breakout";
import { computeFundamentalMetrics, type FinancialStatement, type FundamentalMetrics, valuation } from "../quant/fundamentals";
import { adx, atr, averageVolume, bollinger, ema, macd, relativeStrength, relativeVolume, rsi, sma, vwap } from "../quant/indicators";
import { supportResistance } from "../quant/levels";
import { type Recommendation, recommendationFor, type ScoreResult, scoreStock } from "../quant/scoring";
import { type Bar, completedBars, lastValue, priceSeries, round } from "../quant/types";

/**
 * Deterministic per-stock analysis: indicators → levels → breakout →
 * fundamentals → score → recommendation. No AI is involved here; the AI
 * layer receives this output as evidence and may only explain it.
 */

export const INDICATOR_CALCULATION_VERSION = "ind-v1.0.0";

export interface TechnicalSnapshot {
  timestamp: string;
  close: number;
  sma5: number | null; sma10: number | null; sma20: number | null; sma50: number | null;
  sma100: number | null; sma200: number | null; ema20: number | null; ema50: number | null;
  rsi14: number | null;
  macd: number | null; macdSignal: number | null; macdHistogram: number | null;
  adx14: number | null; atr14: number | null; atrPct: number | null;
  bollingerUpper: number | null; bollingerMiddle: number | null; bollingerLower: number | null;
  vwap20: number | null;
  averageVolume20d: number | null;
  averageTradedValue20d: number | null;
  relativeVolume: number | null;
  relativeStrength: number | null;
  support: number | null;
  resistance: number | null;
  sma200Prior: number | null;
}

export function technicalSnapshot(allBars: readonly Bar[], benchmark?: readonly number[]): TechnicalSnapshot | null {
  const bars = completedBars(allBars);
  if (bars.length < 2) return null;
  const closes = priceSeries(bars);
  const i = bars.length - 1;
  const at = (s: (number | null)[]) => round(s[i] ?? null, 4);
  const m = macd(closes);
  const bb = bollinger(closes);
  const s200 = sma(closes, 200);
  const levels = supportResistance(bars);
  const avgVol = averageVolume(bars, 20);
  const tradedValues = bars.map((b) => b.close * b.volume);
  const avgTv = sma(tradedValues, 20);
  const atrNow = atr(bars, 14)[i] ?? null;
  let rs: number | null = null;
  if (benchmark && benchmark.length >= bars.length) rs = lastValue(relativeStrength(closes, benchmark.slice(-bars.length), 63));
  return {
    timestamp: bars[i]!.timestamp,
    close: bars[i]!.close,
    sma5: at(sma(closes, 5)), sma10: at(sma(closes, 10)), sma20: at(sma(closes, 20)), sma50: at(sma(closes, 50)),
    sma100: at(sma(closes, 100)), sma200: at(s200), ema20: at(ema(closes, 20)), ema50: at(ema(closes, 50)),
    rsi14: at(rsi(closes, 14)),
    macd: at(m.macd), macdSignal: at(m.signal), macdHistogram: at(m.histogram),
    adx14: at(adx(bars, 14).adx), atr14: round(atrNow, 4), atrPct: atrNow === null ? null : round((atrNow / bars[i]!.close) * 100, 3),
    bollingerUpper: at(bb.upper), bollingerMiddle: at(bb.middle), bollingerLower: at(bb.lower),
    vwap20: at(vwap(bars, 20)),
    averageVolume20d: at(avgVol),
    averageTradedValue20d: round(avgTv[i] ?? null, 0),
    relativeVolume: at(relativeVolume(bars, 20)),
    relativeStrength: round(rs, 5),
    support: levels.support ? round(levels.support.price, 2) : null,
    resistance: levels.resistance ? round(levels.resistance.price, 2) : null,
    sma200Prior: round(s200[i - 20] ?? null, 4),
  };
}

export interface StockAnalysisInput {
  symbol: string;
  companyName: string;
  exchange: "NSE" | "BSE";
  sector: string | null;
  isFinancialSector: boolean;
  bars: readonly Bar[];
  benchmarkCloses?: readonly number[];
  statements: readonly FinancialStatement[];
  ownership: { promoterHolding: number | null; promoterPledge: number | null };
  sharesOutstanding: number | null;
  sectorMedianPe: number | null;
  catalysts: { positiveVerified: number; negativeVerified: number; governanceConcern: boolean };
  globalAlignment: number | null;
  sectorTrendPositive: boolean | null;
  marketHealthy: boolean | null;
  now: string;
  isDemo: boolean;
  source: string;
}

export interface StockAnalysis {
  symbol: string;
  companyName: string;
  exchange: "NSE" | "BSE";
  sector: string | null;
  asOf: string | null;
  technical: TechnicalSnapshot | null;
  breakout: BreakoutResult;
  fundamentals: FundamentalMetrics | null;
  valuation: ReturnType<typeof valuation> | null;
  score: ScoreResult;
  recommendation: Recommendation;
  isDemo: boolean;
  source: string;
  versions: { indicators: string; breakout: string; scoring: string };
}

export function analyseStock(input: StockAnalysisInput): StockAnalysis {
  const technical = technicalSnapshot(input.bars, input.benchmarkCloses);
  const breakout = detectBreakout(input.bars, {
    benchmarkCloses: input.benchmarkCloses,
    sectorTrendPositive: input.sectorTrendPositive,
    marketHealthy: input.marketHealthy,
  });

  let fundamentals: FundamentalMetrics | null = null;
  let val: ReturnType<typeof valuation> | null = null;
  const annual = input.statements.filter((s) => s.periodType === "annual" && s.basis === "consolidated");
  const usable = annual.length ? annual : input.statements.filter((s) => s.periodType === "annual" && s.basis === "standalone");
  if (usable.length) {
    fundamentals = computeFundamentalMetrics(usable);
    const latest = [...usable].sort((a, b) => a.period.localeCompare(b.period)).at(-1)!;
    const shares = input.sharesOutstanding ?? latest.sharesOutstanding;
    const price = technical?.close ?? null;
    val = valuation({
      price,
      marketCap: price !== null && shares ? price * shares : null,
      ttmEps: latest.eps,
      bookValuePerShare: latest.equity !== null && shares ? latest.equity / shares : null,
      ttmEbitda: latest.ebitda,
      totalDebt: latest.totalDebt,
      cash: latest.cashAndEquivalents,
      epsGrowthPct: fundamentals?.epsGrowth ?? null,
    });
  }

  const score = scoreStock({
    symbol: input.symbol,
    sector: input.sector,
    isFinancialSector: input.isFinancialSector,
    fundamentals,
    ownership: input.ownership,
    valuation: { pe: val?.pe ?? null, peg: val?.peg ?? null, sectorMedianPe: input.sectorMedianPe },
    technical: {
      close: technical?.close ?? null,
      sma50: technical?.sma50 ?? null,
      sma200: technical?.sma200 ?? null,
      sma200Prior: technical?.sma200Prior ?? null,
      rsi14: technical?.rsi14 ?? null,
      macdHistogram: technical?.macdHistogram ?? null,
      relativeVolume: technical?.relativeVolume ?? null,
      relativeStrength: technical?.relativeStrength ?? null,
      atrPct: technical?.atrPct ?? null,
      breakoutStage: breakout.insufficientData ? null : breakout.stage,
    },
    catalysts: input.catalysts,
    globalAlignment: input.globalAlignment,
    liquidity: { averageTradedValue20d: technical?.averageTradedValue20d ?? null },
    data: { latestPriceAt: technical?.timestamp ?? null, now: input.now },
  });

  return {
    symbol: input.symbol,
    companyName: input.companyName,
    exchange: input.exchange,
    sector: input.sector,
    asOf: technical?.timestamp ?? null,
    technical,
    breakout,
    fundamentals,
    valuation: val,
    score,
    recommendation: recommendationFor(score, breakout.insufficientData ? null : breakout.stage),
    isDemo: input.isDemo,
    source: input.source,
    versions: { indicators: INDICATOR_CALCULATION_VERSION, breakout: breakout.version, scoring: score.version },
  };
}

/** Ranks analyses for the Top-10: only qualified, non-rejected, non-AVOID names. */
export function rankOpportunities(analyses: readonly StockAnalysis[], limit = 10): StockAnalysis[] {
  return analyses
    .filter((a) => ["EXCEPTIONAL", "HIGH_POTENTIAL", "QUALIFIED"].includes(a.score.classification) && a.recommendation !== "AVOID")
    .sort((a, b) => b.score.total - a.score.total || b.score.technical - a.score.technical)
    .slice(0, limit);
}

/** Top-3: ranked names that also have a complete trade plan with R:R ≥ 1.5. */
export function topThree(ranked: readonly StockAnalysis[]): StockAnalysis[] {
  return ranked.filter((a) => a.breakout.plan && a.breakout.plan.riskReward >= 1.5).slice(0, 3);
}
