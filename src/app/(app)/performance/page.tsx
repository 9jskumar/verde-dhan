import { requireAccount } from "@/components/account";
import { Badge, Card, Num, PageHeader, Table, Td } from "@/components/ui";
import { supabaseForUser } from "@/lib/supabase/server";

interface Row { list_type: string; market_regime: string; sector: string | null; is_demo: boolean; recommendations: number; hits: number; stopped_out: number; open_positions: number; avg_return_pct: number | null; worst_adverse_excursion_pct: number | null }

export default async function PerformancePage() {
  const header = <PageHeader title="Performance Tracking" description="How past recommendations actually played out against their stated entry, stop and targets. Recommendation records are immutable once written." />;
  const gate = await requireAccount("Performance tracking");
  if (gate) return <>{header}{gate}<p className="mt-3 text-xs text-text-3">A track record is only meaningful on real, stored recommendations, so none is simulated here.</p></>;
  const db = (await supabaseForUser())!;
  const { data } = await db.from("v_recommendation_performance").select("*");
  const rows = (data ?? []) as Row[];
  return (
    <>
      {header}
      <Card title="Outcomes by list, regime and sector">
        {rows.length ? (
          <Table head={["List", "Regime", "Sector", "Recs", "Target hit", "Stopped", "Open", "Hit rate", "Avg return %", "Worst MAE %"]}>
            {rows.map((r, i) => {
              const closed = Number(r.hits) + Number(r.stopped_out);
              return (
                <tr key={i}>
                  <Td>{r.list_type}{r.is_demo && <Badge tone="demo" className="ml-1">demo</Badge>}</Td>
                  <Td className="text-text-2">{r.market_regime}</Td>
                  <Td className="text-text-2">{r.sector ?? "n/a"}</Td>
                  <Td className="num">{r.recommendations}</Td>
                  <Td className="num">{r.hits}</Td>
                  <Td className="num">{r.stopped_out}</Td>
                  <Td className="num">{r.open_positions}</Td>
                  <Td><Num value={closed ? (Number(r.hits) / closed) * 100 : null} dp={1} /></Td>
                  <Td><Num value={r.avg_return_pct === null ? null : Number(r.avg_return_pct)} /></Td>
                  <Td><Num value={r.worst_adverse_excursion_pct === null ? null : Number(r.worst_adverse_excursion_pct)} /></Td>
                </tr>
              );
            })}
          </Table>
        ) : <p className="text-sm text-text-3">No recommendations have been evaluated yet. The performance job runs at 18:30 IST on trading days.</p>}
        <p className="mt-3 text-xs text-text-3">Hit rate is target hits over closed outcomes. Small samples say little; past results do not predict future returns.</p>
      </Card>
    </>
  );
}
