import type { StockAnalysis } from "../analysis/pipeline";
import type { GlobalImpactResult } from "../quant/globalImpact";

/**
 * Evidence packs: the only facts the model is allowed to use. Every item
 * has a stable id the model must cite, a value, its source and timestamp.
 * Numbers in AI output are checked against the numeric values here.
 */

export interface EvidenceItem {
  id: string;
  label: string;
  value: number | string | boolean | null;
  source: string;
  asOf: string | null;
}

export interface EvidencePack {
  subject: string;
  generatedAt: string;
  isDemo: boolean;
  items: EvidenceItem[];
}

export function stockEvidence(a: StockAnalysis, extra: EvidenceItem[] = []): EvidencePack {
  const src = a.source;
  const asOf = a.asOf;
  const items: EvidenceItem[] = [];
  const push = (id: string, label: string, value: EvidenceItem["value"], source = src, when = asOf) =>
    items.push({ id, label, value, source, asOf: when });

  push("score.total", "Deterministic total score (/100)", a.score.total, "scoring-engine");
  push("score.fundamental", "Fundamental quality (/40)", a.score.fundamental, "scoring-engine");
  push("score.technical", "Technical strength (/35)", a.score.technical, "scoring-engine");
  push("score.catalyst_global", "Catalysts & global alignment (/15)", a.score.catalystGlobal, "scoring-engine");
  push("score.valuation_risk", "Valuation & risk (/10)", a.score.valuationRisk, "scoring-engine");
  push("score.classification", "Classification", a.score.classification, "scoring-engine");
  push("score.rejections", "Mandatory rejection flags", a.score.rejections.join(", ") || "none", "scoring-engine");
  push("score.missing", "Inputs missing from the model", a.score.missing.join("; ") || "none", "scoring-engine");
  push("recommendation", "Deterministic recommendation", a.recommendation, "scoring-engine");

  for (const c of a.score.components) {
    if (c.input !== null) push(`component.${slug(c.name)}`, c.name, c.input, "scoring-engine");
  }
  if (a.technical) {
    const t = a.technical;
    const tech: [string, string, number | null][] = [
      ["close", "Last completed close", t.close],
      ["sma50", "50-day SMA", t.sma50],
      ["sma200", "200-day SMA", t.sma200],
      ["ema20", "20-day EMA", t.ema20],
      ["rsi14", "RSI(14)", t.rsi14],
      ["macd_hist", "MACD histogram", t.macdHistogram],
      ["adx14", "ADX(14)", t.adx14],
      ["atr14", "ATR(14)", t.atr14],
      ["atr_pct", "ATR as % of price", t.atrPct],
      ["rel_volume", "Relative volume (vs 20-day avg)", t.relativeVolume],
      ["rel_strength", "Relative strength vs benchmark (63d, fraction)", t.relativeStrength],
      ["support", "Nearest support", t.support],
      ["resistance", "Nearest resistance", t.resistance],
      ["avg_traded_value", "Average traded value (20d, ₹)", t.averageTradedValue20d],
    ];
    for (const [id, label, v] of tech) push(`tech.${id}`, label, v);
  }
  push("breakout.stage", "Breakout stage", a.breakout.stage, a.breakout.version);
  for (const group of ["early", "confirmed", "retest"] as const) {
    for (const c of a.breakout.criteria[group]) {
      push(`breakout.${group}.${slug(c.name)}`, `${c.name} (${c.threshold})`, c.met === null ? "unknown" : `${c.met ? "met" : "not met"}${c.value !== null ? `; value ${c.value}` : ""}`, a.breakout.version);
    }
  }
  const p = a.breakout.plan;
  if (p) {
    push("plan.breakout_level", "Breakout level", p.breakoutLevel, a.breakout.version);
    push("plan.entry_low", "Entry zone low", p.entryLow, a.breakout.version);
    push("plan.entry_high", "Entry zone high", p.entryHigh, a.breakout.version);
    push("plan.stop_loss", "Stop-loss", p.stopLoss, a.breakout.version);
    push("plan.target_1", "Target 1", p.target1, a.breakout.version);
    push("plan.target_2", "Target 2", p.target2, a.breakout.version);
    push("plan.target_3", "Target 3", p.target3, a.breakout.version);
    push("plan.risk_reward", "Risk/reward to target 2", p.riskReward, a.breakout.version);
  }
  if (a.fundamentals) {
    const f = a.fundamentals;
    const basis = `${f.basis} ${f.periodType} ${f.latestPeriod}`;
    const fund: [string, string, number | null][] = [
      ["revenue_growth", "Revenue growth %", f.revenueGrowth],
      ["pat_growth", "PAT growth %", f.patGrowth],
      ["eps_growth", "EPS growth %", f.epsGrowth],
      ["revenue_cagr_3y", "Revenue 3y CAGR %", f.revenueCagr3y],
      ["ebitda_margin", "EBITDA margin %", f.ebitdaMargin],
      ["roe", "ROE %", f.roe],
      ["roce", "ROCE %", f.roce],
      ["debt_equity", "Debt/Equity", f.debtEquity],
      ["interest_coverage", "Interest coverage ×", f.interestCoverage],
      ["cfo_pat", "CFO/PAT", f.cfoPatRatio],
    ];
    for (const [id, label, v] of fund) push(`fund.${id}`, `${label} (${basis})`, v);
  }
  if (a.valuation) {
    push("val.pe", "P/E", a.valuation.pe);
    push("val.pb", "P/B", a.valuation.pb);
    push("val.peg", "PEG", a.valuation.peg);
    push("val.ev_ebitda", "EV/EBITDA", a.valuation.evEbitda);
  }
  items.push(...extra);
  return { subject: `${a.exchange}:${a.symbol} ${a.companyName}`, generatedAt: new Date().toISOString(), isDemo: a.isDemo, items };
}

export function globalEvidence(g: GlobalImpactResult, moves: { instrument: string; changePct: number | null; asOf: string; source: string }[]): EvidencePack {
  const items: EvidenceItem[] = moves.map((m) => ({ id: `move.${m.instrument}`, label: `${m.instrument} % change`, value: m.changePct, source: m.source, asOf: m.asOf }));
  items.push({ id: "global.sentiment", label: "Rule-based global sentiment", value: g.sentiment, source: "impact-engine", asOf: null });
  for (const s of Object.values(g.bySector)) {
    items.push({ id: `sector.${slug(s.sector)}`, label: `${s.sector} impact score (−1…+1)`, value: s.score, source: "impact-engine", asOf: null });
    for (const d of s.drivers) {
      items.push({ id: `rule.${d.ruleId}`, label: `Rule ${d.ruleId}: ${d.instrument} → ${s.sector} (${d.direction}, ${d.confidence} confidence): ${d.mechanism}`, value: d.changePct, source: "global_market_impact_rules", asOf: null });
    }
  }
  items.push({ id: "global.missing", label: "Instruments with no data", value: g.missingInstruments.join(", ") || "none", source: "impact-engine", asOf: null });
  return { subject: "Global market impact", generatedAt: new Date().toISOString(), isDemo: moves.some((m) => m.source === "demo"), items };
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function renderEvidence(pack: EvidencePack): string {
  return JSON.stringify(pack, null, 0);
}
