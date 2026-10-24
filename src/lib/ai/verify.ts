import type { StockAnalysis } from "../analysis/pipeline";
import type { EvidencePack } from "./evidence";
import type { StockRecommendation } from "./schemas";

/**
 * Hallucination protection for AI stock output. The backend accepts an AI
 * recommendation only if:
 *   1. every score equals the deterministic score;
 *   2. the recommendation is not more bullish than the deterministic one;
 *   3. entry / stop / targets / R:R are absent when no validated plan
 *      exists, and match the plan when one does;
 *   4. every cited evidence id exists in the evidence pack;
 *   5. every number written in prose can be traced to the evidence pack;
 *   6. no certainty language ("guaranteed", "sure-shot" …) is used;
 *   7. the underlying data is fresh.
 */

const BULLISHNESS: Record<StockRecommendation["recommendation"], number> = {
  AVOID: 0,
  WATCH: 1,
  BUY_ON_BREAKOUT: 2,
  BUY_ON_RETEST: 2,
  BUY_BREAKOUT: 3,
};

export const BANNED_PHRASES = ["guaranteed", "sure-shot", "sure shot", "no-risk", "risk-free", "risk free", "can't lose", "cannot lose", "100% breakout", "definitely will"];

export interface VerificationResult {
  accepted: boolean;
  issues: string[];
}

const close = (a: number, b: number, relTol: number, absTol = 0.01) => Math.abs(a - b) <= Math.max(absTol, Math.abs(b) * relTol);

/** Numbers that appear in free text, ignoring list markers and years-as-labels such as FY2026. */
export function extractNumbers(text: string): number[] {
  const cleaned = text.replace(/\bFY\s?\d{2,4}(-Q[1-4])?\b/gi, " ").replace(/\b(Q[1-4]|H[12])\b/g, " ");
  const out: number[] = [];
  for (const m of cleaned.matchAll(/(?<![A-Za-z])[-+]?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|(?<![A-Za-z])[-+]?\d+(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Small integers are allowed in prose ("3 catalysts", "50-day", "14-period"). */
const ALLOWED_FREE_NUMBERS = new Set([0, 1, 2, 3, 4, 5, 9, 10, 12, 14, 15, 20, 26, 35, 40, 50, 63, 100, 200]);

export function verifyStockRecommendation(ai: StockRecommendation, analysis: StockAnalysis, evidence: EvidencePack, opts: { now?: number; maxAgeHours?: number } = {}): VerificationResult {
  const issues: string[] = [];
  if (ai.symbol !== analysis.symbol) issues.push(`symbol mismatch: ${ai.symbol} ≠ ${analysis.symbol}`);

  const s = analysis.score;
  const catalystPart = s.components.filter((c) => c.name.startsWith("Catalyst")).reduce((t, c) => t + c.points, 0);
  const globalPart = s.components.filter((c) => c.name.startsWith("Global")).reduce((t, c) => t + c.points, 0);
  const scores: [string, number, number][] = [
    ["fundamentalScore", ai.fundamentalScore, s.fundamental],
    ["technicalScore", ai.technicalScore, s.technical],
    ["catalystScore", ai.catalystScore, catalystPart],
    ["globalAlignmentScore", ai.globalAlignmentScore, globalPart],
    ["valuationRiskScore", ai.valuationRiskScore, s.valuationRisk],
    ["totalScore", ai.totalScore, s.total],
  ];
  for (const [name, got, want] of scores) {
    if (!close(got, want, 0, 0.05)) issues.push(`${name} ${got} does not match deterministic ${want.toFixed(2)}`);
  }

  if (BULLISHNESS[ai.recommendation] > BULLISHNESS[analysis.recommendation]) {
    issues.push(`recommendation ${ai.recommendation} is more bullish than deterministic ${analysis.recommendation}`);
  }
  if (analysis.recommendation === "AVOID" && ai.recommendation !== "AVOID") {
    issues.push("a rejected / avoid stock cannot be upgraded");
  }

  const plan = analysis.breakout.plan;
  const levels: [string, number | null, number | undefined][] = [
    ["entryLow", ai.entryLow, plan?.entryLow],
    ["entryHigh", ai.entryHigh, plan?.entryHigh],
    ["stopLoss", ai.stopLoss, plan?.stopLoss],
    ["target1", ai.target1, plan?.target1],
    ["target2", ai.target2, plan?.target2],
    ["target3", ai.target3, plan?.target3],
    ["riskReward", ai.riskReward, plan?.riskReward],
  ];
  for (const [name, got, want] of levels) {
    if (got === null) continue;
    if (want === undefined) issues.push(`${name} given without a validated trade plan`);
    else if (!close(got, want, 0.005)) issues.push(`${name} ${got} does not match computed ${want}`);
  }
  if (ai.stopLoss !== null && ai.entryLow !== null && ai.stopLoss >= ai.entryLow) issues.push("stop-loss is not below entry");
  if (ai.target1 !== null && ai.entryHigh !== null && ai.target1 <= ai.entryHigh) issues.push("target 1 is not above entry");

  const ids = new Set(evidence.items.map((i) => i.id));
  const cited = [...ai.sourceReferences, ...ai.supportingEvidence.flatMap((e) => e.evidenceIds)];
  for (const id of cited) if (!ids.has(id)) issues.push(`cites unknown evidence id "${id}"`);
  if (ai.supportingEvidence.some((e) => e.evidenceIds.length === 0)) issues.push("a supporting claim has no evidence reference");

  const known = evidence.items.flatMap((i) => (typeof i.value === "number" ? [i.value] : typeof i.value === "string" ? extractNumbers(i.value) : []));
  const prose = [ai.summary, ...ai.supportingEvidence.map((e) => e.claim), ...ai.riskFactors].join("\n");
  for (const n of extractNumbers(prose)) {
    if (ALLOWED_FREE_NUMBERS.has(Math.abs(n))) continue;
    // Accept a value as written, or as a percentage of a fraction (0.05 → 5%).
    const traced = known.some((k) => close(n, k, 0.01, 0.051) || close(n, k * 100, 0.01, 0.051));
    if (!traced) issues.push(`number ${n} in text is not in the evidence`);
  }

  const lower = prose.toLowerCase();
  for (const p of BANNED_PHRASES) if (lower.includes(p)) issues.push(`uses certainty language: "${p}"`);

  const now = opts.now ?? Date.now();
  const maxAge = (opts.maxAgeHours ?? 100) * 3_600_000;
  if (!analysis.asOf || now - Date.parse(analysis.asOf) > maxAge) issues.push("underlying price data is stale");

  return { accepted: issues.length === 0, issues };
}
