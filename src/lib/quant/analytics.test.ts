import { describe, expect, it } from "vitest";
import {
  cagrPct,
  computeFundamentalMetrics,
  type FinancialStatement,
  growthPct,
  interestCoverage,
  median,
  ReportingBasisMismatchError,
  rocePct,
  roePct,
  valuation,
} from "./fundamentals";
import { evaluateGlobalImpact, type ImpactRule } from "./globalImpact";
import { allocation, maxDrawdownPct, positionSize, riskReward, summariseHoldings } from "./risk";
import { classify, recommendationFor, scoreStock, type ScoringInput } from "./scoring";

const stmt = (period: string, revenue: number, pat: number, extra: Partial<FinancialStatement> = {}): FinancialStatement => ({
  basis: "consolidated",
  periodType: "annual",
  period,
  periodEnd: `${period.slice(2)}-03-31`,
  revenue,
  ebitda: revenue * 0.2,
  ebit: revenue * 0.15,
  pat,
  eps: pat / 10,
  interestExpense: revenue * 0.01,
  totalAssets: revenue * 1.2,
  currentLiabilities: revenue * 0.3,
  totalDebt: revenue * 0.2,
  cashAndEquivalents: revenue * 0.05,
  equity: revenue * 0.6,
  operatingCashFlow: pat * 1.1,
  capex: revenue * 0.05,
  sharesOutstanding: 10,
  ...extra,
});

describe("fundamentals", () => {
  it("growth and CAGR", () => {
    expect(growthPct(120, 100)).toBe(20);
    expect(growthPct(120, -100)).toBeNull(); // growth off a loss is not meaningful
    expect(growthPct(null, 100)).toBeNull();
    expect(cagrPct(133.1, 100, 3)).toBeCloseTo(10, 6);
    expect(cagrPct(100, 0, 3)).toBeNull();
  });

  it("ratios return null rather than dividing by zero", () => {
    expect(roePct(20, 100)).toBe(20);
    expect(roePct(20, 100, 60)).toBe(25); // average equity
    expect(roePct(20, 0)).toBeNull();
    expect(rocePct(30, 200, 50)).toBe(20);
    expect(interestCoverage(50, 0)).toBeNull();
    expect(interestCoverage(50, 10)).toBe(5);
  });

  it("valuation ratios", () => {
    const v = valuation({ price: 200, marketCap: 2000, ttmEps: 10, bookValuePerShare: 50, ttmEbitda: 250, totalDebt: 300, cash: 50, epsGrowthPct: 20 });
    expect(v).toEqual({ pe: 20, pb: 4, evEbitda: 9, peg: 1, enterpriseValue: 2250 });
    expect(valuation({ price: 200, marketCap: null, ttmEps: -5, bookValuePerShare: null, ttmEbitda: null, totalDebt: null, cash: null, epsGrowthPct: null }).pe).toBeNull();
  });

  it("computes YoY, 3y and 5y metrics from annual statements in any order", () => {
    const rows = [stmt("FY2021", 100, 10), stmt("FY2026", 200, 25), stmt("FY2023", 140, 15), stmt("FY2024", 160, 18), stmt("FY2025", 180, 20), stmt("FY2022", 120, 12)];
    const m = computeFundamentalMetrics(rows)!;
    expect(m.latestPeriod).toBe("FY2026");
    expect(m.revenueGrowth).toBeCloseTo(11.11, 2);
    expect(m.patGrowth).toBe(25);
    expect(m.revenueCagr3y).toBeCloseTo(((200 / 140) ** (1 / 3) - 1) * 100, 2);
    expect(m.revenueCagr5y).toBeCloseTo(((200 / 100) ** (1 / 5) - 1) * 100, 2);
    expect(m.ebitdaMargin).toBe(20);
    expect(m.cfoPatRatio).toBe(1.1);
  });

  it("refuses to mix consolidated and standalone figures", () => {
    expect(() => computeFundamentalMetrics([stmt("FY2025", 100, 10), stmt("FY2026", 120, 12, { basis: "standalone" })])).toThrow(ReportingBasisMismatchError);
    expect(() => computeFundamentalMetrics([stmt("FY2025", 100, 10), stmt("FY2026", 120, 12, { periodType: "quarterly" })])).toThrow(ReportingBasisMismatchError);
  });

  it("quarterly growth compares with the same quarter last year", () => {
    const q = (p: string, r: number) => stmt(p, r, r / 10, { periodType: "quarterly" });
    const m = computeFundamentalMetrics([q("FY2025-Q1", 100), q("FY2025-Q2", 300), q("FY2025-Q3", 300), q("FY2025-Q4", 300), q("FY2026-Q1", 110)])!;
    expect(m.revenueGrowth).toBe(10);
  });

  it("median ignores nulls", () => {
    expect(median([3, null, 1, 2])).toBe(2);
    expect(median([null])).toBeNull();
  });
});

const strongInput = (): ScoringInput => ({
  symbol: "TEST",
  sector: "Industrials",
  isFinancialSector: false,
  fundamentals: {
    basis: "consolidated",
    periodType: "annual",
    latestPeriod: "FY2026",
    revenueGrowth: 22,
    ebitdaGrowth: 25,
    patGrowth: 30,
    epsGrowth: 30,
    revenueCagr3y: 18,
    revenueCagr5y: 15,
    patCagr3y: 22,
    ebitdaMargin: 20,
    patMargin: 12,
    roe: 22,
    roce: 25,
    debtEquity: 0.2,
    interestCoverage: 10,
    cfoPatRatio: 1.1,
    freeCashFlow: 100,
  },
  ownership: { promoterHolding: 60, promoterPledge: 0 },
  valuation: { pe: 24, peg: 0.9, sectorMedianPe: 30 },
  technical: {
    close: 110,
    sma50: 100,
    sma200: 90,
    sma200Prior: 87,
    rsi14: 64,
    macdHistogram: 0.5,
    relativeVolume: 2.2,
    relativeStrength: 0.12,
    atrPct: 1.8,
    breakoutStage: "CONFIRMED",
  },
  catalysts: { positiveVerified: 3, negativeVerified: 0, governanceConcern: false },
  globalAlignment: 1,
  liquidity: { averageTradedValue20d: 50_00_00_000 },
  data: { latestPriceAt: "2026-10-23T10:00:00Z", now: "2026-10-23T12:00:00Z" },
});

describe("scoring", () => {
  it("component maxima sum to the 40/35/15/10 model", () => {
    const r = scoreStock(strongInput());
    const max = (prefix: string[]) => r.components.filter((c) => prefix.some((p) => c.name.startsWith(p))).reduce((s, c) => s + c.max, 0);
    expect(max(["Fundamental"])).toBe(40);
    expect(max(["Technical"])).toBe(35);
    expect(max(["Catalyst", "Global"])).toBe(15);
    expect(max(["Valuation", "Risk"])).toBe(10);
    const fin = scoreStock({ ...strongInput(), isFinancialSector: true });
    expect(fin.components.filter((c) => c.name.startsWith("Fundamental")).reduce((s, c) => s + c.max, 0)).toBe(40);
  });

  it("a strong, clean candidate scores as exceptional and maps to BUY_BREAKOUT", () => {
    const r = scoreStock(strongInput());
    expect(r.rejections).toEqual([]);
    expect(r.total).toBeGreaterThanOrEqual(85);
    expect(r.classification).toBe("EXCEPTIONAL");
    expect(recommendationFor(r, "CONFIRMED")).toBe("BUY_BREAKOUT");
  });

  it("a governance concern overrides a high score", () => {
    const input = strongInput();
    input.catalysts.governanceConcern = true;
    const r = scoreStock(input);
    expect(r.total).toBeGreaterThanOrEqual(85);
    expect(r.classification).toBe("REJECTED");
    expect(r.rejections).toContain("GOVERNANCE_CONCERN");
    expect(recommendationFor(r, "CONFIRMED")).toBe("AVOID");
  });

  it("rejects stale, illiquid, pledged and data-poor stocks", () => {
    const stale = strongInput();
    stale.data = { latestPriceAt: "2026-10-01T10:00:00Z", now: "2026-10-23T12:00:00Z" };
    expect(scoreStock(stale).rejections).toContain("STALE_DATA");

    const illiquid = strongInput();
    illiquid.liquidity.averageTradedValue20d = 10_00_000;
    expect(scoreStock(illiquid).rejections).toContain("INADEQUATE_LIQUIDITY");

    const pledged = strongInput();
    pledged.ownership.promoterPledge = 40;
    expect(scoreStock(pledged).rejections).toContain("EXCESSIVE_PROMOTER_PLEDGE");

    const sparse = strongInput();
    sparse.fundamentals = null;
    sparse.valuation = { pe: null, peg: null, sectorMedianPe: null };
    const r = scoreStock(sparse);
    expect(r.coverage).toBeLessThan(0.7);
    expect(r.rejections).toContain("UNRELIABLE_DATA");
    expect(r.missing.length).toBeGreaterThan(5);
  });

  it("flags severe technical deterioration", () => {
    const input = strongInput();
    input.technical = { ...input.technical, close: 70, sma50: 80, sma200: 90, rsi14: 28 };
    expect(scoreStock(input).rejections).toContain("SEVERE_TECHNICAL_DETERIORATION");
  });

  it("classification bands", () => {
    expect(classify(85)).toBe("EXCEPTIONAL");
    expect(classify(84.99)).toBe("HIGH_POTENTIAL");
    expect(classify(70)).toBe("QUALIFIED");
    expect(classify(65)).toBe("WATCHLIST");
    expect(classify(64.9)).toBe("DO_NOT_RECOMMEND");
  });
});

describe("risk", () => {
  it("sizes a position from risk budget", () => {
    const r = positionSize({ capital: 10_00_000, riskPerTradePct: 1, entry: 500, stopLoss: 480 });
    expect(r.quantity).toBe(500);
    expect(r.riskAmount).toBe(10_000);
    expect(r.positionPctOfCapital).toBe(25);
  });

  it("caps by concentration and respects lot size", () => {
    const r = positionSize({ capital: 1_00_000, riskPerTradePct: 2, entry: 100, stopLoss: 99, maxPositionPct: 20, lotSize: 5 });
    expect(r.quantity).toBe(200);
    expect(r.cappedByConcentration).toBe(true);
  });

  it("rejects invalid stop placement", () => {
    expect(() => positionSize({ capital: 1000, riskPerTradePct: 1, entry: 100, stopLoss: 101 })).toThrow(RangeError);
  });

  it("risk/reward", () => {
    expect(riskReward(100, 95, 112.5)).toBe(2.5);
    expect(riskReward(100, 101, 120)).toBeNull();
  });

  it("FIFO realised and unrealised P&L with fees", () => {
    const h = summariseHoldings(
      [
        { symbol: "A", side: "BUY", quantity: 10, price: 100, fees: 10, executedAt: "2026-01-01" },
        { symbol: "A", side: "BUY", quantity: 10, price: 120, executedAt: "2026-02-01" },
        { symbol: "A", side: "SELL", quantity: 15, price: 130, fees: 5, executedAt: "2026-03-01" },
      ],
      { A: 140 },
    );
    // lot1 cost 101 × 10 → +290; lot2 cost 120 × 5 → +50; fees −5
    expect(h[0]!.realisedPnl).toBe(335);
    expect(h[0]!.quantity).toBe(5);
    expect(h[0]!.averageCost).toBe(120);
    expect(h[0]!.unrealisedPnl).toBe(100);
  });

  it("rejects overselling and handles missing prices", () => {
    expect(() =>
      summariseHoldings(
        [
          { symbol: "A", side: "BUY", quantity: 1, price: 1, executedAt: "1" },
          { symbol: "A", side: "SELL", quantity: 2, price: 1, executedAt: "2" },
        ],
        {},
      ),
    ).toThrow(RangeError);
    const h = summariseHoldings([{ symbol: "B", side: "BUY", quantity: 1, price: 10, executedAt: "1" }], {});
    expect(h[0]!.unrealisedPnl).toBeNull();
  });

  it("allocation and max drawdown", () => {
    expect(allocation([{ key: "x", value: 75 }, { key: "y", value: 25 }])).toEqual([{ key: "x", pct: 75 }, { key: "y", pct: 25 }]);
    expect(maxDrawdownPct([100, 120, 90, 130, 117])).toBe(-25);
  });
});

describe("global impact engine", () => {
  const rules: ImpactRule[] = [
    { id: "r1", globalInstrument: "BRENT", movementType: "UP", thresholdPct: 2, affectedSector: "Oil Marketing", impactDirection: "NEGATIVE", impactMechanism: "Input cost", confidence: "HIGH" },
    { id: "r2", globalInstrument: "BRENT", movementType: "UP", thresholdPct: 2, affectedSector: "Upstream Oil & Gas", impactDirection: "POSITIVE", impactMechanism: "Realisations", confidence: "MEDIUM" },
    { id: "r3", globalInstrument: "USDINR", movementType: "UP", thresholdPct: 0.3, affectedSector: "IT Services", impactDirection: "POSITIVE", impactMechanism: "USD revenue", confidence: "MEDIUM" },
  ];

  it("fires rules above threshold with traceable drivers", () => {
    const r = evaluateGlobalImpact(
      [
        { instrument: "BRENT", changePct: 4, asOf: "t", source: "test" },
        { instrument: "USDINR", changePct: 0.1, asOf: "t", source: "test" },
      ],
      rules,
    );
    expect(r.bySector["Oil Marketing"]!.score).toBeLessThan(0);
    expect(r.bySector["Upstream Oil & Gas"]!.score).toBeGreaterThan(0);
    expect(r.bySector["IT Services"]).toBeUndefined();
    expect(r.underPressure[0]!.drivers[0]!.ruleId).toBe("r1");
    expect(r.sentiment).toBe("INSUFFICIENT_DATA");
  });

  it("reports missing instruments instead of assuming zero change", () => {
    const r = evaluateGlobalImpact([], rules);
    expect(r.missingInstruments).toEqual(["BRENT", "USDINR"]);
    expect(Object.keys(r.bySector)).toHaveLength(0);
  });

  it("derives risk-on / risk-off from equity indices", () => {
    const up = ["SPX", "NDX", "DJI", "FTSE"].map((i) => ({ instrument: i, changePct: 1, asOf: "t", source: "t" }));
    expect(evaluateGlobalImpact(up, []).sentiment).toBe("RISK_ON");
    const down = up.map((m) => ({ ...m, changePct: -1.2 }));
    expect(evaluateGlobalImpact(down, []).sentiment).toBe("RISK_OFF");
  });
});
