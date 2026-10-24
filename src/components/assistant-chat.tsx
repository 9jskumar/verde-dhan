"use client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, buttonVariants } from "./ui";

interface Reply {
  status?: string;
  message?: string;
  issues?: string[];
  isDemo?: boolean;
  answer?: { answer: string; insufficientData: boolean; followUps: string[] };
  evidence?: { id: string; label: string; value: unknown; source: string; asOf: string | null }[];
}

export function AssistantChat({ enabled }: { enabled: boolean }) {
  const [question, setQuestion] = useState("");
  const [symbol, setSymbol] = useState("");
  const [log, setLog] = useState<{ q: string; r: Reply }[]>([]);
  const ask = useMutation({
    mutationFn: async (v: { question: string; symbol?: string }): Promise<Reply> => {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
      return res.json().catch(() => ({ message: `Request failed (${res.status})` }));
    },
    onSuccess: (r, v) => setLog((l) => [...l, { q: v.question, r }]),
  });
  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length < 3) return;
          ask.mutate({ question: question.trim(), symbol: symbol.trim() || undefined });
          setQuestion("");
        }}
      >
        <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} maxLength={1000} disabled={!enabled} placeholder="e.g. Why is the top-ranked stock rated buy-on-retest rather than buy-breakout?" aria-label="Question" className="w-full rounded-md border border-line bg-bg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40" />
        <div className="flex flex-wrap items-center gap-2">
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="Symbol (optional)" aria-label="Limit to symbol" disabled={!enabled} className="h-9 w-44 rounded-md border border-line bg-bg px-2 text-sm uppercase" />
          <button type="submit" disabled={!enabled || ask.isPending} className={buttonVariants({ size: "md" })}>{ask.isPending ? "Thinking…" : "Ask"}</button>
        </div>
      </form>
      <ol className="space-y-4">
        {log.map(({ q, r }, i) => (
          <li key={i} className="rounded-lg border border-line bg-panel p-4 text-sm">
            <p className="font-medium">{q}</p>
            {r.status === "ok" && r.answer ? (
              <div className="mt-2 space-y-2">
                {r.isDemo && <Badge tone="demo">answer about demo data</Badge>}
                {r.answer.insufficientData && <Badge tone="warn">insufficient data</Badge>}
                <p className="whitespace-pre-wrap text-text">{r.answer.answer}</p>
                {r.evidence?.length ? (
                  <details className="text-xs text-text-2"><summary className="cursor-pointer">Evidence cited ({r.evidence.length})</summary>
                    <ul className="mt-1 space-y-0.5">{r.evidence.map((e) => <li key={e.id}><span className="num">{e.id}</span>: {String(e.value)} <span className="text-text-3">({e.source})</span></li>)}</ul>
                  </details>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 text-text-2">
                <p>{r.message}</p>
                {r.issues?.length ? <ul className="mt-1 list-disc pl-5 text-xs text-text-3">{r.issues.slice(0, 5).map((x) => <li key={x}>{x}</li>)}</ul> : null}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
