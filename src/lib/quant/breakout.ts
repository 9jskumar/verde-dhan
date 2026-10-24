import { atr, bollinger, priorHigh, priorLow, relativeStrength, relativeVolume, sma } from "./indicators";
import type { Bar } from "./types";
import { completedBars, round } from "./types";

/**
 * Breakout detection (Part 9 of the brief).
 *
 * Every criterion is reported individually with its measured value and
 * threshold so the result is auditable and can be passed to Claude as
 * evidence. A criterion whose inputs are unavailable is `met: null`
 * ("unknown") and never counts as satisfied.
 *
 * Only completed daily bars are used. An in-progress candle that crosses
 * resistance is reported as `intradayCrossPending`, never as confirmed.
 *
 * All thresholds are configurable and MUST be backtested before production
 * use (see backtest_runs / backtest_results tables).
 */

export const BREAKOUT_ALGORITHM_VERSION = "breakout-v1.0.0";

export interface BreakoutConfig {
  baseLookback: number; // sessions that form the consolidation base
  maxBaseDepthPct: number; // (high − low) / high of the base
  approachPct: number; // close within this % below resistance = "approaching"
  breakoutBufferPct: number; // close must exceed resistance by this %
  minBreakoutRelVolume: number; // volume expansion on breakout day
  volumeContractionRatio: number; // late-base avg vol / pre-base avg vol must be below this
  volatilityContractionRatio: number; // bandwidth now / bandwidth at base start must be below this
  rsLookback: number;
  rsImprovementWindow: number;
  retestMaxSessions: number; // breakout must be within this many sessions for a retest
  retestProximityPct: number; // low within this % of the breakout level
  failureBufferPct: number; // close this % below level after breakout = failed
  stopAtrMultiple: number;
  targetRMultiples: [number, number, number];
}

export const DEFAULT_BREAKOUT_CONFIG: BreakoutConfig = {
  baseLookback: 20,
  maxBaseDepthPct: 12,
  approachPct: 3,
  breakoutBufferPct: 0.5,
  minBreakoutRelVolume: 1.5,
  volumeContractionRatio: 0.9,
  volatilityContractionRatio: 0.85,
  rsLookback: 63,
  rsImprovementWindow: 10,
  retestMaxSessions: 15,
  retestProximityPct: 2,
  failureBufferPct: 2,
  stopAtrMultiple: 1.5,
  targetRMultiples: [1.5, 2.5, 3.5],
};

export type BreakoutStage = "CONFIRMED" | "RETEST" | "EARLY" | "FAILED" | "NONE";

export interface Criterion {
  name: string;
  met: boolean | null;
  value: number | null;
  threshold: string;
}

export interface TradePlan {
  breakoutLevel: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  invalidationLevel: number;
  target1: number;
  target2: number;
  target3: number;
  /** Reward to target 2 divided by risk from the entry midpoint. */
  riskReward: number;
}

export interface BreakoutContext {
  /** Aligned benchmark closes (e.g. NIFTY 50) for relative strength. */
  benchmarkCloses?: readonly number[];
  /** Sector trend from sector analysis: true = positive, false = negative. */
  sectorTrendPositive?: boolean | null;
  /** Broader market health (e.g. NIFTY above its 50-DMA, breadth positive). */
  marketHealthy?: boolean | null;
}

export interface BreakoutResult {
  version: string;
  stage: BreakoutStage;
  asOf: string | null;
  close: number | null;
  resistance: number | null;
  baseLow: number | null;
  criteria: { early: Criterion[]; confirmed: Criterion[]; retest: Criterion[] };
  intradayCrossPending: boolean;
  plan: TradePlan | null;
  insufficientData: boolean;
}

const pct = (a: number, b: number) => ((a - b) / b) * 100;
const allMet = (cs: Criterion[]) => cs.every((c) => c.met === true);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);

function slope(ys: number[]): number {
  const n = ys.length;
  const xm = (n - 1) / 2;
  const ym = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (ys[i]! - ym);
    den += (i - xm) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function buildTradePlan(
  level: number,
  baseLow: number,
  atrValue: number,
  baseHeight: number,
  cfg: BreakoutConfig,
): TradePlan | null {
  if (!(level > 0) || !(atrValue > 0)) return null;
  const entryLow = level;
  const entryHigh = level * 1.02;
  const entryMid = (entryLow + entryHigh) / 2;
  const stopLoss = Math.max(level - cfg.stopAtrMultiple * atrValue, baseLow);
  const risk = entryMid - stopLoss;
  if (!(risk > 0)) return null;
  const [m1, m2, m3] = cfg.targetRMultiples;
  const target1 = entryMid + m1 * risk;
  const target2 = entryMid + m2 * risk;
  // Measured move (base height projected from the level) when it exceeds T2.
  const target3 = Math.max(entryMid + m3 * risk, level + baseHeight);
  return {
    breakoutLevel: round(level, 2)!,
    entryLow: round(entryLow, 2)!,
    entryHigh: round(entryHigh, 2)!,
    stopLoss: round(stopLoss, 2)!,
    invalidationLevel: round(stopLoss, 2)!,
    target1: round(target1, 2)!,
    target2: round(target2, 2)!,
    target3: round(target3, 2)!,
    riskReward: round((target2 - entryMid) / risk, 2)!,
  };
}

export function detectBreakout(
  allBars: readonly Bar[],
  ctx: BreakoutContext = {},
  cfg: BreakoutConfig = DEFAULT_BREAKOUT_CONFIG,
): BreakoutResult {
  const inProgress = allBars.length > 0 && allBars[allBars.length - 1]!.complete === false ? allBars[allBars.length - 1]! : null;
  const bars = completedBars(allBars);
  const empty: BreakoutResult = {
    version: BREAKOUT_ALGORITHM_VERSION,
    stage: "NONE",
    asOf: bars[bars.length - 1]?.timestamp ?? null,
    close: bars[bars.length - 1]?.close ?? null,
    resistance: null,
    baseLow: null,
    criteria: { early: [], confirmed: [], retest: [] },
    intradayCrossPending: false,
    plan: null,
    insufficientData: true,
  };
  const minBars = Math.max(cfg.baseLookback * 3 + 1, 60);
  if (bars.length < minBars) return empty;

  const n = bars.length;
  const i = n - 1;
  const today = bars[i]!;
  const closes = bars.map((b) => b.close);
  const resistanceSeries = priorHigh(bars, cfg.baseLookback);
  const baseLowSeries = priorLow(bars, cfg.baseLookback);
  const relVol = relativeVolume(bars, 20);
  const atrSeries = atr(bars, 14);
  const bw = bollinger(closes, 20, 2).bandwidth;

  let rs: (number | null)[] | null = null;
  if (ctx.benchmarkCloses && ctx.benchmarkCloses.length >= n) {
    const bench = ctx.benchmarkCloses.slice(-n);
    rs = relativeStrength(closes, bench, cfg.rsLookback);
  }
  const rsImproving = (at: number): Criterion => {
    const now = rs?.[at] ?? null;
    const before = rs?.[at - cfg.rsImprovementWindow] ?? null;
    return {
      name: "Relative strength improving vs benchmark",
      met: now === null || before === null ? null : now > before,
      value: now === null ? null : round(now * 100, 2),
      threshold: `RS(${cfg.rsLookback}) now > RS ${cfg.rsImprovementWindow} sessions ago`,
    };
  };

  // ---- Early breakout: evaluated on the base that ends yesterday ----------
  const resistance = resistanceSeries[i]!;
  const baseLow = baseLowSeries[i]!;
  const baseBars = bars.slice(i - cfg.baseLookback, i);
  const depth = ((resistance - baseLow) / resistance) * 100;
  const third = Math.floor(cfg.baseLookback / 3);
  const lowsByThird = [0, 1, 2].map((t) => Math.min(...baseBars.slice(t * third, (t + 1) * third).map((b) => b.low)));
  const lowSlope = slope(baseBars.map((b) => b.low));
  const bwNow = bw[i - 1] ?? null;
  const bwStart = bw[i - cfg.baseLookback] ?? null;
  const lateVol = mean(baseBars.slice(-Math.ceil(cfg.baseLookback / 2)).map((b) => b.volume));
  const preBaseVol = mean(bars.slice(i - cfg.baseLookback * 3, i - cfg.baseLookback).map((b) => b.volume));
  const distanceBelow = pct(resistance, today.close);

  const early: Criterion[] = [
    {
      name: "Tight consolidation",
      met: depth <= cfg.maxBaseDepthPct,
      value: round(depth, 2),
      threshold: `base depth ≤ ${cfg.maxBaseDepthPct}%`,
    },
    {
      name: "Higher lows",
      met: lowsByThird[0]! < lowsByThird[1]! && lowsByThird[1]! <= lowsByThird[2]! && lowSlope > 0,
      value: round(lowSlope, 4),
      threshold: "rising lows across the base",
    },
    {
      name: "Declining volatility",
      met: bwNow === null || bwStart === null ? null : bwNow / bwStart < cfg.volatilityContractionRatio,
      value: bwNow === null || bwStart === null ? null : round(bwNow / bwStart, 3),
      threshold: `Bollinger bandwidth ratio < ${cfg.volatilityContractionRatio}`,
    },
    {
      name: "Approaching resistance",
      met: today.close <= resistance && distanceBelow <= cfg.approachPct,
      value: round(distanceBelow, 2),
      threshold: `close within ${cfg.approachPct}% below resistance`,
    },
    {
      name: "Volume contraction in base",
      met: preBaseVol > 0 ? lateVol / preBaseVol < cfg.volumeContractionRatio : null,
      value: preBaseVol > 0 ? round(lateVol / preBaseVol, 3) : null,
      threshold: `late-base / pre-base volume < ${cfg.volumeContractionRatio}`,
    },
    rsImproving(i),
  ];

  // ---- Confirmed breakout on today's completed close ------------------------
  const rv = relVol[i] ?? null;
  const confirmed: Criterion[] = [
    {
      name: "Close above resistance",
      met: today.close > resistance * (1 + cfg.breakoutBufferPct / 100),
      value: round(pct(today.close, resistance), 2),
      threshold: `close > resistance + ${cfg.breakoutBufferPct}%`,
    },
    {
      name: "Volume expansion",
      met: rv === null ? null : rv >= cfg.minBreakoutRelVolume,
      value: round(rv, 2),
      threshold: `relative volume ≥ ${cfg.minBreakoutRelVolume}×`,
    },
    rsImproving(i),
    {
      name: "Positive sector trend",
      met: ctx.sectorTrendPositive ?? null,
      value: null,
      threshold: "sector analysis reports positive trend",
    },
    {
      name: "Healthy broader market",
      met: ctx.marketHealthy ?? null,
      value: null,
      threshold: "market regime check passes",
    },
  ];

  // ---- Retest / failure: look for a qualifying breakout in recent sessions --
  let retest: Criterion[] = [];
  let recentBreakout: { index: number; level: number; base: number } | null = null;
  for (let j = i - 1; j >= Math.max(i - cfg.retestMaxSessions, cfg.baseLookback); j--) {
    const lvl = resistanceSeries[j];
    const rvj = relVol[j];
    if (lvl && rvj && bars[j]!.close > lvl * (1 + cfg.breakoutBufferPct / 100) && rvj >= cfg.minBreakoutRelVolume) {
      recentBreakout = { index: j, level: lvl, base: baseLowSeries[j]! };
      break;
    }
  }
  let failed = false;
  if (recentBreakout) {
    const { index: bi, level } = recentBreakout;
    const since = bars.slice(bi + 1);
    const pullbackVol = mean(since.map((b) => b.volume));
    failed = today.close < level * (1 - cfg.failureBufferPct / 100);
    retest = [
      { name: "Previous resistance broken", met: true, value: round(level, 2), threshold: `breakout ${i - bi} sessions ago` },
      {
        name: "Price approaching breakout level",
        met: Math.abs(pct(today.low, level)) <= cfg.retestProximityPct,
        value: round(pct(today.low, level), 2),
        threshold: `low within ±${cfg.retestProximityPct}% of level`,
      },
      {
        name: "Support holding",
        met: today.close >= level * (1 - cfg.retestProximityPct / 200),
        value: round(pct(today.close, level), 2),
        threshold: "close at or above the breakout level (small tolerance)",
      },
      {
        name: "Healthy volume structure",
        met: since.length > 0 ? pullbackVol < bars[bi]!.volume : null,
        value: since.length > 0 ? round(pullbackVol / bars[bi]!.volume, 3) : null,
        threshold: "pullback volume below breakout-day volume",
      },
    ];
  }

  const atrNow = atrSeries[i] ?? null;
  let stage: BreakoutStage = "NONE";
  let planLevel = resistance;
  let planBaseLow = baseLow;
  if (failed) stage = "FAILED";
  else if (allMet(confirmed)) stage = "CONFIRMED";
  else if (recentBreakout && allMet(retest)) {
    stage = "RETEST";
    planLevel = recentBreakout.level;
    planBaseLow = recentBreakout.base;
  } else if (allMet(early)) stage = "EARLY";

  // Guard rail: never call a breakout confirmed while the trend is broken.
  const sma200 = sma(closes, 200)[i] ?? null;
  if (stage === "CONFIRMED" && sma200 !== null && today.close < sma200) stage = "EARLY";

  const plan =
    stage === "NONE" || stage === "FAILED" || atrNow === null
      ? null
      : buildTradePlan(planLevel, planBaseLow, atrNow, planLevel - planBaseLow, cfg);

  return {
    version: BREAKOUT_ALGORITHM_VERSION,
    stage,
    asOf: today.timestamp,
    close: today.close,
    resistance: round(resistance, 2),
    baseLow: round(baseLow, 2),
    criteria: { early, confirmed, retest },
    intradayCrossPending:
      inProgress !== null &&
      inProgress.high > Math.max(...bars.slice(-cfg.baseLookback).map((b) => b.high)),
    plan,
    insufficientData: false,
  };
}
