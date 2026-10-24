import { round } from "./types";

/**
 * Global market impact engine (Part 10).
 *
 * Transparent, rule-based mapping from observed global moves to Indian
 * sector implications. Rules live in the `global_market_impact_rules` table
 * so they can be reviewed and edited; the defaults are seeded by migration.
 *
 * These are economic mechanisms and historical tendencies, NOT causal
 * guarantees. Every output carries the rule ids and mechanisms that
 * produced it, so the AI layer and the user can see why.
 */

export type MovementType = "UP" | "DOWN";
export type ImpactDirection = "POSITIVE" | "NEGATIVE";
export type RuleConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface ImpactRule {
  id: string;
  globalInstrument: string; // canonical key, e.g. "BRENT", "USDINR", "NDX"
  movementType: MovementType;
  /** Minimum absolute % move for the rule to fire. */
  thresholdPct: number;
  affectedSector: string;
  impactDirection: ImpactDirection;
  impactMechanism: string;
  confidence: RuleConfidence;
  applicableConditions?: string | null;
  sourceReferences?: string[];
}

export interface InstrumentMove {
  instrument: string;
  changePct: number | null;
  asOf: string;
  source: string;
}

export interface SectorImpact {
  sector: string;
  /** −1 … +1 */
  score: number;
  drivers: { ruleId: string; instrument: string; changePct: number; mechanism: string; confidence: RuleConfidence; direction: ImpactDirection }[];
}

export interface GlobalImpactResult {
  sentiment: "RISK_ON" | "RISK_OFF" | "MIXED" | "INSUFFICIENT_DATA";
  sentimentScore: number | null;
  beneficiaries: SectorImpact[];
  underPressure: SectorImpact[];
  bySector: Record<string, SectorImpact>;
  missingInstruments: string[];
  disclaimer: string;
}

const CONFIDENCE_WEIGHT: Record<RuleConfidence, number> = { LOW: 0.3, MEDIUM: 0.6, HIGH: 1 };
/** Equity indices used for the headline risk-on / risk-off read. */
export const SENTIMENT_INSTRUMENTS = ["SPX", "NDX", "DJI", "FTSE", "DAX", "N225"] as const;

export function evaluateGlobalImpact(moves: readonly InstrumentMove[], rules: readonly ImpactRule[]): GlobalImpactResult {
  const byInstrument = new Map(moves.filter((m) => m.changePct !== null).map((m) => [m.instrument, m]));
  const needed = new Set(rules.map((r) => r.globalInstrument));
  const missingInstruments = [...needed].filter((i) => !byInstrument.has(i)).sort();

  const raw = new Map<string, { sum: number; weight: number; drivers: SectorImpact["drivers"] }>();
  for (const rule of rules) {
    const move = byInstrument.get(rule.globalInstrument);
    if (!move || move.changePct === null) continue;
    const ch = move.changePct;
    const fires = rule.movementType === "UP" ? ch >= rule.thresholdPct : ch <= -rule.thresholdPct;
    if (!fires) continue;
    const w = CONFIDENCE_WEIGHT[rule.confidence];
    // Magnitude saturates at 3× the threshold so one extreme print can't dominate.
    const magnitude = Math.min(Math.abs(ch) / rule.thresholdPct, 3) / 3;
    const signed = (rule.impactDirection === "POSITIVE" ? 1 : -1) * magnitude * w;
    const entry = raw.get(rule.affectedSector) ?? { sum: 0, weight: 0, drivers: [] };
    entry.sum += signed;
    entry.weight += w;
    entry.drivers.push({
      ruleId: rule.id,
      instrument: rule.globalInstrument,
      changePct: ch,
      mechanism: rule.impactMechanism,
      confidence: rule.confidence,
      direction: rule.impactDirection,
    });
    raw.set(rule.affectedSector, entry);
  }

  const bySector: Record<string, SectorImpact> = {};
  for (const [sector, e] of raw) {
    bySector[sector] = { sector, score: round(Math.max(-1, Math.min(1, e.sum / Math.max(e.weight, 1))), 3)!, drivers: e.drivers };
  }
  const sectors = Object.values(bySector);

  const eq = SENTIMENT_INSTRUMENTS.map((s) => byInstrument.get(s)?.changePct).filter((v): v is number => typeof v === "number");
  let sentiment: GlobalImpactResult["sentiment"] = "INSUFFICIENT_DATA";
  let sentimentScore: number | null = null;
  if (eq.length >= 3) {
    sentimentScore = round(eq.reduce((s, v) => s + v, 0) / eq.length, 3);
    const ups = eq.filter((v) => v > 0).length;
    sentiment = sentimentScore! > 0.25 && ups >= eq.length * 0.66 ? "RISK_ON" : sentimentScore! < -0.25 && ups <= eq.length * 0.34 ? "RISK_OFF" : "MIXED";
  }

  return {
    sentiment,
    sentimentScore,
    beneficiaries: sectors.filter((s) => s.score > 0).sort((a, b) => b.score - a.score),
    underPressure: sectors.filter((s) => s.score < 0).sort((a, b) => a.score - b.score),
    bySector,
    missingInstruments,
    disclaimer:
      "Rule-based tendencies from sector economics and historical relationships; correlation is not causation and company-specific factors can dominate.",
  };
}
