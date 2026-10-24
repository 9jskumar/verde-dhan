import { describe, expect, it } from "vitest";
import { buildTradePlan, DEFAULT_BREAKOUT_CONFIG, detectBreakout } from "./breakout";
import { appendBar, appendBase, uptrend } from "./testing/patterns";
import type { Bar } from "./types";

/** Benchmark that drifts down in the final stretch so the stock's RS improves. */
function weakeningBenchmark(length: number): number[] {
  return Array.from({ length }, (_, i) => (i < length - 40 ? 20000 : 20000 * (1 - 0.004 * (i - (length - 40)))));
}

function basePattern(): { bars: Bar[]; ceiling: number } {
  const trend = uptrend(240);
  const ceiling = trend[trend.length - 1]!.close * 1.03;
  return { bars: appendBase(trend, 20, ceiling, 6), ceiling };
}

const ctxGood = (len: number) => ({
  benchmarkCloses: weakeningBenchmark(len),
  sectorTrendPositive: true,
  marketHealthy: true,
});

describe("detectBreakout", () => {
  it("returns insufficientData for short histories", () => {
    const r = detectBreakout(uptrend(30));
    expect(r.insufficientData).toBe(true);
    expect(r.stage).toBe("NONE");
    expect(r.plan).toBeNull();
  });

  it("classifies a tight, contracting base just below resistance as EARLY", () => {
    const { bars, ceiling } = basePattern();
    const withApproach = appendBar(bars, {
      open: ceiling * 0.98,
      high: ceiling * 0.995,
      low: ceiling * 0.975,
      close: ceiling * 0.99,
      volume: 450_000,
    });
    const r = detectBreakout(withApproach, ctxGood(withApproach.length));
    const failing = r.criteria.early.filter((c) => c.met !== true).map((c) => `${c.name}=${c.value}`);
    expect(failing).toEqual([]);
    expect(r.stage).toBe("EARLY");
    expect(r.plan).not.toBeNull();
    expect(r.plan!.stopLoss).toBeLessThan(r.plan!.entryLow);
  });

  it("confirms a breakout only on a completed close above resistance with volume", () => {
    const { bars, ceiling } = basePattern();
    const breakout = appendBar(bars, {
      open: ceiling * 0.995,
      high: ceiling * 1.04,
      low: ceiling * 0.99,
      close: ceiling * 1.03,
      volume: 2_000_000,
    });
    const r = detectBreakout(breakout, ctxGood(breakout.length));
    expect(r.criteria.confirmed.map((c) => c.met)).toEqual([true, true, true, true, true]);
    expect(r.stage).toBe("CONFIRMED");
    expect(r.plan!.breakoutLevel).toBeCloseTo(ceiling, 1);
    expect(r.plan!.target1).toBeLessThan(r.plan!.target2);
    expect(r.plan!.target2).toBeLessThanOrEqual(r.plan!.target3);
  });

  it("does not confirm when the crossing candle is still in progress", () => {
    const { bars, ceiling } = basePattern();
    const intraday = appendBar(bars, {
      open: ceiling * 0.995,
      high: ceiling * 1.04,
      low: ceiling * 0.99,
      close: ceiling * 1.03,
      volume: 2_000_000,
      complete: false,
    });
    const r = detectBreakout(intraday, ctxGood(intraday.length));
    expect(r.stage).not.toBe("CONFIRMED");
    expect(r.intradayCrossPending).toBe(true);
  });

  it("does not confirm on a low-volume crossing", () => {
    const { bars, ceiling } = basePattern();
    const weak = appendBar(bars, {
      open: ceiling,
      high: ceiling * 1.03,
      low: ceiling * 0.995,
      close: ceiling * 1.02,
      volume: 500_000,
    });
    expect(detectBreakout(weak, ctxGood(weak.length)).stage).not.toBe("CONFIRMED");
  });

  it("treats unknown sector / market context as not confirmed", () => {
    const { bars, ceiling } = basePattern();
    const breakout = appendBar(bars, {
      open: ceiling,
      high: ceiling * 1.04,
      low: ceiling * 0.99,
      close: ceiling * 1.03,
      volume: 2_000_000,
    });
    const r = detectBreakout(breakout, { benchmarkCloses: weakeningBenchmark(breakout.length) });
    expect(r.stage).not.toBe("CONFIRMED");
    expect(r.criteria.confirmed.find((c) => c.name === "Positive sector trend")!.met).toBeNull();
  });

  it("detects a RETEST of a recent breakout that holds the level", () => {
    const { bars, ceiling } = basePattern();
    let b = appendBar(bars, { open: ceiling, high: ceiling * 1.05, low: ceiling * 0.995, close: ceiling * 1.04, volume: 2_200_000 });
    b = appendBar(b, { open: ceiling * 1.04, high: ceiling * 1.06, low: ceiling * 1.03, close: ceiling * 1.05, volume: 900_000 });
    b = appendBar(b, { open: ceiling * 1.04, high: ceiling * 1.045, low: ceiling * 1.02, close: ceiling * 1.025, volume: 700_000 });
    b = appendBar(b, { open: ceiling * 1.02, high: ceiling * 1.025, low: ceiling * 1.003, close: ceiling * 1.012, volume: 600_000 });
    const r = detectBreakout(b, ctxGood(b.length));
    expect(r.criteria.retest.every((c) => c.met === true)).toBe(true);
    expect(r.stage).toBe("RETEST");
    expect(r.plan!.breakoutLevel).toBeCloseTo(ceiling, 1);
  });

  it("flags a FAILED breakout when price closes back below the level", () => {
    const { bars, ceiling } = basePattern();
    let b = appendBar(bars, { open: ceiling, high: ceiling * 1.05, low: ceiling * 0.995, close: ceiling * 1.04, volume: 2_200_000 });
    b = appendBar(b, { open: ceiling * 1.0, high: ceiling * 1.0, low: ceiling * 0.95, close: ceiling * 0.96, volume: 1_500_000 });
    const r = detectBreakout(b, ctxGood(b.length));
    expect(r.stage).toBe("FAILED");
    expect(r.plan).toBeNull();
  });
});

describe("buildTradePlan", () => {
  it("computes R-multiple targets and risk/reward to T2", () => {
    const p = buildTradePlan(100, 90, 2, 10, DEFAULT_BREAKOUT_CONFIG)!;
    // entry mid = 101, stop = max(100 − 3, 90) = 97, risk = 4
    expect(p.stopLoss).toBe(97);
    expect(p.target1).toBe(107);
    expect(p.target2).toBe(111);
    expect(p.target3).toBe(115);
    expect(p.riskReward).toBe(2.5);
  });

  it("refuses to build a plan without a positive ATR", () => {
    expect(buildTradePlan(100, 90, 0, 10, DEFAULT_BREAKOUT_CONFIG)).toBeNull();
  });
});
