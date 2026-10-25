import { MarketPage } from "@/components/market-page";
import { TradingViewQuotes, TV_FOREX } from "@/components/tradingview";
import { dataMode, getMarket } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";

export default async function ForexPage() {
  const market = await getMarket();
  return (
    <MarketPage
      title="Forex"
      description="Major pairs and INR crosses. Stored values are NSE currency futures (front month) from Angel One, not spot rates."
      kind="fx"
      quotes={market.fx.map((q) => ({ key: q.pair, name: q.pair.replace(/^(...)(...)$/, "$1/$2"), value: q.mid, dp: 4, changePct: q.percentageChange, timestamp: q.timestamp, source: q.source, isDemo: q.isDemo, delaySeconds: q.dataDelaySeconds, note: q.source === "angelone" ? "NSE future" : undefined }))}
      widget={integrationStatus().globalCharts ? <TradingViewQuotes title="Forex" symbols={TV_FOREX} /> : undefined}
      pending={dataMode() !== "demo" && !integrationStatus().indiaMarketData && !integrationStatus().globalMarketData ? { feature: "Forex numbers for scoring and reports", needs: ["INDIA_MARKET_PROVIDER=angelone", "ANGELONE_API_KEY", "ANGELONE_CLIENT_CODE", "ANGELONE_PIN", "ANGELONE_TOTP_SECRET"] } : null}
      chartKey="USDINR"
      chartTitle="USD/INR"
      notes={["JPY/INR futures are quoted per 100 yen; values here are converted to rupees per 1 yen.", "A rising USD/INR means a weaker rupee: generally a tailwind for IT and pharma exporters and a cost for importers such as oil marketing companies."]}
    />
  );
}
