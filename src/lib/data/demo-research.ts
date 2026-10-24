import { analyseStock, rankOpportunities, type StockAnalysis, topThree } from "../analysis/pipeline";
import { median, valuation } from "../quant/fundamentals";
import { evaluateGlobalImpact, type GlobalImpactResult, type ImpactRule } from "../quant/globalImpact";
import { DEFAULT_IMPACT_RULES } from "../quant/impactRules";
import { DEMO_SOURCE, DEMO_UNIVERSE, DemoProvider, demoBars, demoBenchmark, demoStatements } from "../providers/demo";
import { COMMODITY_KEYS, FX_PAIRS, GLOBAL_INDEX_KEYS } from "../providers/types";

/**
 * Runs the real deterministic pipeline over the fictional demo universe.
 * Output is flagged isDemo=true throughout.
 */

export interface ResearchSnapshot {
  mode: "demo" | "live";
  asOf: string | null;
  analyses: StockAnalysis[];
  top10: StockAnalysis[];
  top3: StockAnalysis[];
  globalImpact: GlobalImpactResult | null;
  sectors: { sector: string; avgChangePct: number; constituents: number }[];
}

let cache: { at: number; value: ResearchSnapshot } | null = null;

export async function demoResearch(rules: readonly ImpactRule[] = DEFAULT_IMPACT_RULES): Promise<ResearchSnapshot> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.value;
  const provider = new DemoProvider();
  const [indices, fx, commodities] = await Promise.all([
    provider.getIndexQuotes(GLOBAL_INDEX_KEYS),
    provider.getFxQuotes(FX_PAIRS),
    provider.getCommodityQuotes(COMMODITY_KEYS),
  ]);
  const moves = [
    ...indices.map((q) => ({ instrument: q.symbol, changePct: q.percentageChange, asOf: q.timestamp, source: DEMO_SOURCE })),
    ...fx.map((q) => ({ instrument: q.pair, changePct: q.percentageChange, asOf: q.timestamp, source: DEMO_SOURCE })),
    ...commodities.map((q) => ({ instrument: q.instrument, changePct: q.percentageChange, asOf: q.timestamp, source: DEMO_SOURCE })),
  ];
  const globalImpact = evaluateGlobalImpact(moves, rules);

  const prepared = DEMO_UNIVERSE.map((c) => {
    const bars = demoBars(c);
    const statements = demoStatements(c);
    const latest = statements.at(-1)!;
    const price = bars.at(-1)!.close;
    const pe = valuation({ price, marketCap: null, ttmEps: latest.eps, bookValuePerShare: null, ttmEbitda: null, totalDebt: null, cash: null, epsGrowthPct: null }).pe;
    return { c, bars, statements, pe };
  });
  const sectorPe = new Map<string, number | null>();
  for (const sector of new Set(DEMO_UNIVERSE.map((c) => c.sector))) {
    sectorPe.set(sector, median(prepared.filter((p) => p.c.sector === sector).map((p) => p.pe)));
  }
  const universePe = median(prepared.map((p) => p.pe));

  const sectorMoves = new Map<string, number[]>();
  for (const p of prepared) {
    const [a, b] = p.bars.slice(-2);
    const list = sectorMoves.get(p.c.sector) ?? [];
    list.push((b!.close / a!.close - 1) * 100);
    sectorMoves.set(p.c.sector, list);
  }
  const sectors = [...sectorMoves].map(([sector, xs]) => ({ sector, avgChangePct: xs.reduce((s, v) => s + v, 0) / xs.length, constituents: xs.length }));

  const now = new Date().toISOString();
  const analyses = prepared.map(({ c, bars, statements }) => {
    const sectorAvg = sectors.find((s) => s.sector === c.sector)?.avgChangePct ?? null;
    return analyseStock({
      symbol: c.symbol,
      companyName: c.name,
      exchange: "NSE",
      sector: c.sector,
      isFinancialSector: c.isFinancialSector,
      bars,
      benchmarkCloses: demoBenchmark(bars.length),
      statements,
      ownership: { promoterHolding: 55, promoterPledge: c.promoterPledge },
      sharesOutstanding: 50,
      // Single-name sectors fall back to the universe median.
      sectorMedianPe: prepared.filter((p) => p.c.sector === c.sector).length > 1 ? (sectorPe.get(c.sector) ?? universePe) : universePe,
      catalysts: { positiveVerified: 0, negativeVerified: 0, governanceConcern: Boolean(c.governanceConcern) },
      globalAlignment: globalImpact.bySector[c.sector]?.score ?? 0,
      sectorTrendPositive: sectorAvg === null ? null : sectorAvg > -0.5,
      marketHealthy: true,
      now,
      isDemo: true,
      source: DEMO_SOURCE,
    });
  });

  const top10 = rankOpportunities(analyses);
  const value: ResearchSnapshot = {
    mode: "demo",
    asOf: analyses.map((a) => a.asOf).filter(Boolean).sort().at(-1) ?? null,
    analyses: [...analyses].sort((a, b) => b.score.total - a.score.total),
    top10,
    top3: topThree(top10),
    globalImpact,
    sectors: sectors.sort((a, b) => b.avgChangePct - a.avgChangePct),
  };
  cache = { at: Date.now(), value };
  return value;
}
