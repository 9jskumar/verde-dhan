import { MarketPage } from "@/components/market-page";
import { dataMode, getMarket } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";

export default async function ForexPage() {
  const market = await getMarket();
  return (
    <MarketPage
      title="Forex"
      description="Major pairs and INR crosses. Mid price shown; bid and ask when the provider supplies them."
      kind="fx"
      quotes={market.fx.map((q) => ({ key: q.pair, name: q.pair.replace(/^(...)(...)$/, "$1/$2"), value: q.mid, dp: 4, changePct: q.percentageChange, timestamp: q.timestamp, source: q.source, isDemo: q.isDemo, delaySeconds: q.dataDelaySeconds }))}
      pending={dataMode() !== "demo" && !integrationStatus().globalMarketData ? { feature: "Forex data", needs: ["GLOBAL_MARKET_PROVIDER=twelvedata", "TWELVEDATA_API_KEY"] } : null}
      chartKey="USDINR"
      chartTitle="USD/INR"
      notes={["A rising USD/INR means a weaker rupee: generally a tailwind for IT and pharma exporters and a cost for importers such as oil marketing companies."]}
    />
  );
}
