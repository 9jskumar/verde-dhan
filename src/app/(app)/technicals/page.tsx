import Link from "next/link";
import { NoResearch } from "@/components/no-research";
import { StageBadge } from "@/components/research";
import { Card, cn, Num, PageHeader, Table, Td } from "@/components/ui";
import { getResearch } from "@/lib/data/repository";

function Above({ close, ma }: { close: number | undefined; ma: number | null | undefined }) {
  if (close === undefined || ma === null || ma === undefined) return <span className="text-text-3">n/a</span>;
  return <span className={cn("num", close >= ma ? "text-gain" : "text-loss")}>{ma.toFixed(2)}</span>;
}

export default async function TechnicalsPage() {
  const r = await getResearch();
  return (
    <>
      <PageHeader title="Technical Analysis" description="Indicators on completed daily candles. Wilder smoothing for RSI, ATR and ADX; values match TA-Lib." />
      {!r ? <NoResearch /> : (
        <Card title="Indicator snapshot" subtitle="Moving averages are green when price is above them">
          <Table head={["Stock", "Close", "SMA 20", "SMA 50", "SMA 200", "RSI 14", "MACD hist", "ADX 14", "ATR %", "Rel. volume", "Support", "Resistance", "Setup"]}>
            {r.analyses.map((a) => {
              const t = a.technical;
              return (
                <tr key={a.symbol}>
                  <Td><Link className="font-medium hover:underline" href={`/stocks/${a.symbol}`}>{a.symbol}</Link></Td>
                  <Td><Num value={t?.close} /></Td>
                  <Td><Above close={t?.close} ma={t?.sma20} /></Td>
                  <Td><Above close={t?.close} ma={t?.sma50} /></Td>
                  <Td><Above close={t?.close} ma={t?.sma200} /></Td>
                  <Td><Num value={t?.rsi14} dp={1} className={t?.rsi14 && t.rsi14 > 75 ? "text-warn" : ""} /></Td>
                  <Td><Num value={t?.macdHistogram} /></Td>
                  <Td><Num value={t?.adx14} dp={1} /></Td>
                  <Td><Num value={t?.atrPct} /></Td>
                  <Td><Num value={t?.relativeVolume} /></Td>
                  <Td><Num value={t?.support} /></Td>
                  <Td><Num value={t?.resistance} /></Td>
                  <Td><StageBadge stage={a.breakout.insufficientData ? null : a.breakout.stage} /></Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
    </>
  );
}
