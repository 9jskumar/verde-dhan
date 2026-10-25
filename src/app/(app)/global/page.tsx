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
      pending={dataMode() !== "demo" && !integrationStatus().globalMarketData ? { feature: "Global index numbers for scoring and the 08:00 WhatsApp report", needs: ["GLOBAL_DATA_PROVIDER=cfi_mt5", "the CFI MT5 bridge running on a Windows machine (bridge/cfi_mt5)"] } : null}
      chartKey="SPX"
      chartTitle="S&P 500"
      notes={["Index numbers are CFI Financial CFD prices. They track each index closely but can differ slightly from the official level, and the previous close follows CFI's trading day.", "The global impact engine only uses the stored numbers below, never the TradingView panel."]}
    />
  );
}
