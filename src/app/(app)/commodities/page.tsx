import { MarketPage } from "@/components/market-page";
import { dataMode, getMarket } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";

const CONTRACT: Record<string, string> = { SPOT: "Spot", FRONT_MONTH_FUTURE: "Front-month future", CONTINUOUS_FUTURE: "Continuous future" };

export default async function CommoditiesPage() {
  const market = await getMarket();
  return (
    <MarketPage
      title="Commodities"
      description="Energy, precious and base metals. Spot and futures prices are labelled and never mixed."
      kind="commodity"
      quotes={market.commodities.map((q) => ({ key: q.instrument, name: q.instrument, value: q.price, changePct: q.percentageChange, timestamp: q.timestamp, source: q.source, isDemo: q.isDemo, delaySeconds: q.dataDelaySeconds, unit: `${q.currency}/${q.unit}`, note: CONTRACT[q.contractType] }))}
      pending={dataMode() !== "demo" && !integrationStatus().globalMarketData ? { feature: "Commodity data", needs: ["GLOBAL_MARKET_PROVIDER=twelvedata", "TWELVEDATA_API_KEY (gold and silver)", "a licensed energy and base-metals feed (pending)"] } : null}
      chartKey="XAU"
      chartTitle="Gold"
      notes={["Brent, WTI, natural gas and base metals need a futures data licence; until one is configured they show as unavailable rather than being estimated."]}
    />
  );
}
