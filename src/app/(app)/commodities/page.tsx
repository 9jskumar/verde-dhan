import { MarketPage } from "@/components/market-page";
import { TradingViewQuotes, TV_COMMODITIES } from "@/components/tradingview";
import { dataMode, getMarket } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";

const CONTRACT: Record<string, string> = { SPOT: "Spot", FRONT_MONTH_FUTURE: "Front-month future", CONTINUOUS_FUTURE: "Continuous future" };

export default async function CommoditiesPage() {
  const market = await getMarket();
  return (
    <MarketPage
      title="Commodities"
      description="Brent, WTI, natural gas, gold and silver come from CFI Financial in USD. Copper, aluminium and zinc are MCX front-month futures in rupees from Angel One. Spot and futures are labelled and never mixed."
      kind="commodity"
      quotes={market.commodities.map((q) => ({ key: q.instrument, name: q.instrument, value: q.price, changePct: q.percentageChange, timestamp: q.timestamp, source: q.source, isDemo: q.isDemo, delaySeconds: q.dataDelaySeconds, unit: `${q.currency}/${q.unit}`, note: CONTRACT[q.contractType] }))}
      widget={integrationStatus().globalCharts ? <TradingViewQuotes title="Commodities" symbols={TV_COMMODITIES} /> : undefined}
      pending={dataMode() !== "demo" && !(integrationStatus().indiaMarketData && integrationStatus().globalMarketData) ? { feature: "Commodity numbers for scoring and reports", needs: ["GLOBAL_DATA_PROVIDER=cfi_mt5 (energy, gold, silver)", "INDIA_MARKET_PROVIDER=angelone and the ANGELONE_* values (base metals)"] } : null}
      chartKey="XAU"
      chartTitle="Gold"
      notes={["CFI energy prices are CFDs on the rolling futures contract; gold and silver are spot.", "MCX base-metal prices include the rupee exchange rate, so their daily change can differ from international prices."]}
    />
  );
}
