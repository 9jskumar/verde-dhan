import { round } from "./types";

/**
 * Deterministic fundamental calculations.
 *
 * Inputs come from `financial_statements` rows. Figures from different
 * reporting bases (consolidated vs standalone) or different period types
 * (annual vs quarterly) are never combined: every multi-period function
 * validates that first and throws `ReportingBasisMismatchError` otherwise.
 *
 * Any metric whose inputs are missing, zero-denominator or economically
 * meaningless (e.g. growth off a negative base) returns `null`.
 */

export type ReportingBasis = "consolidated" | "standalone";
export type PeriodType = "annual" | "quarterly" | "ttm";

export interface FinancialStatement {
  stockId?: string;
  basis: ReportingBasis;
  periodType: PeriodType;
  /** e.g. "FY2026" or "FY2026-Q2"; must sort chronologically. */
  period: string;
  periodEnd: string;
  revenue: number | null;
  ebitda: number | null;
  ebit: number | null;
  pat: number | null;
  eps: number | null;
  interestExpense: number | null;
  totalAssets: number | null;
  currentLiabilities: number | null;
  totalDebt: number | null;
  cashAndEquivalents: number | null;
  equity: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  sharesOutstanding: number | null;
}

export class ReportingBasisMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportingBasisMismatchError";
  }
}

export function assertComparable(statements: readonly FinancialStatement[]) {
  if (statements.length === 0) return;
  const { basis, periodType } = statements[0]!;
  for (const s of statements) {
    if (s.basis !== basis) {
      throw new ReportingBasisMismatchError(`Cannot combine ${basis} and ${s.basis} statements (${s.period})`);
    }
    if (s.periodType !== periodType) {
      throw new ReportingBasisMismatchError(`Cannot combine ${periodType} and ${s.periodType} periods (${s.period})`);
    }
  }
}

const ok = (...xs: (number | null | undefined)[]) => xs.every((x) => typeof x === "number" && Number.isFinite(x));

/** Period-over-period growth in %. Null when the base is ≤ 0. */
export function growthPct(current: number | null, previous: number | null): number | null {
  if (!ok(current, previous) || previous! <= 0) return null;
  return round(((current! - previous!) / previous!) * 100, 2);
}

/** Compound annual growth rate in %. Null if either end is ≤ 0. */
export function cagrPct(end: number | null, start: number | null, years: number): number | null {
  if (!ok(end, start) || start! <= 0 || end! <= 0 || years <= 0) return null;
  return round(((end! / start!) ** (1 / years) - 1) * 100, 2);
}

export const marginPct = (numerator: number | null, revenue: number | null) =>
  ok(numerator, revenue) && revenue! > 0 ? round((numerator! / revenue!) * 100, 2) : null;

/** ROE on average equity when the previous period is supplied, else closing equity. */
export function roePct(pat: number | null, equity: number | null, prevEquity?: number | null): number | null {
  const base = ok(prevEquity) && ok(equity) ? (equity! + prevEquity!) / 2 : equity;
  return ok(pat, base) && base! > 0 ? round((pat! / base!) * 100, 2) : null;
}

/** ROCE = EBIT / capital employed, capital employed = total assets − current liabilities. */
export function rocePct(ebit: number | null, totalAssets: number | null, currentLiabilities: number | null): number | null {
  if (!ok(ebit, totalAssets, currentLiabilities)) return null;
  const ce = totalAssets! - currentLiabilities!;
  return ce > 0 ? round((ebit! / ce) * 100, 2) : null;
}

export const debtToEquity = (debt: number | null, equity: number | null) =>
  ok(debt, equity) && equity! > 0 ? round(debt! / equity!, 2) : null;

/** EBIT / interest. Returns null for no interest expense (coverage undefined, not infinite). */
export const interestCoverage = (ebit: number | null, interest: number | null) =>
  ok(ebit, interest) && interest! > 0 ? round(ebit! / interest!, 2) : null;

export const cfoToPat = (cfo: number | null, pat: number | null) =>
  ok(cfo, pat) && pat! > 0 ? round(cfo! / pat!, 2) : null;

export const freeCashFlow = (cfo: number | null, capex: number | null) =>
  ok(cfo, capex) ? cfo! - Math.abs(capex!) : null;

export interface ValuationInputs {
  price: number | null;
  marketCap: number | null;
  ttmEps: number | null;
  bookValuePerShare: number | null;
  ttmEbitda: number | null;
  totalDebt: number | null;
  cash: number | null;
  /** Expected or trailing EPS growth in % used for PEG. */
  epsGrowthPct: number | null;
}

export function valuation(v: ValuationInputs) {
  const pe = ok(v.price, v.ttmEps) && v.ttmEps! > 0 ? round(v.price! / v.ttmEps!, 2) : null;
  const pb = ok(v.price, v.bookValuePerShare) && v.bookValuePerShare! > 0 ? round(v.price! / v.bookValuePerShare!, 2) : null;
  const ev = ok(v.marketCap, v.totalDebt, v.cash) ? v.marketCap! + v.totalDebt! - v.cash! : null;
  const evEbitda = ev !== null && ok(v.ttmEbitda) && v.ttmEbitda! > 0 ? round(ev / v.ttmEbitda!, 2) : null;
  const peg = pe !== null && ok(v.epsGrowthPct) && v.epsGrowthPct! > 0 ? round(pe / v.epsGrowthPct!, 2) : null;
  return { pe, pb, evEbitda, peg, enterpriseValue: ev };
}

export interface FundamentalMetrics {
  basis: ReportingBasis;
  periodType: PeriodType;
  latestPeriod: string;
  revenueGrowth: number | null;
  ebitdaGrowth: number | null;
  patGrowth: number | null;
  epsGrowth: number | null;
  revenueCagr3y: number | null;
  revenueCagr5y: number | null;
  patCagr3y: number | null;
  ebitdaMargin: number | null;
  patMargin: number | null;
  roe: number | null;
  roce: number | null;
  debtEquity: number | null;
  interestCoverage: number | null;
  cfoPatRatio: number | null;
  freeCashFlow: number | null;
}

/**
 * Computes the metric set from a chronological list of annual statements on
 * a single basis. `statements` may be in any order; they are sorted by period.
 */
export function computeFundamentalMetrics(statements: readonly FinancialStatement[]): FundamentalMetrics | null {
  if (statements.length === 0) return null;
  assertComparable(statements);
  const s = [...statements].sort((a, b) => a.period.localeCompare(b.period));
  const cur = s[s.length - 1]!;
  const prev = s[s.length - 2] ?? null;
  // For quarterly data, YoY growth compares with the same quarter a year earlier.
  const yoy = cur.periodType === "quarterly" ? (s[s.length - 5] ?? null) : prev;
  const back = (years: number) => (cur.periodType === "annual" ? (s[s.length - 1 - years] ?? null) : null);
  const y3 = back(3);
  const y5 = back(5);
  return {
    basis: cur.basis,
    periodType: cur.periodType,
    latestPeriod: cur.period,
    revenueGrowth: growthPct(cur.revenue, yoy?.revenue ?? null),
    ebitdaGrowth: growthPct(cur.ebitda, yoy?.ebitda ?? null),
    patGrowth: growthPct(cur.pat, yoy?.pat ?? null),
    epsGrowth: growthPct(cur.eps, yoy?.eps ?? null),
    revenueCagr3y: y3 ? cagrPct(cur.revenue, y3.revenue, 3) : null,
    revenueCagr5y: y5 ? cagrPct(cur.revenue, y5.revenue, 5) : null,
    patCagr3y: y3 ? cagrPct(cur.pat, y3.pat, 3) : null,
    ebitdaMargin: marginPct(cur.ebitda, cur.revenue),
    patMargin: marginPct(cur.pat, cur.revenue),
    roe: roePct(cur.pat, cur.equity, cur.periodType === "annual" ? prev?.equity : null),
    roce: rocePct(cur.ebit, cur.totalAssets, cur.currentLiabilities),
    debtEquity: debtToEquity(cur.totalDebt, cur.equity),
    interestCoverage: interestCoverage(cur.ebit, cur.interestExpense),
    cfoPatRatio: cfoToPat(cur.operatingCashFlow, cur.pat),
    freeCashFlow: freeCashFlow(cur.operatingCashFlow, cur.capex),
  };
}

/** Median helper used for sector-relative comparisons. */
export function median(values: readonly (number | null)[]): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}
