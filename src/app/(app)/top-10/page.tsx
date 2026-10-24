import { NoResearch } from "@/components/no-research";
import { OpportunityTable } from "@/components/research";
import { Card, PageHeader } from "@/components/ui";
import { getResearch } from "@/lib/data/repository";

export default async function Top10Page() {
  const r = await getResearch();
  return (
    <>
      <PageHeader title="Top 10 Opportunities" description="Highest composite scores among stocks that passed every mandatory rejection rule. A high score never overrides a risk flag." />
      {r ? (
        <Card title="Ranked by composite score" subtitle={`${r.top10.length} of ${r.analyses.length} analysed stocks qualify`}>
          {r.top10.length ? <OpportunityTable rows={r.top10} /> : <p className="text-sm text-text-2">No stock cleared the qualification bar today. That is a valid outcome, not an error.</p>}
        </Card>
      ) : <NoResearch />}
      <p className="mt-3 text-xs text-text-3">Scores are a rules-based ranking of evidence, not a probability of profit. Entry, stop and targets are derived from ATR and the breakout level; see QUANT_CONVENTIONS.md.</p>
    </>
  );
}
