import { angelOneConfigured, type Env, env, isDemoMode } from "../env";
import { AngelOneProvider } from "./angelone";
import { DemoProvider } from "./demo";
import { RssNewsProvider } from "./news";
import { TwelveDataProvider } from "./twelvedata";
import {
  type CommoditiesProvider,
  type ForexProvider,
  type GlobalIndicesProvider,
  type HistoricalSeries,
  INDIA_INDEX_KEYS,
  type IndexQuote,
  type MarketDataProvider,
  type NewsProvider,
  ProviderNotConfiguredError,
} from "./types";

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
  deps: { resolveToken?: (symbol: string, exchange: "NSE" | "BSE") => Promise<string | null> } = {},
): ProviderSet {
  const demo = isDemoMode(e) ? new DemoProvider() : null;

  let india: AngelOneProvider | null = null;
  if (angelOneConfigured(e)) {
    india = new AngelOneProvider({
      apiKey: e.ANGELONE_API_KEY!,
      clientCode: e.ANGELONE_CLIENT_CODE!,
      mpin: e.ANGELONE_PIN!,
      totpSecret: e.ANGELONE_TOTP_SECRET!,
      resolveToken: deps.resolveToken ?? (async () => null),
    });
  }

  let global: TwelveDataProvider | null = null;
  if (e.GLOBAL_DATA_PROVIDER === "twelvedata" && e.TWELVEDATA_API_KEY) {
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

  const indices: GlobalIndicesProvider | null = india || global ? splitIndices(india, global) : null;

  return {
    india: india ?? demo,
    globalIndices: indices ?? demo,
    // Angel One MCX/CDS futures when configured; any key it cannot supply stays missing.
    forex: india ?? global ?? demo,
    commodities: india ?? global ?? demo,
    news: news ?? demo,
    demo: Boolean(demo) && !india && !global,
  };
}

export function require<T>(p: T | null, capability: string, envVars: string[]): T {
  if (!p) throw new ProviderNotConfiguredError(capability, envVars);
  return p;
}

/**
 * NIFTY 50 and SENSEX come from the Indian provider and every other index
 * from the global one. A key with no configured source is left out rather
 * than filled from elsewhere.
 */
function splitIndices(india: AngelOneProvider | null, global: GlobalIndicesProvider | null): GlobalIndicesProvider {
  const isIndia = (k: string) => (INDIA_INDEX_KEYS as readonly string[]).includes(k);
  return {
    id: [india?.id, global?.id].filter(Boolean).join("+"),
    async getIndexQuotes(keys: readonly string[]): Promise<IndexQuote[]> {
      const indiaKeys = keys.filter(isIndia);
      const otherKeys = keys.filter((k) => !isIndia(k));
      const [a, b] = await Promise.all([
        india && indiaKeys.length ? india.getIndexQuotes(indiaKeys) : [],
        global && otherKeys.length ? global.getIndexQuotes(otherKeys) : [],
      ]);
      return [...a, ...b];
    },
    async getIndexHistory(key: string, from: string, to: string): Promise<HistoricalSeries> {
      const p = isIndia(key) ? india : global;
      if (!p) throw new ProviderNotConfiguredError(`index history for ${key}`, isIndia(key) ? ["INDIA_MARKET_PROVIDER=angelone"] : ["GLOBAL_DATA_PROVIDER"]);
      return p.getIndexHistory(key, from, to);
    },
  };
}
