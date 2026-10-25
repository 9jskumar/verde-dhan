import type { ReactNode } from "react";
import { HistoryCard, QuoteCardWithSpark, type QuoteView } from "./market";
import { EmptyState, PageHeader, PendingIntegration } from "./ui";
import type { HistoryKind } from "@/lib/data/repository";

/** Shared layout for the Indian, global, forex and commodity pages. */
export function MarketPage({
  title, description, quotes, kind, pending, chartKey, chartTitle, notes, widget,
}: {
  title: string;
  description: string;
  quotes: QuoteView[];
  kind: HistoryKind;
  pending: { feature: string; needs: string[] } | null;
  chartKey?: string;
  chartTitle?: string;
  notes?: string[];
  /** Browser-only display widget (TradingView), shown above the stored quotes. */
  widget?: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      {pending && <div className="mb-4"><PendingIntegration {...pending} /></div>}
      {widget && <div className="mb-4">{widget}</div>}
      {quotes.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {quotes.map((q) => <QuoteCardWithSpark key={q.key} q={q} kind={kind} />)}
        </div>
      ) : (
        <EmptyState title="No quotes stored yet">These are the numbers used in scores and reports. Once a provider is configured, the ingest job fills them in. Nothing is shown until real data arrives.</EmptyState>
      )}
      {chartKey && quotes.length > 0 && (
        <div className="mt-4"><HistoryCard kind={kind} keyName={chartKey} title={chartTitle ?? chartKey} /></div>
      )}
      {notes?.length ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-text-3">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
      ) : null}
    </>
  );
}
