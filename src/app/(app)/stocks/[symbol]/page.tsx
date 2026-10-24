import { notFound } from "next/navigation";
import { HistoryChart } from "@/components/charts";
import { ClassBadge, RecBadge, ScoreBar, StageBadge } from "@/components/research";
import { Badge, Card, cn, fmt, Num, PageHeader, SourceNote, Table, Td } from "@/components/ui";
import { getStock, getStockCloses } from "@/lib/data/repository";
import type { Criterion } from "@/lib/quant/breakout";

const REJECTION_TEXT: Record<string, string> = {
  GOVERNANCE_CONCERN: "Verified governance concern",
  UNRELIABLE_DATA: "Too much input data missing (coverage below 70%)",
  STALE_DATA: "Latest price data is too old",
  INADEQUATE_LIQUIDITY: "Average traded value below ₹5 crore",
  SEVERE_TECHNICAL_DETERIORATION: "Severe technical deterioration",
  EXCESSIVE_PROMOTER_PLEDGE: "Promoter pledge above 25%",
  FAILED_BREAKOUT: "Recent breakout failed",
};

function Criteria({ title, items }: { title: string; items: Criterion[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-text-3">{title}</p>
      <ul className="space-y-1 text-sm">
        {items.map((c) => (
          <li key={c.name}>
            <span className="flex items-center gap-2">
              <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", c.met === true ? "bg-gain" : c.met === false ? "bg-loss" : "bg-line")} />
              <span>{c.name}</span>
              <span className="sr-only">{c.met === true ? "met" : c.met === false ? "not met" : "no data"}</span>
            </span>
            <span className="num block pl-4 text-xs text-text-3">{c.value === null ? "n/a" : fmt(c.value)} · {c.threshold}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const a = await getStock(symbol);
  if (!a) notFound();
  const closes = (await getStockCloses(a.symbol)) ?? [];
  const p = a.breakout.plan;
  const levels = p
    ? [
        { y: p.breakoutLevel, label: "Breakout", tone: "accent" as const },
        { y: p.stopLoss, label: "Stop", tone: "loss" as const },
        { y: p.target2, label: "T2", tone: "gain" as const },
      ]
    : [];
  return (
    <>
      <PageHeader title={`${a.symbol} · ${a.companyName}`} description={`${a.exchange} · ${a.sector ?? "Sector n/a"} · analysis as of ${a.asOf?.slice(0, 10) ?? "n/a"}`}>
        <div className="flex flex-wrap gap-1.5">{a.isDemo && <Badge tone="demo">demo data</Badge>}<ClassBadge c={a.score.classification} /><StageBadge stage={a.breakout.insufficientData ? null : a.breakout.stage} /><RecBadge rec={a.recommendation} /></div>
      </PageHeader>
      {a.score.rejections.length > 0 && (
        <div className="mb-4 rounded-md border border-loss/40 bg-loss-soft px-4 py-3 text-sm">
          <p className="font-medium text-loss">Rejected regardless of score</p>
          <ul className="mt-1 list-disc pl-5 text-text-2">{a.score.rejections.map((r) => <li key={r}>{REJECTION_TEXT[r] ?? r}</li>)}</ul>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Price" subtitle="Completed daily closes">
          <HistoryChart data={closes} label={`${a.symbol} close`} levels={levels} height={300} />
          <SourceNote source={a.source} isDemo={a.isDemo} asOf={a.asOf} />
        </Card>
        <Card title="Score" subtitle={`Model ${a.versions.scoring} · coverage ${(a.score.coverage * 100).toFixed(0)}%`}>
          <p className="num text-3xl font-semibold">{a.score.total.toFixed(1)}<span className="text-sm text-text-3"> / 100</span></p>
          <div className="mt-3 space-y-2">
            <ScoreBar label="Fundamental" value={a.score.fundamental} max={40} />
            <ScoreBar label="Technical" value={a.score.technical} max={35} />
            <ScoreBar label="Catalyst + global" value={a.score.catalystGlobal} max={15} />
            <ScoreBar label="Valuation + risk" value={a.score.valuationRisk} max={10} />
          </div>
          {a.score.missing.length > 0 && <p className="mt-3 text-xs text-text-3">Missing inputs: {a.score.missing.join(", ")}</p>}
          <p className="mt-3 text-[11px] text-text-3">The score ranks evidence. It is not a probability of profit.</p>
        </Card>
        <Card title="Trade plan" subtitle="Derived from the breakout level and ATR">
          {p ? (
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-text-3">Breakout level</dt><dd className="num">{fmt(p.breakoutLevel)}</dd>
              <dt className="text-text-3">Entry zone</dt><dd className="num">{fmt(p.entryLow)}–{fmt(p.entryHigh)}</dd>
              <dt className="text-text-3">Stop-loss</dt><dd className="num text-loss">{fmt(p.stopLoss)}</dd>
              <dt className="text-text-3">Target 1 / 2 / 3</dt><dd className="num text-gain">{fmt(p.target1)} / {fmt(p.target2)} / {fmt(p.target3)}</dd>
              <dt className="text-text-3">Risk : reward (T2)</dt><dd className="num">{fmt(p.riskReward)}</dd>
              <dt className="text-text-3">Invalidation</dt><dd className="num">close below {fmt(p.invalidationLevel)}</dd>
            </dl>
          ) : <p className="text-sm text-text-3">No plan: there is no defined breakout level.</p>}
        </Card>
        <Card className="lg:col-span-2" title="Breakout criteria" subtitle={`Algorithm ${a.breakout.version}`}>
          <div className="grid gap-4 md:grid-cols-3">
            <Criteria title="Early" items={a.breakout.criteria.early} />
            <Criteria title="Confirmed" items={a.breakout.criteria.confirmed} />
            <Criteria title="Retest" items={a.breakout.criteria.retest} />
          </div>
        </Card>
        <Card className="lg:col-span-3" title="Score components">
          <Table head={["Component", "Input", "Points", "Max"]}>
            {a.score.components.map((c) => (
              <tr key={c.name}>
                <Td>{c.name}</Td>
                <Td className="num text-text-2">{c.input === null ? "n/a" : typeof c.input === "number" ? fmt(c.input) : c.input}</Td>
                <Td><Num value={c.points} /></Td>
                <Td className="num text-text-3">{c.max}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
