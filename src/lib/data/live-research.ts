import type { SupabaseClient } from "@supabase/supabase-js";
import { rankOpportunities, type StockAnalysis, topThree } from "../analysis/pipeline";
import type { GlobalImpactResult } from "../quant/globalImpact";
import type { CommodityQuote, FxQuote, IndexQuote } from "../providers/types";
import { GLOBAL_INDEX_KEYS, INDIA_INDEX_KEYS, INSTRUMENT_NAMES } from "../providers/types";
import type { ResearchSnapshot } from "./demo-research";

/**
 * Reads the latest stored research and market snapshot from Supabase. Works
 * with either a user-scoped client (RLS: authenticated read) or the service
 * client used by jobs.
 */

export async function loadLatestResearch(db: SupabaseClient): Promise<ResearchSnapshot | null> {
  const { data: latest } = await db.from("stock_analysis").select("analysis_date").order("analysis_date", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return null;
  const { data: rows, error } = await db
    .from("stock_analysis")
    .select("analysis_json, is_demo")
    .eq("analysis_date", latest.analysis_date)
    .order("total_score", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`could not load analysis: ${error.message}`);
  const analyses = (rows ?? []).map((r: { analysis_json: { analysis: StockAnalysis } }) => r.analysis_json.analysis).filter(Boolean);
  const { data: impact } = await db.from("global_impact_snapshots").select("result").order("computed_at", { ascending: false }).limit(1).maybeSingle();
  const { data: sectors } = await db.from("v_sector_performance").select("sector, avg_change_pct, constituents").order("avg_change_pct", { ascending: false });
  const top10 = rankOpportunities(analyses);
  return {
    mode: analyses.some((a) => a.isDemo) ? "demo" : "live",
    asOf: latest.analysis_date,
    analyses,
    top10,
    top3: topThree(top10),
    globalImpact: (impact?.result as GlobalImpactResult | undefined) ?? null,
    sectors: (sectors ?? []).map((s: { sector: string; avg_change_pct: number | null; constituents: number }) => ({ sector: s.sector, avgChangePct: Number(s.avg_change_pct ?? 0), constituents: s.constituents })),
  };
}

interface IndexRow { symbol: string; name: string; currency: string; timestamp: string; last_value: number; previous_close: number | null; absolute_change: number | null; percentage_change: number | null; day_high: number | null; day_low: number | null; market_status: IndexQuote["marketStatus"]; source: string; data_delay_seconds: number; created_at: string }
interface FxRow { pair: string; timestamp: string; bid: number | null; ask: number | null; mid: number; previous_close: number | null; percentage_change: number | null; source: string; data_delay_seconds: number; created_at: string }
interface CmdRow { instrument: string; timestamp: string; price: number; currency: string; unit: string; contract_type: CommodityQuote["contractType"]; previous_close: number | null; percentage_change: number | null; source: string; data_delay_seconds: number; created_at: string }

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadMarketSnapshot(db: SupabaseClient) {
  const [idx, fx, cmd] = await Promise.all([
    db.from("v_global_market_latest").select("*"),
    db.from("v_forex_latest").select("*"),
    db.from("v_commodities_latest").select("*"),
  ]);
  const indices: IndexQuote[] = ((idx.data ?? []) as IndexRow[]).map((r) => ({
    symbol: r.symbol,
    name: INSTRUMENT_NAMES[r.symbol] ?? r.name,
    currency: r.currency,
    timestamp: r.timestamp,
    lastValue: Number(r.last_value),
    previousClose: n(r.previous_close),
    absoluteChange: n(r.absolute_change),
    percentageChange: n(r.percentage_change),
    dayHigh: n(r.day_high),
    dayLow: n(r.day_low),
    marketStatus: r.market_status,
    source: r.source,
    isDemo: r.source === "demo",
    dataDelaySeconds: r.data_delay_seconds,
    fetchedAt: r.created_at,
  }));
  return {
    india: indices.filter((q) => (INDIA_INDEX_KEYS as readonly string[]).includes(q.symbol)),
    global: indices.filter((q) => (GLOBAL_INDEX_KEYS as readonly string[]).includes(q.symbol)),
    fx: ((fx.data ?? []) as FxRow[]).map((r) => ({ pair: r.pair, timestamp: r.timestamp, bid: n(r.bid), ask: n(r.ask), mid: Number(r.mid), previousClose: n(r.previous_close), percentageChange: n(r.percentage_change), source: r.source, isDemo: r.source === "demo", dataDelaySeconds: r.data_delay_seconds, fetchedAt: r.created_at })),
    commodities: ((cmd.data ?? []) as CmdRow[]).map((r) => ({ instrument: r.instrument, timestamp: r.timestamp, price: Number(r.price), currency: r.currency, unit: r.unit, contractType: r.contract_type, previousClose: n(r.previous_close), percentageChange: n(r.percentage_change), source: r.source, isDemo: r.source === "demo", dataDelaySeconds: r.data_delay_seconds, fetchedAt: r.created_at })),
  };
}
