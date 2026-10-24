import type { Bar, Series } from "./types";

/**
 * Technical indicator library.
 *
 * Conventions (documented in docs/QUANT_CONVENTIONS.md and verified against
 * TA-Lib 0.6 in indicators.test.ts):
 *  - SMA: arithmetic mean of the last `period` values.
 *  - EMA: alpha = 2 / (period + 1), seeded with the SMA of the first `period`
 *    values (first output at index period-1).
 *  - RSI: Wilder smoothing (alpha = 1/period), seeded with the simple average
 *    gain/loss of the first `period` changes (first output at index `period`).
 *  - ATR: Wilder smoothing of True Range. TR is defined from bar 1 (needs a
 *    previous close); first ATR at index `period` = mean(TR[1..period]).
 *  - ADX: Wilder's DMI. First ADX at index 2*period - 1.
 *  - Bollinger Bands: SMA ± k × population standard deviation.
 *  - MACD: EMA(fast) − EMA(slow), signal = EMA(signal) of MACD, histogram =
 *    MACD − signal.
 */

function assertPeriod(period: number) {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`period must be a positive integer, got ${period}`);
  }
}

export function sma(values: readonly number[], period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA over a series that may begin with nulls (e.g. the MACD line). */
export function ema(values: readonly (number | null)[], period: number): Series {
  assertPeriod(period);
  const out: Series = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  const start = values.findIndex((v) => v !== null);
  if (start < 0 || values.length - start < period) return out;
  let seed = 0;
  for (let i = start; i < start + period; i++) {
    const v = values[i];
    if (v === null || v === undefined) return out; // gaps inside the seed window
    seed += v;
  }
  let prev = seed / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) {
      out[i] = null;
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: readonly number[], period = 14): Series {
  assertPeriod(period);
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    if (ch > 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = rsiFrom(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  if (fast >= slow) throw new RangeError("fast period must be shorter than slow period");
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line: Series = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f === null || f === undefined || s === null || s === undefined ? null : f - s;
  });
  const signal = ema(line, signalPeriod);
  const histogram: Series = line.map((m, i) => {
    const s = signal[i];
    return m === null || s === null || s === undefined ? null : m - s;
  });
  return { macd: line, signal, histogram };
}

export function trueRange(bars: readonly Bar[]): Series {
  return bars.map((b, i) => {
    if (i === 0) return null;
    const prevClose = bars[i - 1]!.close;
    return Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
  });
}

export function atr(bars: readonly Bar[], period = 14): Series {
  assertPeriod(period);
  const tr = trueRange(bars);
  const out: Series = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i]!;
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

export interface AdxResult {
  adx: Series;
  plusDI: Series;
  minusDI: Series;
}

export function adx(bars: readonly Bar[], period = 14): AdxResult {
  assertPeriod(period);
  const n = bars.length;
  const plusDI: Series = new Array(n).fill(null);
  const minusDI: Series = new Array(n).fill(null);
  const adxOut: Series = new Array(n).fill(null);
  if (n < 2 * period) return { adx: adxOut, plusDI, minusDI };

  const tr = trueRange(bars);
  const pdm: number[] = new Array(n).fill(0);
  const mdm: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = bars[i]!.high - bars[i - 1]!.high;
    const down = bars[i - 1]!.low - bars[i]!.low;
    pdm[i] = up > down && up > 0 ? up : 0;
    mdm[i] = down > up && down > 0 ? down : 0;
  }

  // Wilder running sums seeded with the first `period - 1` values, matching
  // TA-Lib: the first DI is produced at index `period`.
  let sTR = 0;
  let sP = 0;
  let sM = 0;
  for (let i = 1; i < period; i++) {
    sTR += tr[i]!;
    sP += pdm[i]!;
    sM += mdm[i]!;
  }
  const dx: Series = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    sTR = sTR - sTR / period + tr[i]!;
    sP = sP - sP / period + pdm[i]!;
    sM = sM - sM / period + mdm[i]!;
    const p = sTR === 0 ? 0 : (100 * sP) / sTR;
    const m = sTR === 0 ? 0 : (100 * sM) / sTR;
    plusDI[i] = p;
    minusDI[i] = m;
    dx[i] = p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m);
  }

  const firstAdx = 2 * period - 1;
  let sum = 0;
  for (let i = period; i <= firstAdx; i++) sum += dx[i]!;
  let prev = sum / period;
  adxOut[firstAdx] = prev;
  for (let i = firstAdx + 1; i < n; i++) {
    prev = (prev * (period - 1) + dx[i]!) / period;
    adxOut[i] = prev;
  }
  return { adx: adxOut, plusDI, minusDI };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
  /** (upper − lower) / middle — used for volatility-contraction detection. */
  bandwidth: Series;
}

export function bollinger(closes: readonly number[], period = 20, k = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  const bandwidth: Series = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = middle[i]!;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (closes[j]! - m) ** 2;
    const sd = Math.sqrt(sq / period);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
    bandwidth[i] = m === 0 ? null : (2 * k * sd) / m;
  }
  return { upper, middle, lower, bandwidth };
}

/**
 * Rolling VWAP over `period` bars using the typical price (H+L+C)/3.
 * For daily bars this is an N-day anchored VWAP; a true intraday session
 * VWAP needs intraday bars and should be computed with `period` = bars in
 * the session.
 */
export function vwap(bars: readonly Bar[], period = 20): Series {
  assertPeriod(period);
  const out: Series = new Array(bars.length).fill(null);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    pv += ((b.high + b.low + b.close) / 3) * b.volume;
    vol += b.volume;
    if (i >= period) {
      const o = bars[i - period]!;
      pv -= ((o.high + o.low + o.close) / 3) * o.volume;
      vol -= o.volume;
    }
    if (i >= period - 1) out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

/**
 * Average volume of the `period` sessions *before* bar i (today excluded),
 * so a volume spike doesn't dilute its own baseline.
 */
export function averageVolume(bars: readonly Bar[], period = 20): Series {
  const out: Series = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i >= period) out[i] = sum / period;
    sum += bars[i]!.volume;
    if (i >= period) sum -= bars[i - period]!.volume;
  }
  return out;
}

export function relativeVolume(bars: readonly Bar[], period = 20): Series {
  const avg = averageVolume(bars, period);
  return bars.map((b, i) => {
    const a = avg[i];
    return a === null || a === undefined || a === 0 ? null : b.volume / a;
  });
}

/**
 * Relative strength vs a benchmark over `lookback` sessions:
 * (1 + stock return) / (1 + benchmark return) − 1.
 * Positive = outperforming. Both series must be date-aligned by the caller.
 */
export function relativeStrength(
  closes: readonly number[],
  benchmark: readonly number[],
  lookback = 63,
): Series {
  if (closes.length !== benchmark.length) {
    throw new RangeError("stock and benchmark series must be aligned and equal length");
  }
  return closes.map((c, i) => {
    if (i < lookback) return null;
    const c0 = closes[i - lookback]!;
    const b0 = benchmark[i - lookback]!;
    const b1 = benchmark[i]!;
    if (c0 <= 0 || b0 <= 0) return null;
    return c / c0 / (b1 / b0) - 1;
  });
}

/** Rolling highest high / lowest low over the previous `period` bars (bar i excluded). */
export function priorHigh(bars: readonly Bar[], period: number): Series {
  return bars.map((_, i) => {
    if (i < period) return null;
    let h = -Infinity;
    for (let j = i - period; j < i; j++) h = Math.max(h, bars[j]!.high);
    return h;
  });
}

export function priorLow(bars: readonly Bar[], period: number): Series {
  return bars.map((_, i) => {
    if (i < period) return null;
    let l = Infinity;
    for (let j = i - period; j < i; j++) l = Math.min(l, bars[j]!.low);
    return l;
  });
}
