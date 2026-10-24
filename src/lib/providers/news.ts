import { createHash } from "node:crypto";
import { ProviderError, type NewsItem, type NewsProvider } from "./types";

/**
 * News ingestion from publisher RSS/Atom feeds the operator is licensed to
 * use (configured in NEWS_RSS_FEEDS). Only headline, link, publisher, date
 * and the feed's own short description are stored — never full article
 * text — and every item links back to its source.
 */

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    // Feeds often entity-encode HTML inside descriptions; strip it once decoded.
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]!) : null;
}

function atomLink(block: string): string | null {
  const m = block.match(/<link[^>]*href="([^"]+)"/i);
  return m ? m[1]! : null;
}

export function parseFeed(xml: string, publisherFallback: string): Omit<NewsItem, "source" | "isDemo" | "dataDelaySeconds" | "fetchedAt">[] {
  const channelTitle = tag(xml.split(/<item|<entry/i)[0] ?? "", "title") ?? publisherFallback;
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const items = [];
  for (const b of blocks) {
    const headline = tag(b, "title");
    const url = tag(b, "link") || atomLink(b);
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    if (!headline || !url || !date || Number.isNaN(Date.parse(date))) continue;
    const summary = tag(b, "description") ?? tag(b, "summary");
    items.push({
      headline,
      summary: summary ? summary.slice(0, 500) : null,
      url,
      publisher: channelTitle,
      publishedAt: new Date(date).toISOString(),
      country: null,
    });
  }
  return items;
}

/** Strips tracking parameters and fragments so the same story dedupes across feeds. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|cmpid|ito$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

/** Fingerprint of normalised headline + publisher, for syndicated-copy dedupe. */
export function contentFingerprint(headline: string, publisher: string): string {
  const norm = `${headline}|${publisher}`.toLowerCase().replace(/[^a-z0-9| ]/g, "").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex");
}

export function dedupeNews<T extends { url: string; headline: string; publisher: string }>(items: readonly T[]): T[] {
  const urls = new Set<string>();
  const prints = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const u = canonicalUrl(it.url);
    const f = contentFingerprint(it.headline, it.publisher);
    if (urls.has(u) || prints.has(f)) continue;
    urls.add(u);
    prints.add(f);
    out.push(it);
  }
  return out;
}

export class RssNewsProvider implements NewsProvider {
  readonly id = "rss";
  constructor(
    private readonly feeds: string[],
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async getLatestNews(opts: { since?: string; limit?: number } = {}): Promise<NewsItem[]> {
    const fetchedAt = new Date().toISOString();
    const results = await Promise.allSettled(
      this.feeds.map(async (feed) => {
        const res = await this.fetchImpl(feed, { headers: { Accept: "application/rss+xml, application/atom+xml, text/xml" } });
        if (!res.ok) throw new ProviderError(this.id, `feed HTTP ${res.status}`, res.status, res.status >= 500);
        return parseFeed(await res.text(), new URL(feed).hostname);
      }),
    );
    const since = opts.since ? Date.parse(opts.since) : 0;
    const all = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .filter((n) => Date.parse(n.publishedAt) >= since)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((n) => ({ ...n, source: this.id, isDemo: false, dataDelaySeconds: 0, fetchedAt }));
    return dedupeNews(all).slice(0, opts.limit ?? 100);
  }
}
