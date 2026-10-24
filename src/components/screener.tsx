"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Num, Table, Td } from "./ui";

export interface ScreenerRow {
  symbol: string;
  name: string;
  sector: string | null;
  score: number;
  rejected: boolean;
  stage: string;
  roe: number | null;
  debtEquity: number | null;
  revenueGrowth: number | null;
  pe: number | null;
  rsi: number | null;
  relativeVolume: number | null;
  tradedValueCr: number | null;
  aboveSma200: boolean | null;
}

const optionalNumber = z.union([z.literal(""), z.coerce.number()]).transform((v) => (v === "" ? null : v));

const filterSchema = z.object({
  sector: z.string(),
  minScore: optionalNumber,
  minRoe: optionalNumber,
  maxDebtEquity: optionalNumber,
  minRevenueGrowth: optionalNumber,
  maxPe: optionalNumber,
  minTradedValueCr: optionalNumber,
  stage: z.string(),
  aboveSma200: z.boolean(),
  includeRejected: z.boolean(),
});
type FilterInput = z.input<typeof filterSchema>;

const DEFAULTS: FilterInput = { sector: "", minScore: "", minRoe: "", maxDebtEquity: "", minRevenueGrowth: "", maxPe: "", minTradedValueCr: "", stage: "", aboveSma200: false, includeRejected: false };

const inputCls = "h-8 w-full rounded-md border border-line bg-bg px-2 text-sm num focus:outline-none focus:ring-2 focus:ring-accent/40";

export function Screener({ rows }: { rows: ScreenerRow[] }) {
  const { register, control, reset } = useForm<FilterInput>({ resolver: zodResolver(filterSchema), defaultValues: DEFAULTS, mode: "onChange" });
  const values = useWatch({ control });
  const parsed = filterSchema.safeParse({ ...DEFAULTS, ...values });
  const f = parsed.success ? parsed.data : null;
  const sectors = useMemo(() => [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort() as string[], [rows]);

  const result = useMemo(() => {
    if (!f) return rows;
    // A missing value fails a numeric filter: unknown is never treated as passing.
    const gte = (v: number | null, min: number | null) => min === null || (v !== null && v >= min);
    const lte = (v: number | null, max: number | null) => max === null || (v !== null && v <= max);
    return rows
      .filter((r) => (f.includeRejected || !r.rejected) && (!f.sector || r.sector === f.sector) && (!f.stage || r.stage === f.stage))
      .filter((r) => gte(r.score, f.minScore) && gte(r.roe, f.minRoe) && lte(r.debtEquity, f.maxDebtEquity) && gte(r.revenueGrowth, f.minRevenueGrowth) && lte(r.pe, f.maxPe) && gte(r.tradedValueCr, f.minTradedValueCr))
      .filter((r) => !f.aboveSma200 || r.aboveSma200 === true)
      .sort((a, b) => b.score - a.score);
  }, [rows, f]);

  const num = (name: keyof FilterInput, label: string, step = "any") => (
    <label className="text-xs text-text-2">
      {label}
      <input type="number" step={step} inputMode="decimal" className={inputCls} {...register(name)} />
    </label>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <form className="space-y-3 rounded-lg border border-line bg-panel p-4" onSubmit={(e) => e.preventDefault()} aria-label="Screener filters">
        <label className="block text-xs text-text-2">
          Sector
          <select className={inputCls} {...register("sector")}>
            <option value="">All sectors</option>
            {sectors.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block text-xs text-text-2">
          Breakout stage
          <select className={inputCls} {...register("stage")}>
            <option value="">Any</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="RETEST">Retest</option>
            <option value="EARLY">Early</option>
            <option value="NONE">No setup</option>
          </select>
        </label>
        {num("minScore", "Min composite score")}
        {num("minRoe", "Min ROE %")}
        {num("maxDebtEquity", "Max debt / equity")}
        {num("minRevenueGrowth", "Min revenue growth %")}
        {num("maxPe", "Max P/E")}
        {num("minTradedValueCr", "Min avg traded value (₹ cr)")}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("aboveSma200")} /> Above 200-day SMA</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("includeRejected")} /> Include rejected stocks</label>
        <button type="button" onClick={() => reset(DEFAULTS)} className="text-xs text-accent hover:underline">Reset filters</button>
      </form>
      <div className="min-w-0 rounded-lg border border-line bg-panel p-4">
        <p className="mb-2 text-xs text-text-3" aria-live="polite">{result.length} of {rows.length} stocks match. A stock with a missing value fails that filter.</p>
        <Table head={["Stock", "Sector", "Score", "Stage", "ROE", "D/E", "Rev growth", "P/E", "RSI", "Traded ₹cr"]}>
          {result.map((r) => (
            <tr key={r.symbol} className={r.rejected ? "opacity-60" : ""}>
              <Td><Link href={`/stocks/${r.symbol}`} className="font-medium hover:underline">{r.symbol}</Link>{r.rejected && <span className="ml-1 text-[11px] text-loss">rejected</span>}<div className="max-w-[14rem] truncate text-xs text-text-3">{r.name}</div></Td>
              <Td className="text-text-2">{r.sector ?? "n/a"}</Td>
              <Td><Num value={r.score} dp={1} /></Td>
              <Td className="text-xs text-text-2">{r.stage.toLowerCase()}</Td>
              <Td><Num value={r.roe} dp={1} /></Td>
              <Td><Num value={r.debtEquity} /></Td>
              <Td><Num value={r.revenueGrowth} dp={1} /></Td>
              <Td><Num value={r.pe} dp={1} /></Td>
              <Td><Num value={r.rsi} dp={1} /></Td>
              <Td><Num value={r.tradedValueCr} dp={1} /></Td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}
