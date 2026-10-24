import type { Bar } from "../types";

/**
 * Deterministic synthetic bar builders for unit tests and the labelled demo
 * mode. These never represent a real instrument.
 */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateAt(i: number, start = Date.UTC(2025, 0, 1)) {
  return new Date(start + i * 86_400_000).toISOString().slice(0, 10);
}

export function bar(i: number, close: number, opts: Partial<Bar> & { range?: number } = {}): Bar {
  const range = opts.range ?? close * 0.01;
  return {
    timestamp: opts.timestamp ?? dateAt(i),
    open: opts.open ?? close,
    high: opts.high ?? close + range / 2,
    low: opts.low ?? close - range / 2,
    close,
    volume: opts.volume ?? 1_000_000,
    complete: opts.complete ?? true,
  };
}

/** Steady uptrend so price sits above its 200-DMA. */
export function uptrend(count: number, start = 100, dailyPct = 0.15, seed = 7): Bar[] {
  const rnd = mulberry32(seed);
  const out: Bar[] = [];
  let c = start;
  for (let i = 0; i < count; i++) {
    c = c * (1 + dailyPct / 100 + (rnd() - 0.5) * 0.004);
    out.push(bar(i, c, { range: c * 0.015, volume: 1_000_000 + Math.floor(rnd() * 100_000) }));
  }
  return out;
}

/**
 * Appends a tight base with higher lows and contracting volume and range
 * just below `ceiling`.
 */
export function appendBase(bars: Bar[], sessions: number, ceiling: number, depthPct = 6): Bar[] {
  const out = [...bars];
  const floor = ceiling * (1 - depthPct / 100);
  for (let k = 0; k < sessions; k++) {
    const i = out.length;
    const progress = k / (sessions - 1);
    const low = floor + (ceiling * 0.985 - floor) * progress * 0.9;
    const high = k % 4 === 1 ? ceiling : Math.min(ceiling * 0.995, low + (ceiling - floor) * (1 - progress * 0.6));
    const close = (low + high) / 2 + (high - low) * 0.2;
    out.push({
      timestamp: dateAt(i),
      open: (low + high) / 2,
      high,
      low,
      close: Math.min(close, ceiling * 0.99),
      volume: Math.round(800_000 * (1 - progress * 0.5)),
      complete: true,
    });
  }
  return out;
}

export function appendBar(bars: Bar[], b: Omit<Bar, "timestamp">): Bar[] {
  return [...bars, { ...b, timestamp: dateAt(bars.length) }];
}

export function flatBenchmark(length: number, level = 20000): number[] {
  return Array.from({ length }, () => level);
}
