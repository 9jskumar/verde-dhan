import type { SupabaseClient } from "@supabase/supabase-js";
import { analyseStock, INDICATOR_CALCULATION_VERSION, type StockAnalysis } from "../analysis/pipeline";
import { AiNotConfiguredError, interpretGlobalImpact, researchStock } from "../ai/claude";
import { globalEvidence } from "../ai/evidence";
import { loadLatestResearch, loadMarketSnapshot } from "../data/live-research";
import { env, integrationStatus } from "../env";
import { contentFingerprint, canonicalUrl } from "../providers/news";
import { fetchScripMasterRows, scripMasterTokens } from "../providers/angelone";
import { resolveProviders } from "../providers/registry";
import { COMMODITY_KEYS, FX_PAIRS, GLOBAL_INDEX_KEYS, INDIA_INDEX_KEYS } from "../providers/types";
import { checkBars } from "../providers/validate";
import { type FinancialStatement, median } from "../quant/fundamentals";
import { evaluateGlobalImpact, type GlobalImpactResult, type ImpactRule } from "../quant/globalImpact";
import { DEFAULT_IMPACT_RULES } from "../quant/impactRules";
import { evaluateOutcome } from "../quant/performance";
import type { Bar } from "../quant/types";
import { recipientHash, sendTemplate } from "../whatsapp/client";
import { dailyCloseParams, exceptionalAlertParams, globalPremarketParams, indiaPremarketParams, type ReportType, TEMPLATE_FOR } from "../whatsapp/reports";
import { localDate } from "./calendar";
import type { JobContext, JobHandler } from "./runner";

/**
 * Job implementations. All writes use the service-role client (ctx.db).
 * Every handler returns metrics that are stored on the job_runs row.
 */

const HISTORY_DAYS = 420;

async function qualityIssue(db: SupabaseClient, check: string, severity: string, entityType: string, entityId: string | null, details: Record<string, unknown>) {
  await db.from("data_quality_issues").insert({ check_name: check, severity, entity_type: entityType, entity_id: entityId, details });
}

async function providerHealth(db: SupabaseClient, provider: string, capability: string, ok: boolean, error?: string) {
  const now = new Date().toISOString();
  const { data } = await db.from("provider_health").select("consecutive_failures").eq("provider", provider).eq("capability", capability).maybeSingle();
  const failures = ok ? 0 : (data?.consecutive_failures ?? 0) + 1;
  await db.from("provider_health").upsert({
    provider,
    capability,
    ...(ok ? { last_success_at: now } : { last_failure_at: now, last_error: error?.slice(0, 500) }),
    consecutive_failures: failures,
    circuit_state: failures >= 5 ? "OPEN" : "CLOSED",
  });
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

const ingestGlobalMarkets: JobHandler = async ({ db }) => {
  const p = resolveProviders();
  const metrics: Record<string, unknown> = {};
  if (p.globalIndices) {
    const quotes = await p.globalIndices.getIndexQuotes([...INDIA_INDEX_KEYS, ...GLOBAL_INDEX_KEYS]);
    const rows = quotes.map((q) => ({
      symbol: q.symbol, name: q.name, country: "", currency: q.currency, timestamp: q.timestamp, last_value: q.lastValue,
      previous_close: q.previousClose, absolute_change: q.absoluteChange, percentage_change: q.percentageChange,
      day_high: q.dayHigh, day_low: q.dayLow, market_status: q.marketStatus, source: q.source, data_delay_seconds: q.dataDelaySeconds,
    }));
    // Country comes from the instrument master, not the vendor.
    const { data: masters } = await db.from("global_instruments").select("symbol,country");
    const country = new Map((masters ?? []).map((m: { symbol: string; country: string }) => [m.symbol, m.country]));
    for (const r of rows) r.country = country.get(r.symbol) ?? "XX";
    const { error } = await db.from("global_indices").upsert(rows, { onConflict: "symbol,timestamp,source", ignoreDuplicates: true });
    if (error) throw new Error(`global_indices insert: ${error.message}`);
    metrics.indices = rows.length;
    await providerHealth(db, p.globalIndices.id, "global_indices", true);
  }
  if (p.forex) {
    const fx = await p.forex.getFxQuotes(FX_PAIRS);
    const { error } = await db.from("forex_prices").upsert(
      fx.map((q) => ({ pair: q.pair, timestamp: q.timestamp, bid: q.bid, ask: q.ask, mid: q.mid, previous_close: q.previousClose, percentage_change: q.percentageChange, source: q.source, data_delay_seconds: q.dataDelaySeconds })),
      { onConflict: "pair,timestamp,source", ignoreDuplicates: true },
    );
    if (error) throw new Error(`forex_prices insert: ${error.message}`);
    metrics.forex = fx.length;
  }
  if (p.commodities) {
    const c = await p.commodities.getCommodityQuotes(COMMODITY_KEYS);
    const { error } = await db.from("commodity_prices").upsert(
      c.map((q) => ({ instrument: q.instrument, timestamp: q.timestamp, price: q.price, currency: q.currency, unit: q.unit, contract_type: q.contractType, contract_month: q.contractMonth ?? null, previous_close: q.previousClose, percentage_change: q.percentageChange, source: q.source, data_delay_seconds: q.dataDelaySeconds })),
      { onConflict: "instrument,timestamp,source,contract_type", ignoreDuplicates: true },
    );
    if (error) throw new Error(`commodity_prices insert: ${error.message}`);
    metrics.commodities = c.length;
  }
  if (!p.globalIndices && !p.forex && !p.commodities) metrics.skipped = "no global market provider configured";
  return metrics;
};

interface StockRow { id: string; symbol: string; exchange: "NSE" | "BSE"; provider_ids: Record<string, string>; company_id: string; company_name: string; sector: string | null; is_financial_sector: boolean }

async function activeStocks(db: SupabaseClient): Promise<StockRow[]> {
  const { data, error } = await db
    .from("stocks")
    .select("id,symbol,exchange,provider_ids,company_id,companies!inner(company_name,sector,is_financial_sector)")
    .eq("listing_status", "ACTIVE")
    .eq("instrument_type", "EQ")
    .limit(5000);
  if (error) throw new Error(`stocks: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => {
    const c = r.companies as { company_name: string; sector: string | null; is_financial_sector: boolean };
    return { id: r.id as string, symbol: r.symbol as string, exchange: r.exchange as "NSE" | "BSE", provider_ids: (r.provider_ids as Record<string, string>) ?? {}, company_id: r.company_id as string, company_name: c.company_name, sector: c.sector, is_financial_sector: c.is_financial_sector };
  });
}

const ingestIndiaPrices: JobHandler = async ({ db, now, log }) => {
  const stocks = await activeStocks(db);
  const keyMap = new Map(stocks.map((s) => [`${s.exchange}:${s.symbol}`, s.provider_ids.angelone ?? null]));
  const p = resolveProviders(env(), { resolveToken: async (symbol, exchange) => keyMap.get(`${exchange}:${symbol}`) ?? null });
  if (!p.india) return { skipped: "no Indian market data provider configured" };
  // Map any stock without a SmartAPI token from the published scrip master, once, and store it.
  const unmapped = stocks.filter((s) => !s.provider_ids.angelone);
  if (unmapped.length) {
    const tokens = scripMasterTokens(await fetchScripMasterRows());
    for (const s of unmapped) {
      const token = tokens.get(`${s.exchange}:${s.symbol}`);
      if (!token) {
        await qualityIssue(db, "UNMAPPED_INSTRUMENT", "WARNING", "stock", s.id, { symbol: s.symbol, exchange: s.exchange, provider: "angelone" });
        continue;
      }
      keyMap.set(`${s.exchange}:${s.symbol}`, token);
      const { error } = await db.from("stocks").update({ provider_ids: { ...s.provider_ids, angelone: token } }).eq("id", s.id);
      if (error) log(`could not store SmartAPI token for ${s.exchange}:${s.symbol}`, { error: error.message });
    }
  }
  const to = localDate(now);
  const from = localDate(new Date(now.getTime() - HISTORY_DAYS * 86_400_000));
  let written = 0;
  let failed = 0;
  for (const s of stocks) {
    try {
      const series = await p.india.getHistoricalPrices(s.symbol, from, to, s.exchange);
      const issues = checkBars(p.india.id, series.bars);
      for (const issue of issues) await qualityIssue(db, issue.check, issue.severity, "stock", s.id, { symbol: s.symbol, detail: issue.detail });
      const rows = series.bars.map((b) => ({
        stock_id: s.id, exchange: s.exchange, interval: "1d", timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close,
        adjusted_close: b.adjustedClose, volume: Math.round(b.volume), traded_value: null, is_complete: b.complete, source: series.source, data_delay_seconds: series.dataDelaySeconds,
      }));
      // Upsert so an in-progress candle is replaced by its final version.
      const { error } = await db.from("market_prices").upsert(rows, { onConflict: "stock_id,exchange,interval,timestamp" });
      if (error) throw new Error(error.message);
      written += rows.length;
    } catch (err) {
      failed += 1;
      log(`price ingest failed for ${s.exchange}:${s.symbol}`, { error: (err as Error).message });
    }
  }
  await providerHealth(db, p.india.id, "india_prices", failed === 0 || failed < stocks.length, failed ? `${failed} symbols failed` : undefined);
  return { stocks: stocks.length, candles: written, failed };
};

const ingestNews: JobHandler = async ({ db }) => {
  const p = resolveProviders();
  if (!p.news || p.news.id === "demo") return { skipped: "no licensed news feed configured" };
  const items = await p.news.getLatestNews({ since: new Date(Date.now() - 2 * 86_400_000).toISOString() });
  const rows = items.map((n) => ({
    headline: n.headline, summary: n.summary, full_source_url: n.url, canonical_url: canonicalUrl(n.url), content_fingerprint: contentFingerprint(n.headline, n.publisher),
    publisher: n.publisher, published_at: n.publishedAt, source_type: "RSS", source: n.source, verified: false,
  }));
  const fps = rows.map((r) => r.content_fingerprint);
  const { data: existing } = await db.from("market_news").select("content_fingerprint").in("content_fingerprint", fps);
  const seen = new Set((existing ?? []).map((r: { content_fingerprint: string }) => r.content_fingerprint));
  const fresh = rows.filter((r) => !seen.has(r.content_fingerprint));
  if (fresh.length) {
    const { error } = await db.from("market_news").upsert(fresh, { onConflict: "canonical_url", ignoreDuplicates: true });
    if (error) throw new Error(`market_news insert: ${error.message}`);
  }
  return { fetched: items.length, inserted: fresh.length };
};

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

async function loadBars(db: SupabaseClient, stockId: string): Promise<Bar[]> {
  const { data, error } = await db
    .from("market_prices")
    .select("timestamp,open,high,low,close,adjusted_close,volume,is_complete")
    .eq("stock_id", stockId)
    .eq("interval", "1d")
    .order("timestamp", { ascending: false })
    .limit(HISTORY_DAYS);
  if (error) throw new Error(`market_prices: ${error.message}`);
  return (data ?? [])
    .map((r: Record<string, unknown>) => ({
      timestamp: String(r.timestamp).slice(0, 10),
      open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
      adjustedClose: r.adjusted_close === null ? null : Number(r.adjusted_close),
      volume: Number(r.volume), complete: Boolean(r.is_complete),
    }))
    .reverse();
}

/** NIFTY 50 daily closes, aligned to the stock's dates (forward-filled). */
async function loadBenchmark(db: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await db.from("global_indices").select("timestamp,last_value").eq("symbol", "NIFTY50").neq("source", "demo").order("timestamp", { ascending: true }).limit(20000);
  const byDay = new Map<string, number>();
  for (const r of data ?? []) byDay.set(String((r as { timestamp: string }).timestamp).slice(0, 10), Number((r as { last_value: number }).last_value));
  return byDay;
}

function align(bars: Bar[], bench: Map<string, number>): number[] | undefined {
  if (bench.size < 70) return undefined;
  const out: number[] = [];
  let last: number | null = null;
  for (const b of bars) {
    last = bench.get(b.timestamp) ?? last;
    if (last === null) return undefined;
    out.push(last);
  }
  return out;
}

async function loadImpactRules(db: SupabaseClient): Promise<ImpactRule[]> {
  const { data, error } = await db.from("global_market_impact_rules").select("*").eq("enabled", true);
  if (error || !data?.length) return DEFAULT_IMPACT_RULES;
  return data.map((r: Record<string, unknown>) => ({
    id: r.id as string, globalInstrument: r.global_instrument as string, movementType: r.movement_type as ImpactRule["movementType"],
    thresholdPct: Number(r.threshold_pct), affectedSector: r.affected_sector as string, impactDirection: r.impact_direction as ImpactRule["impactDirection"],
    impactMechanism: r.impact_mechanism as string, confidence: r.confidence as ImpactRule["confidence"], applicableConditions: r.applicable_conditions as string | null,
    sourceReferences: (r.source_references as string[]) ?? [],
  }));
}

function statementFromRow(r: Record<string, unknown>): FinancialStatement {
  const num = (k: string) => (r[k] === null || r[k] === undefined ? null : Number(r[k]));
  return {
    basis: r.reporting_basis as FinancialStatement["basis"], periodType: r.period_type as FinancialStatement["periodType"], period: r.reporting_period as string,
    periodEnd: r.period_end as string, revenue: num("revenue"), ebitda: num("ebitda"), ebit: num("ebit"), pat: num("pat"), eps: num("eps"),
    interestExpense: num("interest_expense"), totalAssets: num("total_assets"), currentLiabilities: num("current_liabilities"), totalDebt: num("total_debt"),
    cashAndEquivalents: num("cash_and_equivalents"), equity: num("equity"), operatingCashFlow: num("operating_cash_flow"), capex: num("capex"), sharesOutstanding: num("shares_outstanding"),
  };
}

const computeAnalysis: JobHandler = async ({ db, now, log }) => {
  const stocks = await activeStocks(db);
  const bench = await loadBenchmark(db);
  const { data: impactRow } = await db.from("global_impact_snapshots").select("result").order("computed_at", { ascending: false }).limit(1).maybeSingle();
  const impact = impactRow?.result as GlobalImpactResult | undefined;
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  // First pass: load inputs and compute 20-session sector momentum and P/E for medians.
  const prepared: { s: StockRow; bars: Bar[]; statements: FinancialStatement[]; ownership: { promoterHolding: number | null; promoterPledge: number | null }; governance: boolean; pos: number; neg: number }[] = [];
  for (const s of stocks) {
    const bars = await loadBars(db, s.id);
    if (bars.length < 60) continue;
    const [{ data: st }, { data: sh }, { data: ann }, { data: news }] = await Promise.all([
      db.from("financial_statements").select("*").eq("company_id", s.company_id),
      db.from("shareholding_patterns").select("promoter_holding,promoter_pledge").eq("company_id", s.company_id).order("quarter_end", { ascending: false }).limit(1).maybeSingle(),
      db.from("corporate_announcements").select("is_governance_concern,verification_status").eq("stock_id", s.id).gte("announcement_timestamp", since),
      db.from("market_news").select("sentiment,verified").contains("related_stock_ids", [s.id]).gte("published_at", since).eq("verified", true),
    ]);
    const sentiments = (news ?? []).map((n: { sentiment: string | null }) => n.sentiment);
    prepared.push({
      s,
      bars,
      statements: (st ?? []).map(statementFromRow),
      ownership: { promoterHolding: sh ? Number(sh.promoter_holding) : null, promoterPledge: sh?.promoter_pledge === null || sh?.promoter_pledge === undefined ? null : Number(sh.promoter_pledge) },
      governance: (ann ?? []).some((a: { is_governance_concern: boolean; verification_status: string }) => a.is_governance_concern && a.verification_status === "VERIFIED"),
      pos: sentiments.filter((x) => x === "POSITIVE" || x === "VERY_POSITIVE").length,
      neg: sentiments.filter((x) => x === "NEGATIVE" || x === "VERY_NEGATIVE").length,
    });
  }

  const sectorReturns = new Map<string, number[]>();
  for (const p of prepared) {
    const c = p.bars.filter((b) => b.complete);
    if (c.length > 21 && p.s.sector) {
      const r = c.at(-1)!.close / c.at(-21)!.close - 1;
      sectorReturns.set(p.s.sector, [...(sectorReturns.get(p.s.sector) ?? []), r]);
    }
  }
  const benchSeries = [...bench.values()];
  const marketHealthy = benchSeries.length >= 50 ? benchSeries.at(-1)! > benchSeries.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;

  const first = prepared.map((p) =>
    analyseStock({
      symbol: p.s.symbol, companyName: p.s.company_name, exchange: p.s.exchange, sector: p.s.sector, isFinancialSector: p.s.is_financial_sector,
      bars: p.bars, benchmarkCloses: align(p.bars, bench), statements: p.statements, ownership: p.ownership, sharesOutstanding: null, sectorMedianPe: null,
      catalysts: { positiveVerified: p.pos, negativeVerified: p.neg, governanceConcern: p.governance }, globalAlignment: impact?.bySector[p.s.sector ?? ""]?.score ?? null,
      sectorTrendPositive: p.s.sector && sectorReturns.has(p.s.sector) ? median(sectorReturns.get(p.s.sector)!)! > 0 : null, marketHealthy,
      now: now.toISOString(), isDemo: false, source: "market_prices",
    }),
  );
  const peBySector = new Map<string, (number | null)[]>();
  first.forEach((a) => a.sector && peBySector.set(a.sector, [...(peBySector.get(a.sector) ?? []), a.valuation?.pe ?? null]));

  let written = 0;
  const analysisDate = localDate(now);
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i]!;
    const sectorPes = p.s.sector ? peBySector.get(p.s.sector) ?? [] : [];
    // Sector-relative valuation only with ≥3 peers; otherwise the component is reported missing.
    const sectorMedianPe = sectorPes.filter((x) => x !== null).length >= 3 ? median(sectorPes) : null;
    const a = analyseStock({ ...firstInput(first[i]!, p), sectorMedianPe, benchmarkCloses: align(p.bars, bench), marketHealthy, now: now.toISOString() });
    try {
      await persistAnalysis(db, p.s.id, analysisDate, a);
      written += 1;
    } catch (err) {
      log(`persist failed for ${p.s.symbol}`, { error: (err as Error).message });
    }
  }
  return { stocks: stocks.length, analysed: prepared.length, written, benchmarkDays: bench.size };

  function firstInput(a: StockAnalysis, p: (typeof prepared)[number]) {
    return {
      symbol: a.symbol, companyName: a.companyName, exchange: a.exchange, sector: a.sector, isFinancialSector: p.s.is_financial_sector, bars: p.bars,
      statements: p.statements, ownership: p.ownership, sharesOutstanding: null, catalysts: { positiveVerified: p.pos, negativeVerified: p.neg, governanceConcern: p.governance },
      globalAlignment: impact?.bySector[p.s.sector ?? ""]?.score ?? null,
      sectorTrendPositive: p.s.sector && sectorReturns.has(p.s.sector) ? median(sectorReturns.get(p.s.sector)!)! > 0 : null,
      isDemo: false, source: "market_prices",
    };
  }
};

async function persistAnalysis(db: SupabaseClient, stockId: string, analysisDate: string, a: StockAnalysis) {
  const t = a.technical;
  if (t) {
    const { error } = await db.from("technical_indicators").upsert(
      {
        stock_id: stockId, timestamp: t.timestamp, close: t.close, sma_5: t.sma5, sma_10: t.sma10, sma_20: t.sma20, sma_50: t.sma50, sma_100: t.sma100, sma_200: t.sma200,
        ema_20: t.ema20, ema_50: t.ema50, rsi_14: t.rsi14, macd: t.macd, macd_signal: t.macdSignal, macd_histogram: t.macdHistogram, adx_14: t.adx14, atr_14: t.atr14,
        bollinger_upper: t.bollingerUpper, bollinger_middle: t.bollingerMiddle, bollinger_lower: t.bollingerLower, vwap: t.vwap20, average_volume_20d: t.averageVolume20d,
        average_traded_value_20d: t.averageTradedValue20d, relative_volume: t.relativeVolume, relative_strength: t.relativeStrength, support_level: t.support,
        resistance_level: t.resistance, breakout_level: a.breakout.plan?.breakoutLevel ?? a.breakout.resistance, breakout_stage: a.breakout.insufficientData ? null : a.breakout.stage,
        breakout_evidence: a.breakout.criteria, calculation_version: INDICATOR_CALCULATION_VERSION,
      },
      { onConflict: "stock_id,timestamp,calculation_version" },
    );
    if (error) throw new Error(`technical_indicators: ${error.message}`);
  }
  const cat = a.score.components.filter((c) => c.name.startsWith("Catalyst")).reduce((s, c) => s + c.points, 0);
  const glo = a.score.components.filter((c) => c.name.startsWith("Global")).reduce((s, c) => s + c.points, 0);
  const p = a.breakout.plan;
  const { error } = await db.from("stock_analysis").upsert(
    {
      stock_id: stockId, analysis_date: analysisDate, fundamental_score: a.score.fundamental, technical_score: a.score.technical, catalyst_score: cat,
      global_alignment_score: glo, valuation_risk_score: a.score.valuationRisk, total_score: a.score.total, data_coverage: a.score.coverage,
      classification: a.score.classification, rejection_reasons: a.score.rejections, recommendation: a.recommendation,
      entry_low: p?.entryLow ?? null, entry_high: p?.entryHigh ?? null, stop_loss: p?.stopLoss ?? null, target_1: p?.target1 ?? null, target_2: p?.target2 ?? null,
      target_3: p?.target3 ?? null, risk_reward: p?.riskReward ?? null, investment_horizon: p ? "Positional (weeks)" : null, confidence_level: null,
      analysis_json: { analysis: a }, source_references: [a.source], scoring_version: a.versions.scoring, is_demo: a.isDemo,
    },
    { onConflict: "stock_id,analysis_date,scoring_version" },
  );
  if (error) throw new Error(`stock_analysis: ${error.message}`);
}

const globalImpact: JobHandler = async ({ db }) => {
  const market = await loadMarketSnapshot(db);
  const moves = [
    ...market.global.map((q) => ({ instrument: q.symbol, changePct: q.percentageChange, asOf: q.timestamp, source: q.source })),
    ...market.fx.map((q) => ({ instrument: q.pair, changePct: q.percentageChange, asOf: q.timestamp, source: q.source })),
    ...market.commodities.map((q) => ({ instrument: q.instrument, changePct: q.percentageChange, asOf: q.timestamp, source: q.source })),
  ];
  const result = evaluateGlobalImpact(moves, await loadImpactRules(db));
  let ai: unknown = null;
  let aiStatus = "not configured";
  if (integrationStatus().claude && moves.length) {
    try {
      ai = await interpretGlobalImpact(globalEvidence(result, moves));
      aiStatus = "ok";
    } catch (err) {
      aiStatus = err instanceof AiNotConfiguredError ? "not configured" : `rejected: ${(err as Error).message}`;
    }
  }
  const { error } = await db.from("global_impact_snapshots").insert({ sentiment: result.sentiment, sentiment_score: result.sentimentScore, result, ai_interpretation: ai, inputs: moves });
  if (error) throw new Error(`global_impact_snapshots: ${error.message}`);
  return { moves: moves.length, sentiment: result.sentiment, missing: result.missingInstruments.length, ai: aiStatus };
};

const dailyRanking: JobHandler = async ({ db, now, log }) => {
  const research = await loadLatestResearch(db);
  if (!research) return { skipped: "no analysis for today" };
  const date = localDate(now);
  if (research.asOf !== date) return { skipped: `latest analysis is ${research.asOf}, not ${date}` };
  const { data: ids } = await db.from("stocks").select("id,symbol,exchange");
  const idOf = new Map((ids ?? []).map((r: { id: string; symbol: string; exchange: string }) => [`${r.exchange}:${r.symbol}`, r.id]));

  let aiAccepted = 0;
  let aiRejected = 0;
  for (const a of research.top10) {
    const stockId = idOf.get(`${a.exchange}:${a.symbol}`);
    if (!stockId) continue;
    let ai: unknown = null;
    if (integrationStatus().claude) {
      try {
        const r = await researchStock(a);
        ai = { recommendation: r.recommendation, model: r.meta.model, promptVersion: r.meta.promptVersion };
        await db.from("stock_analysis").update({ analysis_json: { analysis: a, ai }, model_version: r.meta.model, prompt_version: r.meta.promptVersion, confidence_level: r.recommendation.evidenceConfidence })
          .eq("stock_id", stockId).eq("analysis_date", date).eq("scoring_version", a.versions.scoring);
        aiAccepted += 1;
      } catch (err) {
        aiRejected += 1;
        log(`AI research rejected for ${a.symbol}`, { error: (err as Error).message, issues: (err as { issues?: string[] }).issues });
      }
    }
  }
  const history = [
    ...research.top10.map((a, i) => ({ a, list: "TOP_10", rank: i + 1 })),
    ...research.top3.map((a, i) => ({ a, list: "TOP_3", rank: i + 1 })),
  ].flatMap(({ a, list, rank }) => {
    const stockId = idOf.get(`${a.exchange}:${a.symbol}`);
    if (!stockId || !a.technical) return [];
    const p = a.breakout.plan;
    return [{
      stock_id: stockId, symbol: a.symbol, exchange: a.exchange, recommended_at: `${date}T10:30:00Z`, recommendation: a.recommendation, list_type: list, rank,
      total_score: a.score.total, reference_price: a.technical.close, entry_low: p?.entryLow ?? null, entry_high: p?.entryHigh ?? null, stop_loss: p?.stopLoss ?? null,
      target_1: p?.target1 ?? null, target_2: p?.target2 ?? null, target_3: p?.target3 ?? null, investment_horizon: p ? "Positional (weeks)" : null,
      market_regime: research.globalImpact?.sentiment ?? null, snapshot: { score: a.score, breakout: a.breakout }, scoring_version: a.versions.scoring, is_demo: a.isDemo,
    }];
  });
  if (history.length) {
    const { error } = await db.from("recommendation_history").upsert(history, { onConflict: "stock_id,recommended_at,list_type", ignoreDuplicates: true });
    if (error) throw new Error(`recommendation_history: ${error.message}`);
  }
  return { top10: research.top10.length, top3: research.top3.length, aiAccepted, aiRejected, historyRows: history.length };
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function enqueue(db: SupabaseClient, type: ReportType, key: string, params: string[], scheduledFor: Date, isDemo: boolean) {
  const e = env();
  if (!e.WHATSAPP_RECIPIENT) return { queued: false, reason: "WHATSAPP_RECIPIENT not set" };
  if (e.WHATSAPP_RECIPIENT_OPTED_IN !== "true") return { queued: false, reason: "recipient opt-in not recorded (WHATSAPP_RECIPIENT_OPTED_IN)" };
  const hash = recipientHash(e.WHATSAPP_RECIPIENT);
  const { error } = await db.from("notification_jobs").insert({
    message_type: type, recipient_hash: hash, idempotency_key: `${type}:${key}:${hash}`, scheduled_for: scheduledFor.toISOString(),
    payload: { template: TEMPLATE_FOR[type], languageCode: "en", bodyParams: params }, is_demo: isDemo,
  });
  if (error?.code === "23505") return { queued: false, reason: "already queued (idempotent)" };
  if (error) throw new Error(`notification_jobs: ${error.message}`);
  return { queued: true };
}

const reportJob = (type: Exclude<ReportType, "EXCEPTIONAL_ALERT">): JobHandler => async (ctx) => {
  const { db, now } = ctx;
  const research = await loadLatestResearch(db);
  const market = await loadMarketSnapshot(db);
  const date = localDate(now);
  let params: string[];
  if (type === "GLOBAL_PREMARKET") params = globalPremarketParams(now, market, research, market.global.some((q) => q.isDemo));
  else if (!research) return { skipped: "no research available" };
  else if (type === "INDIA_PREMARKET") params = indiaPremarketParams(now, research);
  else params = dailyCloseParams(now, research, market);
  const isDemo = research?.mode === "demo" || market.global.some((q) => q.isDemo);
  await db.from("daily_reports").upsert({ report_type: type, report_date: date, content: { params }, rendered_text: params.join("\n"), is_demo: isDemo }, { onConflict: "report_type,report_date,is_demo" });
  const q = await enqueue(db, type, date, params, now, isDemo);
  const sent = q.queued ? await dispatch(ctx) : null;
  return { ...q, dispatch: sent };
};

const exceptionalAlerts: JobHandler = async (ctx) => {
  const research = await loadLatestResearch(ctx.db);
  if (!research) return { skipped: "no research available" };
  const market = await loadMarketSnapshot(ctx.db);
  const alert = exceptionalAlertParams(research, market);
  if (!alert) return { alert: false };
  const q = await enqueue(ctx.db, "EXCEPTIONAL_ALERT", alert.key, alert.params, ctx.now, research.mode === "demo");
  return { alert: true, ...q, dispatch: q.queued ? await dispatch(ctx) : null };
};

async function dispatch({ db, log }: JobContext): Promise<Record<string, unknown>> {
  const e = env();
  if (!e.WHATSAPP_ACCESS_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID || !e.WHATSAPP_RECIPIENT) return { skipped: "WhatsApp credentials not configured" };
  const nowIso = new Date().toISOString();
  const { data: due, error } = await db
    .from("notification_jobs")
    .select("*")
    .in("status", ["PENDING", "FAILED"])
    .lte("scheduled_for", nowIso)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .limit(20);
  if (error) throw new Error(`notification_jobs: ${error.message}`);
  let sent = 0;
  let failed = 0;
  for (const job of due ?? []) {
    if (job.retry_count >= job.max_retries) continue;
    if (job.recipient_hash !== recipientHash(e.WHATSAPP_RECIPIENT)) continue;
    // Claim the job; a concurrent dispatcher loses the race and skips it.
    const { data: claimed } = await db.from("notification_jobs").update({ status: "SENDING" }).eq("id", job.id).eq("status", job.status).select("id").maybeSingle();
    if (!claimed) continue;
    const attempt = job.retry_count + 1;
    const result = await sendTemplate(
      { accessToken: e.WHATSAPP_ACCESS_TOKEN, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID, apiVersion: e.WHATSAPP_API_VERSION },
      { to: e.WHATSAPP_RECIPIENT, template: job.payload.template, languageCode: job.payload.languageCode, bodyParams: job.payload.bodyParams },
    );
    await db.from("notification_logs").insert({ job_id: job.id, attempt, event: result.ok ? "PROVIDER_ACCEPTED" : result.status === 0 ? "NETWORK_ERROR" : "PROVIDER_REJECTED", http_status: result.status || null, provider_response: result.response });
    if (result.ok) {
      sent += 1;
      await db.from("notification_jobs").update({ status: "SENT", sent_at: new Date().toISOString(), provider_message_id: result.messageId, retry_count: attempt, last_error: null }).eq("id", job.id);
    } else {
      failed += 1;
      const terminal = !result.retryable || attempt >= job.max_retries;
      await db.from("notification_jobs").update({
        status: "FAILED", retry_count: terminal ? job.max_retries : attempt, last_error: JSON.stringify(result.response).slice(0, 1000),
        next_attempt_at: terminal ? null : new Date(Date.now() + 2 ** attempt * 60_000).toISOString(),
      }).eq("id", job.id);
      log("WhatsApp send failed", { job: job.id, status: result.status, retryable: result.retryable });
    }
  }
  return { due: due?.length ?? 0, sent, failed };
}

// ---------------------------------------------------------------------------
// Performance, data quality, maintenance
// ---------------------------------------------------------------------------

const recommendationPerformance: JobHandler = async ({ db }) => {
  const { data: recs, error } = await db.from("recommendation_history").select("*").gte("recommended_at", new Date(Date.now() - 180 * 86_400_000).toISOString()).limit(5000);
  if (error) throw new Error(`recommendation_history: ${error.message}`);
  let evaluated = 0;
  for (const r of recs ?? []) {
    const { data: prices } = await db.from("market_prices").select("timestamp,high,low,close").eq("stock_id", r.stock_id).eq("interval", "1d").eq("is_complete", true).gt("timestamp", r.recommended_at).order("timestamp").limit(120);
    const o = evaluateOutcome(
      { recommendedAt: r.recommended_at, referencePrice: Number(r.reference_price), entryLow: r.entry_low && Number(r.entry_low), entryHigh: r.entry_high && Number(r.entry_high), stopLoss: r.stop_loss && Number(r.stop_loss), target1: r.target_1 && Number(r.target_1), target2: r.target_2 && Number(r.target_2), target3: r.target_3 && Number(r.target_3) },
      (prices ?? []).map((p: { timestamp: string; high: number; low: number; close: number }) => ({ date: String(p.timestamp).slice(0, 10), high: Number(p.high), low: Number(p.low), close: Number(p.close) })),
    );
    await db.from("recommendation_outcomes").upsert({
      recommendation_id: r.id, status: o.status, entry_triggered_at: o.entryTriggeredAt, exit_at: o.exitAt, exit_price: o.exitPrice, return_pct: o.returnPct,
      max_favourable_excursion_pct: o.maxFavourableExcursionPct, max_adverse_excursion_pct: o.maxAdverseExcursionPct, holding_days: o.holdingDays, evaluated_at: new Date().toISOString(),
    });
    for (const p of prices ?? []) {
      await db.from("recommendation_price_history").upsert({ recommendation_id: r.id, trade_date: String(p.timestamp).slice(0, 10), close: p.close, high: p.high, low: p.low }, { ignoreDuplicates: true });
    }
    evaluated += 1;
  }
  return { evaluated };
};

const dataQuality: JobHandler = async ({ db, now }) => {
  let issues = 0;
  const year = localDate(now).slice(0, 4);
  const { count } = await db.from("market_holidays").select("*", { count: "exact", head: true }).gte("holiday_date", `${year}-01-01`).lte("holiday_date", `${year}-12-31`);
  if (!count) {
    await qualityIssue(db, "HOLIDAY_CALENDAR_MISSING", "WARNING", "calendar", year, { message: `No NSE/BSE holidays loaded for ${year}; load the official exchange circular into market_holidays.` });
    issues += 1;
  }
  const { data: latest } = await db.from("v_latest_stock_prices").select("stock_id,symbol,timestamp");
  for (const r of latest ?? []) {
    if (now.getTime() - Date.parse(r.timestamp) > 100 * 3_600_000) {
      await qualityIssue(db, "STALE", "WARNING", "stock", r.stock_id, { symbol: r.symbol, lastPrice: r.timestamp });
      issues += 1;
    }
  }
  const { data: health } = await db.from("provider_health").select("*").gt("consecutive_failures", 2);
  for (const h of health ?? []) {
    await qualityIssue(db, "PROVIDER_FAILING", "ERROR", "provider", `${h.provider}:${h.capability}`, { consecutiveFailures: h.consecutive_failures, lastError: h.last_error });
    issues += 1;
  }
  return { issues };
};

const refreshViews: JobHandler = async ({ db }) => {
  const { error } = await db.rpc("refresh_market_views");
  if (error) throw new Error(`refresh_market_views: ${error.message}`);
  return { refreshed: true };
};

export const HANDLERS: Record<string, JobHandler> = {
  ingest_india_prices: ingestIndiaPrices,
  ingest_global_markets: ingestGlobalMarkets,
  ingest_news: ingestNews,
  compute_analysis: async (ctx) => {
    const m = await computeAnalysis(ctx);
    await refreshViews(ctx);
    return m;
  },
  global_impact: globalImpact,
  daily_ranking: dailyRanking,
  whatsapp_global_premarket: reportJob("GLOBAL_PREMARKET"),
  whatsapp_india_premarket: reportJob("INDIA_PREMARKET"),
  whatsapp_daily_close: reportJob("DAILY_CLOSE"),
  exceptional_alerts: exceptionalAlerts,
  dispatch_notifications: dispatch,
  recommendation_performance: recommendationPerformance,
  data_quality: dataQuality,
  refresh_views: refreshViews,
};

