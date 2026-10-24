import { MarketPage } from "@/components/market-page";
import { dataMode, getMarket } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";

export default async function GlobalPage() {
  const market = await getMarket();
  return (
    <MarketPage
      title="Global Markets"
      description="Major US, European and Asian indices used by the global impact engine."
      kind="index"
      quotes={market.global.map((q) => ({ key: q.symbol, name: q.name, value: q.lastValue, changePct: q.percentageChange, timestamp: q.timestamp, source: q.source, isDemo: q.isDemo, delaySeconds: q.dataDelaySeconds, unit: q.currency }))}
      pending={dataMode() !== "demo" && !integrationStatus().globalMarketData ? { feature: "Global index data", needs: ["GLOBAL_MARKET_PROVIDER=twelvedata", "TWELVEDATA_API_KEY", "TWELVEDATA_SYMBOL_MAP (index symbols depend on your plan)"] } : null}
      chartKey="SPX"
      chartTitle="S&P 500"
      notes={["Cash-index symbols on Twelve Data depend on the subscription plan, so they are mapped explicitly in TWELVEDATA_SYMBOL_MAP rather than guessed."]}
    />
  );
}
