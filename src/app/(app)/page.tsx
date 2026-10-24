import Link from "next/link";
import { QuoteCard } from "@/components/market";
import { OpportunityTable, StageBadge } from "@/components/research";
import { Badge, Card, Change, EmptyState, PageHeader, PendingIntegration } from "@/components/ui";
import { dataMode, getMarket, getNews, getResearch } from "@/lib/data/repository";

export default async function Dashboard() {
  const [market, research, news] = await Promise.all([getMarket(), getResearch(), getNews(6)]);
  const mode = dataMode();
  const g = research?.globalImpact;
  const breakouts = research?.analyses.filter((a) => ["CONFIRMED", "RETEST", "EARLY"].includes(a.breakout.stage) && a.recommendation !== "AVOID").slice(0, 6) ?? [];
  return (
    <>
      <PageHeader title="Dashboard" description="Indian market context, global signals and today's evidence-ranked opportunities.">
        {research?.asOf && <p className="text-xs text-text-3">Research as of <span className="num">{research.asOf.slice(0, 10)}</span></p>}
      </PageHeader>

      {mode === "unconfigured" && (
        <div className="mb-5 space-y-2">
          <PendingIntegration feature="Market data and research" needs={["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "or DEMO_MODE=true for synthetic data"]} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Indian market" subtitle="NIFTY 50 and SENSEX">
          {market.india.length ? (
            <div className="grid grid-cols-2 gap-3">
              {market.india.map((q) => (
                <QuoteCard key={q.symbol} q={{ key: q.symbol, name: q.name, value: q.lastValue, changePct: q.percentageChange, timestamp: q.timestamp, source: q.source, isDemo: q.isDemo }} />
              ))}
            </div>
          ) : (
            <EmptyState title="No Indian index data yet">Configure an index provider, then run the ingest job.</EmptyState>
          )}
        </Card>
        <Card title="Global sentiment" subtitle="Rule-based read of overnight moves">
          {g ? (
            <div className="space-y-3 text-sm">
              <p>
                <Badge tone={g.sentiment === "RISK_ON" ? "gain" : g.sentiment === "RISK_OFF" ? "loss" : "neutral"}>{g.sentiment.replace("_", "-")}</Badge>
                <span className="num ml-2 text-text-2">avg {g.sentimentScore?.toFixed(2) ?? "n/a"}%</span>
              </p>
              <div>
                <p className="text-xs text-text-3">Tailwinds</p>
                <p>{g.beneficiaries.slice(0, 4).map((s) => s.sector).join(", ") || "None"}</p>
              </div>
              <div>
                <p className="text-xs text-text-3">Under pressure</p>
                <p>{g.underPressure.slice(0, 4).map((s) => s.sector).join(", ") || "None"}</p>
              </div>
              <p className="text-[11px] text-text-3">{g.disclaimer}</p>
            </div>
          ) : (
            <EmptyState title="Global impact not computed yet" />
          )}
        </Card>
        <Card title="Best-performing sectors" subtitle="Latest session, average change">
          {research?.sectors.length ? (
            <ul className="space-y-1.5 text-sm">
              {research.sectors.slice(0, 6).map((s) => (
                <li key={s.sector} className="flex justify-between">
                  <span>{s.sector}</span>
                  <Change value={s.avgChangePct} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No sector data yet" />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "Global indices", href: "/global", items: market.global.map((q) => ({ k: q.symbol, n: q.name, c: q.percentageChange })) },
          { title: "Forex", href: "/forex", items: market.fx.map((q) => ({ k: q.pair, n: q.pair.replace(/(...)(...)/, "$1/$2"), c: q.percentageChange })) },
          { title: "Commodities", href: "/commodities", items: market.commodities.map((q) => ({ k: q.instrument, n: q.instrument, c: q.percentageChange })) },
        ].map((block) => (
          <Card key={block.title} title={block.title} action={<Link href={block.href} className="text-xs text-accent hover:underline">Open</Link>}>
            {block.items.length ? (
              <ul className="space-y-1 text-sm">
                {block.items.map((i) => (
                  <li key={i.k} className="flex justify-between">
                    <span className="text-text-2">{i.n}</span>
                    <Change value={i.c} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Pending integration" />
            )}
          </Card>
        ))}
        <Card title="Breakout alerts" action={<Link href="/breakouts" className="text-xs text-accent hover:underline">Scanner</Link>}>
          {breakouts.length ? (
            <ul className="space-y-1.5 text-sm">
              {breakouts.map((a) => (
                <li key={a.symbol} className="flex items-center justify-between gap-2">
                  <Link href={`/stocks/${a.symbol}`} className="font-medium hover:text-accent">{a.symbol}</Link>
                  <StageBadge stage={a.breakout.stage} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No qualifying setups" />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Top 3 opportunities" subtitle="Highest-ranked names with a complete, validated trade plan" action={<Link href="/top-3" className="text-xs text-accent hover:underline">Details</Link>}>
          {research?.top3.length ? <OpportunityTable rows={research.top3} /> : <EmptyState title="No stock met every Top 3 condition">That is a valid outcome: the list is never padded.</EmptyState>}
        </Card>
        <Card title="Latest news" action={<Link href="/news" className="text-xs text-accent hover:underline">All news</Link>}>
          {news?.length ? (
            <ul className="space-y-2 text-sm">
              {news.map((n) => (
                <li key={n.id}>
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">{n.headline}</a>
                  <p className="text-[11px] text-text-3">{n.publisher} · {n.publishedAt.slice(0, 16).replace("T", " ")}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No news">{mode === "demo" ? "Demo mode never invents headlines." : "Configure NEWS_RSS_FEEDS with feeds you are licensed to use."}</EmptyState>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Top 10 opportunities" action={<Link href="/top-10" className="text-xs text-accent hover:underline">Full table</Link>}>
        {research?.top10.length ? <OpportunityTable rows={research.top10} /> : <EmptyState title="No qualified opportunities" />}
      </Card>
    </>
  );
}
