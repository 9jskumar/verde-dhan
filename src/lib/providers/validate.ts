import { z } from "zod";
import { DataValidationError, type HistoricalPrice } from "./types";

/** Normalised-record validation and data-quality checks shared by adapters and jobs. */

const positive = z.number().finite().positive();

export const historicalPriceSchema = z
  .object({
    timestamp: z.string().min(8),
    open: positive,
    high: positive,
    low: positive,
    close: positive,
    adjustedClose: positive.nullable(),
    volume: z.number().finite().nonnegative(),
    complete: z.boolean(),
  })
  .refine((b) => b.high >= b.low && b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close), {
    message: "OHLC inconsistent (high/low do not bound open/close)",
  });

export interface QualityIssue {
  check: "DUPLICATE_CANDLE" | "MISSING_SESSION" | "STALE" | "INVALID_OHLC" | "OUT_OF_ORDER" | "PRICE_JUMP" | "CURRENCY_MISMATCH";
  severity: "INFO" | "WARNING" | "ERROR";
  detail: string;
}

/**
 * Validates a bar series and reports data-quality issues. Bars that fail
 * schema validation throw; softer issues (gaps, suspicious jumps that may be
 * an unadjusted corporate action) are returned for logging.
 */
export function checkBars(
  provider: string,
  bars: readonly HistoricalPrice[],
  opts: { tradingDays?: readonly string[]; maxJumpPct?: number } = {},
): QualityIssue[] {
  const errors: string[] = [];
  bars.forEach((b, i) => {
    const r = historicalPriceSchema.safeParse(b);
    if (!r.success) errors.push(`bar ${i} (${b.timestamp}): ${r.error.issues.map((x) => x.message).join(", ")}`);
  });
  if (errors.length) throw new DataValidationError(provider, errors);

  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const day = b.timestamp.slice(0, 10);
    if (seen.has(day)) issues.push({ check: "DUPLICATE_CANDLE", severity: "ERROR", detail: day });
    seen.add(day);
    if (i > 0) {
      const prev = bars[i - 1]!;
      if (b.timestamp <= prev.timestamp) issues.push({ check: "OUT_OF_ORDER", severity: "ERROR", detail: `${prev.timestamp} → ${b.timestamp}` });
      const jump = Math.abs(b.open / prev.close - 1) * 100;
      if (jump > (opts.maxJumpPct ?? 25)) {
        issues.push({
          check: "PRICE_JUMP",
          severity: "WARNING",
          detail: `${day}: ${jump.toFixed(1)}% gap — check for an unadjusted split/bonus before using`,
        });
      }
    }
  }
  if (opts.tradingDays) {
    for (const d of opts.tradingDays) if (!seen.has(d)) issues.push({ check: "MISSING_SESSION", severity: "WARNING", detail: d });
  }
  return issues;
}

/** True if the record is older than `maxAgeMs` relative to `now`. */
export function isStale(timestamp: string, maxAgeMs: number, now = Date.now()): boolean {
  const t = Date.parse(timestamp);
  return !Number.isFinite(t) || now - t > maxAgeMs;
}

/** Sorts ascending and drops exact-duplicate sessions (keeps the last seen). */
export function dedupeBars<T extends { timestamp: string }>(bars: readonly T[]): T[] {
  const byTs = new Map<string, T>();
  for (const b of bars) byTs.set(b.timestamp, b);
  return [...byTs.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * A daily NSE/BSE candle is final once the session has closed. The
 * exchanges close at 15:30 IST; we wait until 16:00 IST to allow for
 * closing-auction prints.
 */
export function isDailyCandleComplete(candleDate: string, now = new Date()): boolean {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const today = ist.toISOString().slice(0, 10);
  const day = candleDate.slice(0, 10);
  return day < today || (day === today && ist.getUTCHours() >= 16);
}
