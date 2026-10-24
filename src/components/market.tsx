import { getHistory, type HistoryKind } from "@/lib/data/repository";
import { Sparkline, HistoryChart } from "./charts";
import { Badge, Card, Change, fmt, SourceNote } from "./ui";

export interface QuoteView {
  key: string;
  name: string;
  value: number | null;
  changePct: number | null;
  dp?: number;
  unit?: string;
  timestamp?: string | null;
  source?: string;
  isDemo?: boolean;
  delaySeconds?: number;
  note?: string;
}

export function QuoteCard({ q, spark }: { q: QuoteView; spark?: { t: string; v: number }[] }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-text-2">{q.name}</p>
        {q.isDemo && <Badge tone="demo">demo</Badge>}
      </div>
      <p className="num mt-1 text-lg font-semibold">{q.value === null ? <span className="text-text-3">n/a</span> : fmt(q.value, q.dp ?? 2)}</p>
      <div className="flex items-center justify-between text-xs">
        <Change value={q.changePct} />
        {q.unit && <span className="text-text-3">{q.unit}</span>}
      </div>
      {spark && spark.length > 1 && <div className="mt-2"><Sparkline data={spark} positive={(q.changePct ?? 0) >= 0} /></div>}
      {q.note && <p className="mt-1 text-[11px] text-text-3">{q.note}</p>}
      {q.source && <SourceNote source={q.source} asOf={q.timestamp} isDemo={q.isDemo} delaySeconds={q.delaySeconds} />}
    </div>
  );
}

/** Quote card with a 60-session sparkline fetched server-side. */
export async function QuoteCardWithSpark({ q, kind }: { q: QuoteView; kind: HistoryKind }) {
  const h = await getHistory(kind, q.key, 60);
  return <QuoteCard q={q} spark={h?.bars.map((b) => ({ t: b.timestamp.slice(0, 10), v: b.close }))} />;
}

export async function HistoryCard({ kind, keyName, title }: { kind: HistoryKind; keyName: string; title: string }) {
  const h = await getHistory(kind, keyName, 180);
  return (
    <Card title={title} subtitle="Daily closes, last 180 sessions">
      {h ? (
        <>
          <HistoryChart data={h.bars.map((b) => ({ t: b.timestamp.slice(0, 10), v: b.close }))} label={title} />
          <SourceNote source={h.source} isDemo={h.isDemo} asOf={h.bars.at(-1)?.timestamp} />
        </>
      ) : (
        <p className="text-sm text-text-3">History unavailable: the configured provider has no series for this instrument, or no provider is configured.</p>
      )}
    </Card>
  );
}
