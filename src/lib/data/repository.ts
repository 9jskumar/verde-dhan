import "server-only";
import { cache } from "react";
import { env, integrationStatus, isDemoMode } from "../env";
import { DEMO_UNIVERSE, DemoProvider, demoBars } from "../providers/demo";
import { resolveProviders } from "../providers/registry";
import {
  COMMODITY_KEYS,
  type CommodityQuote,
  FX_PAIRS,
  type FxQuote,
  GLOBAL_INDEX_KEYS,
  type HistoricalPrice,
  INDIA_INDEX_KEYS,
  type IndexQuote,
} from "../providers/types";
import { supabaseForUser } from "../supabase/server";
import { demoResearch, type ResearchSnapshot } from "./demo-research";
import { loadLatestResearch, loadMarketSnapshot } from "./live-research";

/**
 * Single read path for every page. Chooses, in order:
 *   live  — Supabase configured: read stored data as the signed-in user (RLS)
 *   demo  — DEMO_MODE=true and no Supabase: synthetic, clearly labelled
 *   unconfigured — nothing to show; pages render "pending integration"
 */

export type DataMode = "live" | "demo" | "unconfigured";

export function dataMode(): DataMode {
  if (integrationStatus().supabase) return "live";
  if (isDemoMode()) return "demo";
  return "unconfigured";
}

export interface MarketSnapshot {
  india: IndexQuote[];
  global: IndexQuote[];
  fx: FxQuote[];
  commodities: CommodityQuote[];
}

const EMPTY_MARKET: MarketSnapshot = { india: [], global: [], fx: [], commodities: [] };

export const getMarket = cache(async (): Promise<MarketSnapshot> => {
  const mode = dataMode();
  if (mode === "live") {
    const db = await supabaseForUser();
    return db ? loadMarketSnapshot(db) : EMPTY_MARKET;
  }
  if (mode === "demo") {
    const p = new DemoProvider();
    const [india, global, fx, commodities] = await Promise.all([
      p.getIndexQuotes(INDIA_INDEX_KEYS),
      p.getIndexQuotes(GLOBAL_INDEX_KEYS),
      p.getFxQuotes(FX_PAIRS),
      p.getCommodityQuotes(COMMODITY_KEYS),
    ]);
    return { india, global, fx, commodities };
  }
  return EMPTY_MARKET;
});

export const getResearch = cache(async (): Promise<ResearchSnapshot | null> => {
  const mode = dataMode();
  if (mode === "live") {
    const db = await supabaseForUser();
    return db ? loadLatestResearch(db) : null;
  }
  if (mode === "demo") return demoResearch();
  return null;
});

export async function getStock(symbol: string) {
  const research = await getResearch();
  return research?.analyses.find((a) => a.symbol === symbol.toUpperCase()) ?? null;
}

export type HistoryKind = "index" | "fx" | "commodity";

/** Daily history for charts, fetched server-side from the configured provider. */
export async function getHistory(kind: HistoryKind, key: string, days = 180): Promise<{ bars: HistoricalPrice[]; source: string; isDemo: boolean } | null> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 1.5 * 86_400_000).toISOString().slice(0, 10);
  const p = dataMode() === "demo" ? { globalIndices: new DemoProvider(), forex: new DemoProvider(), commodities: new DemoProvider() } : resolveProviders(env());
  try {
    const s =
      kind === "index" ? await p.globalIndices?.getIndexHistory(key, from, to)
      : kind === "fx" ? await p.forex?.getFxHistory(key, from, to)
      : await p.commodities?.getCommodityHistory(key, from, to);
    if (!s) return null;
    return { bars: s.bars.slice(-days), source: s.source, isDemo: s.isDemo };
  } catch {
    return null;
  }
}

export interface NewsRow {
  id: string;
  headline: string;
  summary: string | null;
  url: string;
  publisher: string;
  publishedAt: string;
  sentiment: string | null;
  verified: boolean;
}

export async function getNews(limit = 50): Promise<NewsRow[] | null> {
  if (dataMode() !== "live") return null;
  const db = await supabaseForUser();
  if (!db) return null;
  const { data } = await db.from("market_news").select("id,headline,summary,full_source_url,publisher,published_at,sentiment,verified").order("published_at", { ascending: false }).limit(limit);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    headline: r.headline as string,
    summary: (r.summary as string) ?? null,
    url: r.full_source_url as string,
    publisher: r.publisher as string,
    publishedAt: r.published_at as string,
    sentiment: (r.sentiment as string) ?? null,
    verified: Boolean(r.verified),
  }));
}

/** Daily closes for one stock: demo generator, or stored candles read through RLS. */
export async function getStockCloses(symbol: string, days = 250): Promise<{ t: string; v: number }[] | null> {
  const mode = dataMode();
  if (mode === "demo") {
    const c = DEMO_UNIVERSE.find((x) => x.symbol === symbol.toUpperCase());
    return c ? demoBars(c).slice(-days).map((b) => ({ t: b.timestamp.slice(0, 10), v: b.close })) : null;
  }
  if (mode !== "live") return null;
  const db = await supabaseForUser();
  if (!db) return null;
  const { data: stock } = await db.from("stocks").select("id").eq("symbol", symbol.toUpperCase()).eq("exchange", "NSE").maybeSingle();
  if (!stock) return null;
  const { data } = await db
    .from("market_prices")
    .select("timestamp, close")
    .eq("stock_id", stock.id)
    .eq("interval", "1d")
    .eq("is_complete", true)
    .order("timestamp", { ascending: false })
    .limit(days);
  return (data ?? []).reverse().map((r: { timestamp: string; close: number | string }) => ({ t: r.timestamp.slice(0, 10), v: Number(r.close) }));
}
