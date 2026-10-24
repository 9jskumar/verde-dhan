/**
 * Core numeric types for the deterministic quant engine.
 *
 * Every series is aligned to the input bars: index i of an indicator output
 * corresponds to bar i. Values that cannot be computed yet (warm-up period,
 * missing inputs) are `null`, never 0 and never NaN, so downstream code can't
 * mistake "unknown" for a real reading.
 */

export interface Bar {
  /** ISO-8601 timestamp of the bar open (daily bars: the session date). */
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Split/dividend adjusted close where the provider supplies it. */
  adjustedClose?: number | null;
  volume: number;
  /**
   * True when the bar is final. Intraday / in-progress candles must be
   * flagged `false` so confirmed daily signals are never derived from them.
   */
  complete?: boolean;
}

export type Series = (number | null)[];

export function last<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

/** Last non-null value of a series. */
export function lastValue(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

export function round(value: number | null, dp = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/** Only completed bars are used for confirmed daily signals. */
export function completedBars(bars: readonly Bar[]): Bar[] {
  return bars.filter((b) => b.complete !== false);
}

/**
 * Use the adjusted close series when every bar carries one; otherwise fall
 * back to raw closes. Mixing adjusted and unadjusted values in one series
 * would create artificial gaps on split/bonus dates, so it's all or nothing.
 */
export function priceSeries(bars: readonly Bar[], useAdjusted = true): number[] {
  if (useAdjusted && bars.length > 0 && bars.every((b) => typeof b.adjustedClose === "number")) {
    return bars.map((b) => b.adjustedClose as number);
  }
  return bars.map((b) => b.close);
}
