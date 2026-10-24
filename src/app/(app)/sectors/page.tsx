import { NoResearch } from "@/components/no-research";
import { Card, Change, cn, PageHeader, Table, Td } from "@/components/ui";
import { getResearch } from "@/lib/data/repository";

export default async function SectorsPage() {
  const r = await getResearch();
  return (
    <>
      <PageHeader title="Sector Analysis" description="Latest-session sector moves from tracked constituents, alongside the rule-based global impact score for each sector." />
      {!r ? <NoResearch /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Sector performance" subtitle="Equal-weighted average change of tracked stocks">
            <Table head={["Sector", "Avg change", "Stocks", "Global impact"]}>
              {[...r.sectors].sort((a, b) => b.avgChangePct - a.avgChangePct).map((s) => {
                const g = r.globalImpact?.bySector[s.sector]?.score;
                return (
                  <tr key={s.sector}>
                    <Td>{s.sector}</Td>
                    <Td><Change value={s.avgChangePct} /></Td>
                    <Td className="num">{s.constituents}</Td>
                    <Td>{g === undefined ? <span className="text-text-3">none</span> : <span className={cn("num", g > 0 ? "text-gain" : g < 0 ? "text-loss" : "")}>{g.toFixed(2)}</span>}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
          <Card title="Global drivers by sector" subtitle="Which overnight moves triggered which rules">
            {r.globalImpact && Object.keys(r.globalImpact.bySector).length ? (
              <ul className="space-y-3 text-sm">
                {Object.values(r.globalImpact.bySector).sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).map((s) => (
                  <li key={s.sector}>
                    <p className="font-medium">{s.sector} <span className={cn("num text-xs", s.score > 0 ? "text-gain" : "text-loss")}>{s.score.toFixed(2)}</span></p>
                    <ul className="mt-1 space-y-0.5 text-xs text-text-2">
                      {s.drivers.map((d) => (
                        <li key={d.ruleId}><span className="num">{d.instrument} {d.changePct > 0 ? "+" : ""}{d.changePct.toFixed(2)}%</span> · {d.mechanism} <span className="text-text-3">({d.confidence.toLowerCase()} confidence)</span></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-text-3">No impact rule triggered: overnight moves were below every rule's threshold.</p>}
            {r.globalImpact && <p className="mt-3 text-[11px] text-text-3">{r.globalImpact.disclaimer}</p>}
          </Card>
        </div>
      )}
    </>
  );
}
