import type { ResearchSnapshot } from "../data/demo-research";
import { type EvidencePack, globalEvidence, stockEvidence } from "./evidence";

/**
 * Builds the evidence pack for an assistant question: the named stock if one
 * is given, otherwise the Top 3 plus the global impact read. Ids are prefixed
 * with the symbol so packs from several stocks can be merged.
 */
export function assistantEvidence(r: ResearchSnapshot, symbol: string | null): EvidencePack | null {
  const stocks = symbol ? r.analyses.filter((a) => a.symbol === symbol.toUpperCase()) : r.top3;
  if (symbol && stocks.length === 0) return null;
  const items = stocks.flatMap((a) =>
    stockEvidence(a).items.map((i) => ({ ...i, id: `${a.symbol}.${i.id}`, label: `${a.symbol}: ${i.label}` })),
  );
  if (!symbol && r.globalImpact) items.push(...globalEvidence(r.globalImpact, []).items);
  return { subject: symbol ? symbol.toUpperCase() : "Top 3 and global context", generatedAt: new Date().toISOString(), isDemo: r.mode === "demo", items };
}
