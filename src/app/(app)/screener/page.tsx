import { NoResearch } from "@/components/no-research";
import { Screener, type ScreenerRow } from "@/components/screener";
import { PageHeader } from "@/components/ui";
import { getResearch } from "@/lib/data/repository";

export default async function ScreenerPage() {
  const r = await getResearch();
  const rows: ScreenerRow[] = (r?.analyses ?? []).map((a) => ({
    symbol: a.symbol,
    name: a.companyName,
    sector: a.sector,
    score: a.score.total,
    rejected: a.score.classification === "REJECTED",
    stage: a.breakout.stage,
    roe: a.fundamentals?.roe ?? null,
    debtEquity: a.fundamentals?.debtEquity ?? null,
    revenueGrowth: a.fundamentals?.revenueGrowth ?? null,
    pe: a.valuation?.pe ?? null,
    rsi: a.technical?.rsi14 ?? null,
    relativeVolume: a.technical?.relativeVolume ?? null,
    tradedValueCr: a.technical?.averageTradedValue20d == null ? null : a.technical.averageTradedValue20d / 1e7,
    aboveSma200: a.technical?.sma200 == null ? null : a.technical.close >= a.technical.sma200,
  }));
  return (
    <>
      <PageHeader title="Stock Screener" description="Filter the analysed universe on stored fundamentals, technicals and scores. Rejected stocks are hidden unless you ask for them." />
      {r ? <Screener rows={rows} /> : <NoResearch />}
    </>
  );
}
