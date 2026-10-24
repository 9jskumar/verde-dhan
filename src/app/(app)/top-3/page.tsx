import Link from "next/link";
import { NoResearch } from "@/components/no-research";
import { ClassBadge, RecBadge, ScoreBar, StageBadge } from "@/components/research";
import { Badge, Card, fmt, PageHeader } from "@/components/ui";
import { getResearch } from "@/lib/data/repository";

export default async function Top3Page() {
  const r = await getResearch();
  return (
    <>
      <PageHeader title="Top 3 Opportunities" description="The three strongest qualified setups, with the plan and what would invalidate it." />
      {!r ? <NoResearch /> : r.top3.length === 0 ? (
        <Card><p className="text-sm text-text-2">No stock met the Top 3 bar today.</p></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {r.top3.map((a, i) => {
            const p = a.breakout.plan;
            return (
              <Card key={a.symbol} title={<span className="flex items-center gap-2"><span className="num text-text-3">#{i + 1}</span><Link href={`/stocks/${a.symbol}`} className="hover:underline">{a.symbol}</Link>{a.isDemo && <Badge tone="demo">demo</Badge>}</span>} subtitle={`${a.companyName} · ${a.sector ?? "n/a"}`}>
                <div className="flex flex-wrap gap-1.5"><ClassBadge c={a.score.classification} /><StageBadge stage={a.breakout.stage} /><RecBadge rec={a.recommendation} /></div>
                <p className="num mt-3 text-2xl font-semibold text-accent">{a.score.total.toFixed(1)}<span className="text-sm text-text-3"> / 100</span></p>
                <div className="mt-3 space-y-2">
                  <ScoreBar label="Fundamental" value={a.score.fundamental} max={40} />
                  <ScoreBar label="Technical" value={a.score.technical} max={35} />
                  <ScoreBar label="Catalyst + global" value={a.score.catalystGlobal} max={15} />
                  <ScoreBar label="Valuation + risk" value={a.score.valuationRisk} max={10} />
                </div>
                {p ? (
                  <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-text-3">Entry zone</dt><dd className="num">{fmt(p.entryLow)}–{fmt(p.entryHigh)}</dd>
                    <dt className="text-text-3">Stop-loss</dt><dd className="num text-loss">{fmt(p.stopLoss)}</dd>
                    <dt className="text-text-3">Targets</dt><dd className="num text-gain">{fmt(p.target1)} / {fmt(p.target2)} / {fmt(p.target3)}</dd>
                    <dt className="text-text-3">Risk : reward (T2)</dt><dd className="num">{fmt(p.riskReward)}</dd>
                    <dt className="text-text-3">Invalidation</dt><dd className="num">close below {fmt(p.invalidationLevel)}</dd>
                  </dl>
                ) : <p className="mt-4 text-sm text-text-3">No trade plan: the setup has no defined breakout level yet.</p>}
                <p className="mt-3 text-[11px] text-text-3">Data coverage {(a.score.coverage * 100).toFixed(0)}% · as of {a.asOf?.slice(0, 10) ?? "n/a"}</p>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
