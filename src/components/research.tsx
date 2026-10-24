import Link from "next/link";
import type { StockAnalysis } from "@/lib/analysis/pipeline";
import type { BreakoutStage } from "@/lib/quant/breakout";
import { CLASSIFICATION_LABEL, type Classification, type Recommendation } from "@/lib/quant/scoring";
import { Badge, cn, Num, Table, Td } from "./ui";

export const STAGE_LABEL: Record<BreakoutStage, string> = {
  CONFIRMED: "Confirmed breakout",
  RETEST: "Breakout retest",
  EARLY: "Early breakout",
  FAILED: "Failed breakout",
  NONE: "No setup",
};

const STAGE_TONE: Record<BreakoutStage, "gain" | "info" | "accent" | "loss" | "neutral"> = {
  CONFIRMED: "gain",
  RETEST: "info",
  EARLY: "accent",
  FAILED: "loss",
  NONE: "neutral",
};

export function StageBadge({ stage }: { stage: BreakoutStage | null }) {
  if (!stage) return <Badge>Insufficient data</Badge>;
  return <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>;
}

const REC_LABEL: Record<Recommendation, string> = {
  BUY_BREAKOUT: "Buy breakout",
  BUY_ON_BREAKOUT: "Buy on breakout",
  BUY_ON_RETEST: "Buy on retest",
  WATCH: "Watch",
  AVOID: "Avoid",
};

export function RecBadge({ rec }: { rec: Recommendation }) {
  const tone = rec === "AVOID" ? "loss" : rec === "WATCH" ? "neutral" : "gain";
  return <Badge tone={tone}>{REC_LABEL[rec]}</Badge>;
}

export function ClassBadge({ c }: { c: Classification }) {
  const tone = c === "REJECTED" ? "loss" : c === "EXCEPTIONAL" || c === "HIGH_POTENTIAL" ? "accent" : c === "QUALIFIED" ? "gain" : "neutral";
  return <Badge tone={tone}>{CLASSIFICATION_LABEL[c]}</Badge>;
}

export function ScoreBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-text-2">{label}</span>
        <span className="num text-text">
          {value.toFixed(1)} <span className="text-text-3">/ {max}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-panel-2" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function OpportunityTable({ rows, showRank = true }: { rows: StockAnalysis[]; showRank?: boolean }) {
  return (
    <Table head={[...(showRank ? ["#"] : []), "Stock", "Sector", "Score", "F /40", "T /35", "C+G /15", "V+R /10", "Setup", "Call", "Entry", "Stop", "T1 / T2", "R:R"]}>
      {rows.map((a, i) => {
        const p = a.breakout.plan;
        return (
          <tr key={a.symbol} className="hover:bg-panel-2/60">
            {showRank && <Td className="num text-text-3">{i + 1}</Td>}
            <Td>
              <Link href={`/stocks/${a.symbol}`} className="font-medium text-text hover:text-accent hover:underline">
                {a.symbol}
              </Link>
              <div className="max-w-[16rem] truncate text-xs text-text-3">{a.companyName}</div>
            </Td>
            <Td className="text-text-2">{a.sector ?? "n/a"}</Td>
            <Td>
              <span className={cn("num font-semibold", a.score.total >= 75 ? "text-accent" : "text-text")}>{a.score.total.toFixed(1)}</span>
            </Td>
            <Td><Num value={a.score.fundamental} dp={1} /></Td>
            <Td><Num value={a.score.technical} dp={1} /></Td>
            <Td><Num value={a.score.catalystGlobal} dp={1} /></Td>
            <Td><Num value={a.score.valuationRisk} dp={1} /></Td>
            <Td><StageBadge stage={a.breakout.insufficientData ? null : a.breakout.stage} /></Td>
            <Td><RecBadge rec={a.recommendation} /></Td>
            <Td className="num">{p ? `${p.entryLow.toFixed(2)}–${p.entryHigh.toFixed(2)}` : <span className="text-text-3">n/a</span>}</Td>
            <Td><Num value={p?.stopLoss} /></Td>
            <Td className="num">{p ? `${p.target1.toFixed(2)} / ${p.target2.toFixed(2)}` : <span className="text-text-3">n/a</span>}</Td>
            <Td><Num value={p?.riskReward} /></Td>
          </tr>
        );
      })}
    </Table>
  );
}
