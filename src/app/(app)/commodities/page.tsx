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
      description="Energy, precious and base metals. Brent comes from CFI Financial (USD CFD); the rest are MCX front-month futures in rupees from Angel One. Spot and futures are labelled and never mixed."
      kind="commodity"
      quotes={market.commodities.map((q) => ({ key: q.instrument, name: q.instrument, value: q.price, changePct: q.percentageChange, timestamp: q.timestamp, source: q.source, isDemo: q.isDemo, delaySeconds: q.dataDelaySeconds, unit: `${q.currency}/${q.unit}`, note: CONTRACT[q.contractType] }))}
      widget={integrationStatus().globalCharts ? <TradingViewQuotes title="Commodities" symbols={TV_COMMODITIES} /> : undefined}
      pending={dataMode() !== "demo" && !integrationStatus().indiaMarketData && !integrationStatus().globalMarketData ? { feature: "Commodity numbers for scoring and reports", needs: ["INDIA_MARKET_PROVIDER=angelone", "ANGELONE_API_KEY", "ANGELONE_CLIENT_CODE", "ANGELONE_PIN", "ANGELONE_TOTP_SECRET"] } : null}
      chartKey="XAU"
      chartTitle="Gold"
      notes={["MCX prices include the rupee exchange rate, so their daily change can differ from international prices.", "Brent has no MCX contract, so it comes from CFI Financial's Brent CFD. Until the CFI bridge runs, the Brent-based impact rules report it as missing rather than using WTI."]}
    />
  );
}
