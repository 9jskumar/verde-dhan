import { MarketPage } from "@/components/market-page";
import { dataMode, getMarket } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";

export default async function IndiaPage() {
  const market = await getMarket();
  const mode = dataMode();
  return (
    <MarketPage
      title="Indian Markets"
      description="NIFTY 50 and SENSEX from the configured licensed provider. Exchange websites are never scraped."
      kind="index"
      quotes={market.india.map((q) => ({ key: q.symbol, name: q.name, value: q.lastValue, changePct: q.percentageChange, timestamp: q.timestamp, source: q.source, isDemo: q.isDemo, delaySeconds: q.dataDelaySeconds, note: q.marketStatus !== "UNKNOWN" ? `Market ${q.marketStatus.toLowerCase().replace("_", "-")}` : undefined }))}
      pending={mode !== "demo" && !integrationStatus().indiaMarketData ? { feature: "Indian market data", needs: ["INDIA_MARKET_PROVIDER=upstox", "UPSTOX_ACCESS_TOKEN"] } : null}
      chartKey="NIFTY50"
      chartTitle="NIFTY 50"
      notes={["Index values are only as current as the last successful ingest. The timestamp on each card is the provider's, not the page load time."]}
    />
  );
}
