"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { positionSize, riskReward } from "@/lib/quant/risk";
import { fmt } from "./ui";

const schema = z
  .object({
    capital: z.coerce.number().positive("Capital must be positive"),
    riskPct: z.coerce.number().gt(0).max(10, "Keep risk per trade at or below 10%"),
    entry: z.coerce.number().positive(),
    stopLoss: z.coerce.number().positive(),
    target: z.coerce.number().positive(),
    maxPositionPct: z.coerce.number().gt(0).max(100),
  })
  .refine((v) => v.stopLoss < v.entry, { message: "Stop-loss must be below entry for a long position", path: ["stopLoss"] });
type Input = z.input<typeof schema>;

const cls = "h-9 w-full rounded-md border border-line bg-bg px-2 text-sm num focus:outline-none focus:ring-2 focus:ring-accent/40";

export function RiskCalculator({ defaults }: { defaults: { capital: number | null; riskPct: number } }) {
  const { register, control, formState } = useForm<Input>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { capital: defaults.capital ?? "", riskPct: defaults.riskPct, entry: "", stopLoss: "", target: "", maxPositionPct: 25 },
  });
  const v = useWatch({ control });
  const parsed = schema.safeParse(v);
  const out = parsed.success
    ? { size: positionSize({ capital: parsed.data.capital, riskPerTradePct: parsed.data.riskPct, entry: parsed.data.entry, stopLoss: parsed.data.stopLoss, maxPositionPct: parsed.data.maxPositionPct }), rr: riskReward(parsed.data.entry, parsed.data.stopLoss, parsed.data.target) }
    : null;
  const field = (name: keyof Input, label: string) => (
    <label className="block text-xs text-text-2">
      {label}
      <input type="number" step="any" inputMode="decimal" className={cls} {...register(name)} aria-invalid={Boolean(formState.errors[name])} />
      {formState.errors[name] && <span className="text-[11px] text-loss">{formState.errors[name]?.message}</span>}
    </label>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form className="space-y-3" onSubmit={(e) => e.preventDefault()} aria-label="Position size inputs">
        {field("capital", "Trading capital (₹)")}
        {field("riskPct", "Risk per trade (% of capital)")}
        {field("entry", "Entry price (₹)")}
        {field("stopLoss", "Stop-loss (₹)")}
        {field("target", "Target (₹)")}
        {field("maxPositionPct", "Max position size (% of capital)")}
      </form>
      <div className="rounded-lg border border-line bg-panel-2/40 p-4" aria-live="polite">
        {out ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-text-3">Quantity</dt><dd className="num text-lg font-semibold">{out.size.quantity.toLocaleString("en-IN")}</dd>
            <dt className="text-text-3">Position value</dt><dd className="num">₹{fmt(out.size.positionValue)}</dd>
            <dt className="text-text-3">Capital at risk</dt><dd className="num text-loss">₹{fmt(out.size.riskAmount)}</dd>
            <dt className="text-text-3">Risk per share</dt><dd className="num">₹{fmt(out.size.riskPerShare)}</dd>
            <dt className="text-text-3">Share of capital</dt><dd className="num">{fmt(out.size.positionPctOfCapital)}%</dd>
            <dt className="text-text-3">Risk : reward</dt><dd className="num">{out.rr === null ? "target must be above entry" : `1 : ${fmt(out.rr)}`}</dd>
            {out.size.cappedByConcentration && <p className="col-span-2 text-xs text-warn">Quantity was reduced to respect the maximum position size.</p>}
            {out.size.quantity === 0 && <p className="col-span-2 text-xs text-warn">The risk budget is smaller than the risk on one share.</p>}
          </dl>
        ) : <p className="text-sm text-text-3">Enter capital, entry, stop-loss and target to size the position.</p>}
        <p className="mt-4 text-[11px] text-text-3">Sizing assumes the stop is filled at its price. Gaps and slippage can make the real loss larger.</p>
      </div>
    </div>
  );
}
