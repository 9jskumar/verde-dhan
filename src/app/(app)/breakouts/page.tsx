import { NoResearch } from "@/components/no-research";
import { OpportunityTable, STAGE_LABEL } from "@/components/research";
import { Card, PageHeader } from "@/components/ui";
import { getResearch } from "@/lib/data/repository";
import type { BreakoutStage } from "@/lib/quant/breakout";

const ORDER: { stage: BreakoutStage; note: string }[] = [
  { stage: "CONFIRMED", note: "Closed above resistance with volume, trend and momentum confirmation." },
  { stage: "RETEST", note: "Broke out earlier and is now holding the old resistance as support." },
  { stage: "EARLY", note: "Pressing against resistance in a tightening base; not yet confirmed." },
  { stage: "FAILED", note: "Broke out and fell back below the level. These are rejected." },
];

export default async function BreakoutsPage() {
  const r = await getResearch();
  return (
    <>
      <PageHeader title="Breakout Scanner" description="Every completed daily candle is checked against documented breakout criteria. Intraday crosses are flagged but never counted as confirmed." />
      {!r ? <NoResearch /> : (
        <div className="space-y-4">
          {ORDER.map(({ stage, note }) => {
            const rows = r.analyses.filter((a) => a.breakout.stage === stage).sort((a, b) => b.score.total - a.score.total);
            return (
              <Card key={stage} title={`${STAGE_LABEL[stage]} (${rows.length})`} subtitle={note}>
                {rows.length ? <OpportunityTable rows={rows} showRank={false} /> : <p className="text-sm text-text-3">None today.</p>}
              </Card>
            );
          })}
          {r.analyses.some((a) => a.breakout.intradayCrossPending) && (
            <p className="text-xs text-warn">Some stocks are above resistance intraday. They are pending until the session's candle completes.</p>
          )}
        </div>
      )}
    </>
  );
}
