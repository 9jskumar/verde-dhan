import { type Env, env, isDemoMode } from "../env";
import { DemoProvider } from "./demo";
import { RssNewsProvider } from "./news";
import { TwelveDataProvider } from "./twelvedata";
import {
  type CommoditiesProvider,
  type ForexProvider,
  type GlobalIndicesProvider,
  type MarketDataProvider,
  type NewsProvider,
  ProviderNotConfiguredError,
} from "./types";
import { UpstoxProvider } from "./upstox";

/**
 * Chooses providers from configuration. Real providers always win over
 * demo; demo is only used when DEMO_MODE=true (and never silently in
 * production). Missing configuration surfaces as ProviderNotConfiguredError
 * so callers can mark the feature "pending integration".
 */

export interface ProviderSet {
  india: MarketDataProvider | null;
  globalIndices: GlobalIndicesProvider | null;
  forex: ForexProvider | null;
  commodities: CommoditiesProvider | null;
  news: NewsProvider | null;
  demo: boolean;
}

export function resolveProviders(
  e: Env = env(),
  deps: { resolveInstrumentKey?: (symbol: string, exchange: "NSE" | "BSE") => Promise<string | null> } = {},
): ProviderSet {
  const demo = isDemoMode(e) ? new DemoProvider() : null;

  let india: MarketDataProvider | null = null;
  if (e.INDIA_MARKET_PROVIDER === "upstox" && e.UPSTOX_ACCESS_TOKEN) {
    india = new UpstoxProvider({
      accessToken: e.UPSTOX_ACCESS_TOKEN,
      resolveInstrumentKey: deps.resolveInstrumentKey ?? (async () => null),
    });
  }

  let global: TwelveDataProvider | null = null;
  if (e.GLOBAL_MARKET_PROVIDER === "twelvedata" && e.TWELVEDATA_API_KEY) {
    let symbolMap: Record<string, string> | undefined;
    if (e.TWELVEDATA_SYMBOL_MAP) {
      try {
        symbolMap = JSON.parse(e.TWELVEDATA_SYMBOL_MAP) as Record<string, string>;
      } catch {
        throw new Error("TWELVEDATA_SYMBOL_MAP must be a JSON object");
      }
    }
    global = new TwelveDataProvider({ apiKey: e.TWELVEDATA_API_KEY, symbolMap });
  }

  const feeds = e.NEWS_RSS_FEEDS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const news: NewsProvider | null = feeds.length ? new RssNewsProvider(feeds) : null;

  return {
    india: india ?? demo,
    globalIndices: global ?? demo,
    forex: global ?? demo,
    commodities: global ?? demo,
    news: news ?? demo,
    demo: Boolean(demo) && !india && !global,
  };
}

export function require<T>(p: T | null, capability: string, envVars: string[]): T {
  if (!p) throw new ProviderNotConfiguredError(capability, envVars);
  return p;
}
