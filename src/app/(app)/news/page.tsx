import { Badge, Card, EmptyState, PageHeader, PendingIntegration } from "@/components/ui";
import { dataMode, getNews } from "@/lib/data/repository";
import { integrationStatus } from "@/lib/env";

export default async function NewsPage() {
  const news = await getNews(60);
  const mode = dataMode();
  return (
    <>
      <PageHeader title="News & Corporate Announcements" description="Headlines from licensed RSS feeds you configure, deduplicated by URL and content. Every item links to its original source." />
      {mode === "demo" && <EmptyState title="No news in demo mode">Demo mode never invents headlines. Configure NEWS_RSS_FEEDS and Supabase to ingest real items.</EmptyState>}
      {mode !== "demo" && !integrationStatus().news && <div className="mb-4"><PendingIntegration feature="News ingestion" needs={["NEWS_RSS_FEEDS (feeds whose terms permit this use)"]} /></div>}
      {news && (
        <Card title="Latest" subtitle={`${news.length} items`}>
          {news.length ? (
            <ul className="divide-y divide-line">
              {news.map((n) => (
                <li key={n.id} className="py-3">
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-accent hover:underline">{n.headline}</a>
                  {n.summary && <p className="mt-1 line-clamp-2 text-sm text-text-2">{n.summary}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-3">
                    <span>{n.publisher}</span><span className="num">{n.publishedAt.replace("T", " ").slice(0, 16)}</span>
                    {n.sentiment && <Badge tone={n.sentiment === "POSITIVE" ? "gain" : n.sentiment === "NEGATIVE" ? "loss" : "neutral"}>{n.sentiment.toLowerCase()}</Badge>}
                    {n.verified ? <Badge tone="info">verified</Badge> : <Badge>unverified</Badge>}
                  </p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-text-3">No items ingested yet.</p>}
        </Card>
      )}
    </>
  );
}
