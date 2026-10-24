import { round } from "./types";

/**
 * Recommendation outcome tracking. Rules (documented in TESTING_PLAN.md):
 *  - Entry triggers on the first session whose high reaches entry_low
 *    (for BUY_BREAKOUT the reference price is used when no plan exists).
 *  - After entry, a session whose low touches the stop is STOPPED_OUT; if
 *    both stop and a target fall inside the same session, the stop is
 *    assumed to have hit first (conservative).
 *  - The highest target reached by a session high is recorded.
 *  - Positions still open after `maxHoldingDays` sessions are EXPIRED at
 *    that session's close; untriggered entries expire as
 *    ENTRY_NOT_TRIGGERED after `entryWindowDays`.
 */

export interface RecommendationLevels {
  recommendedAt: string; // date the recommendation was made (after close)
  referencePrice: number;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
}

export interface DailyPrice {
  date: string;
  high: number;
  low: number;
  close: number;
}

export type OutcomeStatus = "OPEN" | "ENTRY_NOT_TRIGGERED" | "TARGET_1_HIT" | "TARGET_2_HIT" | "TARGET_3_HIT" | "STOPPED_OUT" | "EXPIRED";

export interface Outcome {
  status: OutcomeStatus;
  entryTriggeredAt: string | null;
  entryPrice: number | null;
  exitAt: string | null;
  exitPrice: number | null;
  returnPct: number | null;
  maxFavourableExcursionPct: number | null;
  maxAdverseExcursionPct: number | null;
  holdingDays: number | null;
}

export function evaluateOutcome(
  rec: RecommendationLevels,
  prices: readonly DailyPrice[],
  opts: { entryWindowDays?: number; maxHoldingDays?: number } = {},
): Outcome {
  const { entryWindowDays = 10, maxHoldingDays = 60 } = opts;
  const after = [...prices].filter((p) => p.date > rec.recommendedAt.slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date));
  const entryLevel = rec.entryLow ?? rec.referencePrice;
  const base: Outcome = {
    status: "OPEN",
    entryTriggeredAt: null,
    entryPrice: null,
    exitAt: null,
    exitPrice: null,
    returnPct: null,
    maxFavourableExcursionPct: null,
    maxAdverseExcursionPct: null,
    holdingDays: null,
  };

  const entryIdx = after.findIndex((p, i) => i < entryWindowDays && p.high >= entryLevel);
  if (entryIdx < 0) {
    return after.length >= entryWindowDays ? { ...base, status: "ENTRY_NOT_TRIGGERED" } : base;
  }
  const entryPrice = entryLevel;
  const entryDay = after[entryIdx]!;
  let mfe = 0;
  let mae = 0;
  let best: OutcomeStatus = "OPEN";
  const targets: [OutcomeStatus, number | null][] = [
    ["TARGET_3_HIT", rec.target3],
    ["TARGET_2_HIT", rec.target2],
    ["TARGET_1_HIT", rec.target1],
  ];
  const rank = (s: OutcomeStatus) => ["OPEN", "TARGET_1_HIT", "TARGET_2_HIT", "TARGET_3_HIT"].indexOf(s);

  for (let i = entryIdx; i < after.length; i++) {
    const p = after[i]!;
    const held = i - entryIdx + 1;
    mfe = Math.max(mfe, (p.high / entryPrice - 1) * 100);
    mae = Math.min(mae, (p.low / entryPrice - 1) * 100);
    if (rec.stopLoss !== null && p.low <= rec.stopLoss) {
      return {
        ...base,
        status: best === "OPEN" ? "STOPPED_OUT" : best,
        entryTriggeredAt: entryDay.date,
        entryPrice,
        exitAt: p.date,
        exitPrice: rec.stopLoss,
        returnPct: round((rec.stopLoss / entryPrice - 1) * 100, 3),
        maxFavourableExcursionPct: round(mfe, 3),
        maxAdverseExcursionPct: round(mae, 3),
        holdingDays: held,
      };
    }
    for (const [status, level] of targets) {
      if (level !== null && p.high >= level && rank(status) > rank(best)) {
        best = status;
        break;
      }
    }
    if (best === "TARGET_3_HIT" || held >= maxHoldingDays) {
      const exitPrice = best === "TARGET_3_HIT" ? rec.target3! : p.close;
      return {
        ...base,
        status: best === "OPEN" ? "EXPIRED" : best,
        entryTriggeredAt: entryDay.date,
        entryPrice,
        exitAt: p.date,
        exitPrice,
        returnPct: round((exitPrice / entryPrice - 1) * 100, 3),
        maxFavourableExcursionPct: round(mfe, 3),
        maxAdverseExcursionPct: round(mae, 3),
        holdingDays: held,
      };
    }
  }
  const lastClose = after[after.length - 1]!.close;
  return {
    ...base,
    status: best,
    entryTriggeredAt: entryDay.date,
    entryPrice,
    returnPct: round((lastClose / entryPrice - 1) * 100, 3),
    maxFavourableExcursionPct: round(mfe, 3),
    maxAdverseExcursionPct: round(mae, 3),
    holdingDays: after.length - entryIdx,
  };
}
