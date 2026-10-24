import Link from "next/link";
import { NoResearch } from "@/components/no-research";
import { Card, Num, PageHeader, Table, Td } from "@/components/ui";
import { getResearch } from "@/lib/data/repository";

export default async function FundamentalsPage() {
  const r = await getResearch();
  return (
    <>
      <PageHeader title="Fundamental Analysis" description="Annual consolidated statements where available, otherwise standalone. Bases are never mixed in one calculation." />
      {!r ? <NoResearch /> : (
        <Card title="Latest annual metrics" subtitle="Growth and returns in %, ratios in times">
          <Table head={["Stock", "Basis", "Period", "Rev growth", "PAT growth", "Rev CAGR 3y", "EBITDA margin", "ROE", "ROCE", "D/E", "Int. cover", "CFO/PAT", "P/E", "P/B", "F score /40"]}>
            {r.analyses.map((a) => {
              const f = a.fundamentals;
              return (
                <tr key={a.symbol}>
                  <Td><Link className="font-medium hover:underline" href={`/stocks/${a.symbol}`}>{a.symbol}</Link></Td>
                  <Td className="text-text-2">{f?.basis ?? "n/a"}</Td>
                  <Td className="num text-text-2">{f?.latestPeriod ?? "n/a"}</Td>
                  <Td><Num value={f?.revenueGrowth} dp={1} /></Td>
                  <Td><Num value={f?.patGrowth} dp={1} /></Td>
                  <Td><Num value={f?.revenueCagr3y} dp={1} /></Td>
                  <Td><Num value={f?.ebitdaMargin} dp={1} /></Td>
                  <Td><Num value={f?.roe} dp={1} /></Td>
                  <Td><Num value={f?.roce} dp={1} /></Td>
                  <Td><Num value={f?.debtEquity} /></Td>
                  <Td><Num value={f?.interestCoverage} dp={1} /></Td>
                  <Td><Num value={f?.cfoPatRatio} /></Td>
                  <Td><Num value={a.valuation?.pe} dp={1} /></Td>
                  <Td><Num value={a.valuation?.pb} dp={1} /></Td>
                  <Td><Num value={a.score.fundamental} dp={1} /></Td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-3 text-xs text-text-3">n/a means the input was missing, not zero. Missing inputs lower data coverage, and coverage below 70% rejects the stock.</p>
        </Card>
      )}
    </>
  );
}
