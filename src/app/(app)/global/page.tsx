import { MarketPage } from "@/components/market-page";
import { TradingViewQuotes, TV_INDICES } from "@/components/tradingview";
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
      widget={integrationStatus().globalCharts ? <TradingViewQuotes title="Global indices" symbols={TV_INDICES} /> : undefined}
      pending={dataMode() !== "demo" && !integrationStatus().globalMarketData ? { feature: "Global index numbers for scoring and the 08:00 WhatsApp report", needs: ["a licensed global index data API (TradingView has no data API)"] } : null}
      chartKey="SPX"
      chartTitle="S&P 500"
      notes={["The TradingView panel tracks each index through a CFD, so its level can differ slightly from the official index.", "The global impact engine only uses the stored numbers below, never the TradingView panel."]}
    />
  );
}
