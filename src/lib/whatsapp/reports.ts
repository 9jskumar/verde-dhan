import type { StockAnalysis } from "../analysis/pipeline";
import type { ResearchSnapshot } from "../data/demo-research";
import type { CommodityQuote, FxQuote, IndexQuote } from "../providers/types";
import { sanitizeTemplateParam } from "./client";

/**
 * Builds template body parameters for the scheduled WhatsApp reports.
 * Template wording (approved in Meta Business Manager) is documented in
 * docs/WHATSAPP_TEMPLATES.md; only the variable parts are produced here.
 * Every value comes from stored, sourced data; missing values say so.
 */

export type ReportType = "GLOBAL_PREMARKET" | "INDIA_PREMARKET" | "DAILY_CLOSE" | "EXCEPTIONAL_ALERT";

export const TEMPLATE_FOR: Record<ReportType, string> = {
  GLOBAL_PREMARKET: "vd_global_premarket",
  INDIA_PREMARKET: "vd_india_premarket",
  DAILY_CLOSE: "vd_daily_close",
  EXCEPTIONAL_ALERT: "vd_exceptional_alert",
};

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const px = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : v.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const demoTag = (isDemo: boolean) => (isDemo ? "[DEMO, synthetic data] " : "");

export function formatIstDate(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(d);
}

function planLine(a: StockAnalysis): string {
  const p = a.breakout.plan;
  if (!p) return `${a.symbol} ${a.score.total.toFixed(0)}/100 ${a.recommendation} (no validated levels)`;
  return `${a.symbol} ${a.score.total.toFixed(0)}/100 ${a.recommendation} entry ${px(p.entryLow)}-${px(p.entryHigh)} SL ${px(p.stopLoss)} T1 ${px(p.target1)} T2 ${px(p.target2)} R:R ${p.riskReward}`;
}

export interface MarketInputs {
  india: IndexQuote[];
  global: IndexQuote[];
  fx: FxQuote[];
  commodities: CommodityQuote[];
}

export function globalPremarketParams(date: Date, m: MarketInputs, research: ResearchSnapshot | null, isDemo: boolean): string[] {
  const us = m.global.filter((q) => ["SPX", "NDX", "DJI"].includes(q.symbol)).map((q) => `${q.name} ${pct(q.percentageChange)}`).join(", ");
  const eu = m.global.filter((q) => ["FTSE", "DAX"].includes(q.symbol)).map((q) => `${q.name} ${pct(q.percentageChange)}`).join(", ");
  const asia = m.global.filter((q) => q.symbol === "N225").map((q) => `${q.name} ${pct(q.percentageChange)} (${q.marketStatus.toLowerCase()})`).join(", ");
  const fx = m.fx.filter((q) => ["USDINR", "EURUSD", "USDJPY"].includes(q.pair)).map((q) => `${q.pair} ${px(q.mid)} ${pct(q.percentageChange)}`).join(", ");
  const cmd = m.commodities.filter((q) => ["BRENT", "XAU"].includes(q.instrument)).map((q) => `${q.instrument} ${pct(q.percentageChange)}`).join(", ");
  const g = research?.globalImpact;
  const outlook = g
    ? `Global sentiment ${g.sentiment.replace("_", "-").toLowerCase()}. Tailwinds: ${g.beneficiaries.slice(0, 3).map((s) => s.sector).join(", ") || "none"}. Pressure: ${g.underPressure.slice(0, 3).map((s) => s.sector).join(", ") || "none"}.`
    : "Global impact analysis unavailable.";
  return [
    `${demoTag(isDemo)}${formatIstDate(date)}`,
    `US: ${us || "n/a"} | Europe: ${eu || "n/a"} | Asia: ${asia || "n/a"}`,
    `FX: ${fx || "n/a"} | Commodities: ${cmd || "n/a"}`,
    outlook,
  ].map((p) => sanitizeTemplateParam(p));
}

export function indiaPremarketParams(date: Date, research: ResearchSnapshot): string[] {
  const watch = research.analyses.filter((a) => a.breakout.stage === "EARLY" && a.recommendation !== "AVOID").slice(0, 5);
  const retests = research.analyses.filter((a) => a.recommendation === "BUY_ON_RETEST").slice(0, 3);
  const risks = research.analyses.filter((a) => a.score.rejections.length).slice(0, 3).map((a) => `${a.symbol}: ${a.score.rejections.join("/").toLowerCase().replace(/_/g, " ")}`);
  return [
    `${demoTag(research.mode === "demo")}${formatIstDate(date)}`,
    watch.length ? watch.map((a) => `${a.symbol} near ${px(a.breakout.resistance)}`).join("; ") : "No early-breakout setups qualified",
    retests.length ? retests.map(planLine).join("; ") : "No qualifying retests",
    risks.length ? risks.join("; ") : "No new risk flags",
  ].map((p) => sanitizeTemplateParam(p));
}

export function dailyCloseParams(date: Date, research: ResearchSnapshot, m: MarketInputs): string[] {
  const idx = m.india.map((q) => `${q.name} ${px(q.lastValue)} ${pct(q.percentageChange)}`).join(", ");
  const sectors = research.sectors.slice(0, 2).map((s) => `${s.sector} ${pct(s.avgChangePct)}`).join(", ");
  const confirmations = research.analyses.filter((a) => a.breakout.stage === "CONFIRMED" && a.recommendation !== "AVOID").map((a) => a.symbol);
  return [
    `${demoTag(research.mode === "demo")}${formatIstDate(date)}`,
    `${idx || "Index data n/a"}. Leading sectors: ${sectors || "n/a"}`,
    research.top3.length ? research.top3.map(planLine).join("; ") : "No stock met all Top 3 criteria today",
    research.top10.length ? research.top10.map((a, i) => `${i + 1}. ${a.symbol} ${a.score.total.toFixed(0)}`).join(", ") : "No qualified opportunities today",
    `Confirmed breakouts: ${confirmations.join(", ") || "none"}. Global: ${research.globalImpact?.sentiment.replace("_", "-").toLowerCase() ?? "n/a"}`,
  ].map((p) => sanitizeTemplateParam(p));
}

/**
 * Exceptional alerts fire only on configured, meaningful thresholds — never
 * on every tick. Returns null when nothing qualifies.
 */
export interface AlertThresholds {
  minScoreForBreakoutAlert: number;
  indexMovePct: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = { minScoreForBreakoutAlert: 75, indexMovePct: 2 };

export function exceptionalAlertParams(research: ResearchSnapshot, m: MarketInputs, t: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): { key: string; params: string[] } | null {
  const strongBreakout = research.analyses.find((a) => a.breakout.stage === "CONFIRMED" && a.score.total >= t.minScoreForBreakoutAlert && a.recommendation === "BUY_BREAKOUT");
  if (strongBreakout) {
    return {
      key: `breakout:${strongBreakout.symbol}:${strongBreakout.asOf?.slice(0, 10)}`,
      params: [`${demoTag(strongBreakout.isDemo)}Confirmed breakout`, planLine(strongBreakout), `Evidence: score ${strongBreakout.score.total.toFixed(0)}/100, rel. volume ${strongBreakout.technical?.relativeVolume ?? "n/a"}x`].map((p) => sanitizeTemplateParam(p)),
    };
  }
  const bigMove = [...m.india, ...m.global].find((q) => q.percentageChange !== null && Math.abs(q.percentageChange) >= t.indexMovePct);
  if (bigMove) {
    return {
      key: `index:${bigMove.symbol}:${bigMove.timestamp.slice(0, 10)}`,
      params: [`${demoTag(bigMove.isDemo)}Large index move`, `${bigMove.name} ${pct(bigMove.percentageChange)} at ${px(bigMove.lastValue)}`, `Source: ${bigMove.source}, as of ${bigMove.timestamp}`].map((p) => sanitizeTemplateParam(p)),
    };
  }
  return null;
}
