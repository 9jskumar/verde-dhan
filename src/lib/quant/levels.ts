import type { Bar } from "./types";

/**
 * Support / resistance from swing pivots.
 *
 * A pivot high at bar i is a bar whose high is the strict maximum of the
 * window [i-k, i+k]; pivot lows are defined symmetrically. Pivots within
 * `tolerancePct` of each other are clustered into a single level, and the
 * level's strength is the number of touches. Pivots need k bars on each
 * side, so the latest k bars can never form one (no look-ahead).
 */

export interface PriceLevel {
  price: number;
  touches: number;
  lastTouchIndex: number;
  kind: "support" | "resistance";
}

export interface LevelOptions {
  lookback?: number;
  pivotWindow?: number;
  tolerancePct?: number;
}

export function pivots(bars: readonly Bar[], k: number) {
  const highs: { index: number; price: number }[] = [];
  const lows: { index: number; price: number }[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j]!.high >= bars[i]!.high) isHigh = false;
      if (bars[j]!.low <= bars[i]!.low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: bars[i]!.high });
    if (isLow) lows.push({ index: i, price: bars[i]!.low });
  }
  return { highs, lows };
}

function cluster(
  points: { index: number; price: number }[],
  tolerancePct: number,
  kind: PriceLevel["kind"],
): PriceLevel[] {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const levels: { prices: number[]; last: number }[] = [];
  for (const p of sorted) {
    const current = levels[levels.length - 1];
    const mean = current ? current.prices.reduce((s, v) => s + v, 0) / current.prices.length : 0;
    if (current && Math.abs(p.price - mean) / mean <= tolerancePct / 100) {
      current.prices.push(p.price);
      current.last = Math.max(current.last, p.index);
    } else {
      levels.push({ prices: [p.price], last: p.index });
    }
  }
  return levels.map((l) => ({
    price: kind === "resistance" ? Math.max(...l.prices) : Math.min(...l.prices),
    touches: l.prices.length,
    lastTouchIndex: l.last,
    kind,
  }));
}

export interface SupportResistance {
  support: PriceLevel | null;
  resistance: PriceLevel | null;
  allLevels: PriceLevel[];
}

/**
 * Nearest resistance above and support below the latest close. Prefers
 * levels with ≥2 touches; falls back to the strongest single pivot.
 */
export function supportResistance(bars: readonly Bar[], opts: LevelOptions = {}): SupportResistance {
  const { lookback = 120, pivotWindow = 3, tolerancePct = 1.5 } = opts;
  if (bars.length < pivotWindow * 2 + 1) return { support: null, resistance: null, allLevels: [] };
  const window = bars.slice(-lookback);
  const offset = bars.length - window.length;
  const { highs, lows } = pivots(window, pivotWindow);
  const shift = (p: { index: number; price: number }) => ({ ...p, index: p.index + offset });
  const res = cluster(highs.map(shift), tolerancePct, "resistance");
  const sup = cluster(lows.map(shift), tolerancePct, "support");
  const close = bars[bars.length - 1]!.close;

  const pick = (levels: PriceLevel[], above: boolean) => {
    const candidates = levels.filter((l) => (above ? l.price > close : l.price < close));
    const byDistance = (a: PriceLevel, b: PriceLevel) => Math.abs(a.price - close) - Math.abs(b.price - close);
    const strong = candidates.filter((l) => l.touches >= 2).sort(byDistance);
    return strong[0] ?? candidates.sort(byDistance)[0] ?? null;
  };

  return { support: pick(sup, false), resistance: pick(res, true), allLevels: [...sup, ...res] };
}
