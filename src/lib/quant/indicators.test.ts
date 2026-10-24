import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/talib_reference.json";
import {
  adx,
  atr,
  averageVolume,
  bollinger,
  ema,
  macd,
  relativeStrength,
  relativeVolume,
  rsi,
  sma,
  vwap,
} from "./indicators";
import type { Bar, Series } from "./types";

const bars: Bar[] = fixture.bars.map((b, i) => ({
  ...b,
  timestamp: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
}));
const closes = bars.map((b) => b.close);

/** Compare against TA-Lib, requiring identical warm-up (null) positions. */
function expectMatches(actual: Series, reference: (number | null)[], tol = 1e-8, from = 0) {
  expect(actual.length).toBe(reference.length);
  for (let i = from; i < reference.length; i++) {
    const r = reference[i] ?? null;
    const a = actual[i];
    if (r === null) {
      expect(a, `index ${i} should be null`).toBeNull();
    } else {
      expect(a, `index ${i} should be a number`).not.toBeNull();
      expect(Math.abs((a as number) - r), `index ${i}: ${a} vs ${r}`).toBeLessThan(tol);
    }
  }
}

describe("indicators vs TA-Lib reference", () => {
  it("SMA(20)", () => expectMatches(sma(closes, 20), fixture.sma20));
  it("EMA(20)", () => expectMatches(ema(closes, 20), fixture.ema20));
  it("EMA(50)", () => expectMatches(ema(closes, 50), fixture.ema50));
  it("RSI(14) Wilder", () => expectMatches(rsi(closes, 14), fixture.rsi14));
  it("ATR(14) Wilder", () => expectMatches(atr(bars, 14), fixture.atr14));
  it("ADX(14) and DI", () => {
    const r = adx(bars, 14);
    expectMatches(r.adx, fixture.adx14, 1e-6);
    expectMatches(r.plusDI, fixture.plusDI14, 1e-6);
    expectMatches(r.minusDI, fixture.minusDI14, 1e-6);
  });
  it("Bollinger(20, 2) population stdev", () => {
    const r = bollinger(closes, 20, 2);
    expectMatches(r.upper, fixture.bbUpper, 1e-6);
    expectMatches(r.middle, fixture.bbMiddle, 1e-8);
    expectMatches(r.lower, fixture.bbLower, 1e-6);
  });
  it("MACD(12,26,9) converges to TA-Lib after warm-up", () => {
    // TA-Lib seeds the fast EMA at the slow EMA's start, so the first values
    // differ slightly from the textbook convention used here. After ~100
    // bars the seed influence decays below 1e-6.
    const r = macd(closes);
    for (let i = 120; i < closes.length; i++) {
      expect(Math.abs(r.macd[i]! - fixture.macd[i]!)).toBeLessThan(1e-6);
      expect(Math.abs(r.signal[i]! - fixture.macdSignal[i]!)).toBeLessThan(1e-6);
      expect(Math.abs(r.histogram[i]! - fixture.macdHist[i]!)).toBeLessThan(1e-6);
    }
  });
});

describe("indicators — hand-checked cases", () => {
  // StockCharts' worked example rounds the intermediate averages to 2 dp and
  // publishes 70.53 / 66.32 / 66.55; full-precision Wilder (and TA-Lib) give
  // 70.46 / 66.25 / 66.48. We assert agreement within that rounding gap.
  it("Wilder's published RSI example (StockCharts) within rounding", () => {
    const c = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
      46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
    ];
    const r = rsi(c, 14);
    expect(r[13]).toBeNull();
    expect(Math.abs(r[14]! - 70.53)).toBeLessThan(0.1);
    expect(Math.abs(r[15]! - 66.32)).toBeLessThan(0.1);
    expect(Math.abs(r[16]! - 66.55)).toBeLessThan(0.1);
  });

  it("RSI is 100 on a strictly rising series and 50 on a flat one", () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3)[5]).toBe(100);
    expect(rsi([5, 5, 5, 5, 5], 3)[4]).toBe(50);
  });

  it("SMA warm-up returns null, not zero", () => {
    expect(sma([1, 2, 3], 3)).toEqual([null, null, 2]);
  });

  it("EMA tolerates a leading null run (MACD line) and nulls through gaps in the seed", () => {
    expect(ema([null, null, 1, 2, 3], 3)).toEqual([null, null, null, null, 2]);
    expect(ema([1, null, 3, 4], 2)).toEqual([null, null, null, null]);
  });

  it("average volume excludes the current bar", () => {
    const b = [10, 10, 10, 40].map((v, i) => ({
      timestamp: String(i),
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: v,
    }));
    expect(averageVolume(b, 3)[3]).toBe(10);
    expect(relativeVolume(b, 3)[3]).toBe(4);
  });

  it("VWAP of constant typical price equals that price", () => {
    const b = Array.from({ length: 5 }, (_, i) => ({
      timestamp: String(i),
      open: 10,
      high: 12,
      low: 8,
      close: 10,
      volume: 100 + i,
    }));
    expect(vwap(b, 3)[4]).toBeCloseTo(10, 10);
  });

  it("relative strength is zero when stock tracks benchmark", () => {
    const s = [100, 110, 121];
    expect(relativeStrength(s, s, 2)[2]).toBeCloseTo(0, 12);
    expect(relativeStrength([100, 100, 130], [100, 100, 110], 2)[2]).toBeCloseTo(130 / 110 - 1, 12);
  });

  it("rejects invalid periods", () => {
    expect(() => sma([1, 2], 0)).toThrow(RangeError);
    expect(() => macd([1, 2, 3], 26, 12)).toThrow(RangeError);
  });
});
