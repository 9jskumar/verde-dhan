import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { stockEvidence } from "./ai/evidence";
import type { StockRecommendation } from "./ai/schemas";
import { extractNumbers, verifyStockRecommendation } from "./ai/verify";
import { demoResearch } from "./data/demo-research";
import { indianSession, isIndianTradingDay, localDate, previousTradingDay } from "./jobs/calendar";
import { idempotencyKey, JOBS, jobByName } from "./jobs/definitions";
import { CircuitBreaker, HttpClient, redactUrl, TokenBucket } from "./providers/http";
import { canonicalUrl, contentFingerprint, dedupeNews, parseFeed } from "./providers/news";
import { checkBars } from "./providers/validate";
import { evaluateOutcome } from "./quant/performance";
import {
  parseStatusWebhook,
  recipientHash,
  redactPhones,
  sanitizeTemplateParam,
  sendTemplate,
  validateTemplateMessage,
  verifyWebhookSignature,
  verifyWebhookSubscription,
} from "./whatsapp/client";
import { dailyCloseParams, exceptionalAlertParams } from "./whatsapp/reports";

// ---------------------------------------------------------------------------
// AI verification
// ---------------------------------------------------------------------------
async function topAnalysis() {
  const r = await demoResearch();
  const a = r.top3[0] ?? r.top10[0]!;
  return a;
}

function faithful(a: Awaited<ReturnType<typeof topAnalysis>>): StockRecommendation {
  const cat = a.score.components.filter((c) => c.name.startsWith("Catalyst")).reduce((t, c) => t + c.points, 0);
  const glo = a.score.components.filter((c) => c.name.startsWith("Global")).reduce((t, c) => t + c.points, 0);
  const p = a.breakout.plan;
  return {
    symbol: a.symbol,
    companyName: a.companyName,
    fundamentalScore: a.score.fundamental,
    technicalScore: a.score.technical,
    catalystScore: cat,
    globalAlignmentScore: glo,
    valuationRiskScore: a.score.valuationRisk,
    totalScore: a.score.total,
    recommendation: a.recommendation,
    entryLow: p?.entryLow ?? null,
    entryHigh: p?.entryHigh ?? null,
    stopLoss: p?.stopLoss ?? null,
    target1: p?.target1 ?? null,
    target2: p?.target2 ?? null,
    target3: p?.target3 ?? null,
    riskReward: p?.riskReward ?? null,
    investmentHorizon: "Positional (weeks)",
    summary: `Synthetic demo data. The stock scores ${a.score.total} out of 100 with RSI(14) at ${a.technical!.rsi14}.`,
    supportingEvidence: [{ claim: `Technical strength is ${a.score.technical} of 35.`, evidenceIds: ["score.technical"] }],
    riskFactors: ["Breakouts can fail if volume does not follow through."],
    sourceReferences: ["score.total", "tech.rsi14"],
    evidenceConfidence: "MEDIUM",
    dataGaps: ["No verified catalysts in the evidence"],
  };
}

describe("AI output verification", () => {
  it("accepts output that faithfully restates the deterministic engine", async () => {
    const a = await topAnalysis();
    const v = verifyStockRecommendation(faithful(a), a, stockEvidence(a));
    expect(v.issues).toEqual([]);
    expect(v.accepted).toBe(true);
  });

  it("rejects altered scores, invented levels, upgraded calls and uncited numbers", async () => {
    const a = await topAnalysis();
    const ev = stockEvidence(a);
    const bad = (patch: Partial<StockRecommendation>) => verifyStockRecommendation({ ...faithful(a), ...patch }, a, ev);
    expect(bad({ totalScore: a.score.total + 5 }).accepted).toBe(false);
    expect(bad({ target1: (a.breakout.plan?.target1 ?? 100) * 1.1 }).accepted).toBe(false);
    expect(bad({ recommendation: "BUY_BREAKOUT" }).issues.join()).toMatch(a.recommendation === "BUY_BREAKOUT" ? /^$/ : /more bullish/);
    expect(bad({ summary: "Revenue will grow 913.37% next year." }).issues.join()).toMatch(/913.37/);
    expect(bad({ summary: "This is a guaranteed winner." }).issues.join()).toMatch(/certainty/);
    expect(bad({ sourceReferences: ["made.up"] }).issues.join()).toMatch(/unknown evidence/);
  });

  it("rejects trade levels when the engine produced no plan", async () => {
    const r = await demoResearch();
    const noPlan = r.analyses.find((x) => !x.breakout.plan)!;
    const out = { ...faithful(noPlan), entryLow: 100, stopLoss: 95 };
    const v = verifyStockRecommendation(out, noPlan, stockEvidence(noPlan));
    expect(v.issues.join()).toMatch(/without a validated trade plan/);
  });

  it("extracts numbers but ignores fiscal-period labels", () => {
    expect(extractNumbers("FY2026 revenue rose 12.5% to 1,25,000 crore in Q2")).toEqual([12.5, 125000]);
  });
});

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
describe("provider HTTP policy", () => {
  it("token bucket throttles", () => {
    let t = 0;
    const b = new TokenBucket(2, 2 / 1000, () => t);
    expect(b.take()).toBe(0);
    expect(b.take()).toBe(0);
    expect(b.take()).toBeGreaterThan(0);
    t = 500;
    expect(b.take()).toBe(0);
  });

  it("circuit breaker opens after failures and half-opens after cooldown", () => {
    let t = 0;
    const c = new CircuitBreaker(2, 1000, () => t);
    c.failure();
    expect(c.canRequest()).toBe(true);
    c.failure();
    expect(c.canRequest()).toBe(false);
    t = 1001;
    expect(c.canRequest()).toBe(true);
    expect(c.state).toBe("HALF_OPEN");
    c.failure();
    expect(c.state).toBe("OPEN");
  });

  it("retries 5xx then succeeds; does not retry 4xx; never leaks the URL", async () => {
    const responses = [new Response("x", { status: 503 }), new Response(JSON.stringify({ ok: 1 }), { status: 200 })];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const http = new HttpClient({ provider: "t", fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    await expect(http.getJson("https://x.test/a?apikey=SECRET")).resolves.toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const f404 = vi.fn(async () => new Response("no", { status: 404 }));
    const http2 = new HttpClient({ provider: "t", fetchImpl: f404 as unknown as typeof fetch, sleep: async () => {} });
    const err = await http2.getJson("https://x.test/a?apikey=SECRET").catch((e: Error) => e);
    expect(f404).toHaveBeenCalledTimes(1);
    expect(String(err)).not.toContain("SECRET");
    expect(redactUrl("https://x.test/a?apikey=SECRET&symbol=X")).toBe("https://x.test/a?apikey=REDACTED&symbol=X");
  });

  it("bar validation rejects bad OHLC and flags duplicates and gaps", () => {
    const ok = { open: 10, high: 11, low: 9, close: 10.5, adjustedClose: null, volume: 1, complete: true };
    expect(() => checkBars("t", [{ ...ok, timestamp: "2026-01-01", high: 8 }])).toThrow();
    const issues = checkBars("t", [
      { ...ok, timestamp: "2026-01-01" },
      { ...ok, timestamp: "2026-01-01" },
      { ...ok, timestamp: "2026-01-05", open: 20, high: 21, low: 19, close: 20 },
    ], { tradingDays: ["2026-01-01", "2026-01-02", "2026-01-05"] });
    expect(issues.map((i) => i.check).sort()).toEqual(["DUPLICATE_CANDLE", "MISSING_SESSION", "OUT_OF_ORDER", "PRICE_JUMP"]);
  });

  it("news: parses RSS/Atom, canonicalises URLs and dedupes syndicated copies", () => {
    const rss = `<rss><channel><title>Pub A</title><item><title><![CDATA[Rates held &amp; steady]]></title><link>https://www.pub-a.test/x?utm_source=feed</link><pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Summary&lt;/p&gt;</description></item><item><title>No date</title><link>https://a.test/y</link></item></channel></rss>`;
    const items = parseFeed(rss, "fallback");
    expect(items).toHaveLength(1);
    expect(items[0]!.headline).toBe("Rates held & steady");
    expect(items[0]!.summary).toBe("Summary");
    expect(canonicalUrl(items[0]!.url)).toBe("https://pub-a.test/x");
    const atom = `<feed><title>Pub B</title><entry><title>Story</title><link href="https://b.test/s"/><updated>2026-10-23T09:00:00Z</updated></entry></feed>`;
    expect(parseFeed(atom, "f")[0]!.url).toBe("https://b.test/s");
    expect(contentFingerprint("Rates held & steady!", "Pub A")).toBe(contentFingerprint("rates held  steady", "pub a"));
    const d = dedupeNews([
      { url: "https://a.test/1?utm_medium=x", headline: "H", publisher: "P" },
      { url: "https://a.test/1", headline: "H2", publisher: "P" },
      { url: "https://b.test/2", headline: "H", publisher: "P" },
    ]);
    expect(d).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------
describe("WhatsApp", () => {
  it("validates and sanitises template messages", () => {
    expect(sanitizeTemplateParam("a\nb\t c      d")).toBe("a · b · c   d");
    expect(validateTemplateMessage({ to: "919000000001", template: "vd_daily_close", languageCode: "en", bodyParams: ["x"] })).toContain("recipient is not a valid E.164 number");
    expect(validateTemplateMessage({ to: "+919000000001", template: "vd_daily_close", languageCode: "en", bodyParams: ["x"] })).toEqual([]);
  });

  it("sends a template and redacts the recipient from the stored response", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      expect(body.to).toBe("919000000001");
      expect(body.template.components[0].parameters[0].text).toBe("p1");
      return new Response(JSON.stringify({ contacts: [{ wa_id: "919000000001" }], messages: [{ id: "wamid.1" }] }), { status: 200 });
    });
    const r = await sendTemplate(
      { accessToken: "t", phoneNumberId: "123", apiVersion: "v23.0", fetchImpl: fetchImpl as unknown as typeof fetch },
      { to: "+919000000001", template: "vd_daily_close", languageCode: "en", bodyParams: ["p1"] },
    );
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe("wamid.1");
    expect(JSON.stringify(r.response)).not.toContain("9000000001");
    expect(redactPhones({ n: "+919000000001" }).n).toBe("+91***01");
    expect(recipientHash("+919000000001")).toHaveLength(32);
  });

  it("marks rate-limit and 5xx errors retryable", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { code: 130429 } }), { status: 400 }));
    const r = await sendTemplate({ accessToken: "t", phoneNumberId: "1", apiVersion: "v23.0", fetchImpl: f as unknown as typeof fetch }, { to: "+919000000001", template: "vd_test", languageCode: "en", bodyParams: [] });
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(true);
  });

  it("verifies webhook handshake and signatures", () => {
    const p = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "42" });
    expect(verifyWebhookSubscription(p, "tok")).toBe("42");
    expect(verifyWebhookSubscription(p, "nope")).toBeNull();
    const body = '{"entry":[]}';
    const sig = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, sig, "secret")).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig, "secret")).toBe(false);
    expect(verifyWebhookSignature(body, null, "secret")).toBe(false);
  });

  it("parses delivery statuses", () => {
    const s = parseStatusWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1761200000" }, { id: "wamid.2", status: "failed", timestamp: "1761200001", errors: [{ code: 131026, title: "Undeliverable" }] }] } }] }] });
    expect(s).toHaveLength(2);
    expect(s[1]!.errorCode).toBe("131026");
  });

  it("builds daily close params from research, labelled as demo", async () => {
    const r = await demoResearch();
    const params = dailyCloseParams(new Date("2026-10-23T11:00:00Z"), r, { india: [], global: [], fx: [], commodities: [] });
    expect(params).toHaveLength(5);
    expect(params[0]).toMatch(/^\[DEMO, synthetic data\] 23 Oct 2026/);
    expect(params.every((p) => !/[\n\t]/.test(p))).toBe(true);
    expect(params[3]).not.toContain("DMGARNET");
    const alert = exceptionalAlertParams(r, { india: [], global: [], fx: [], commodities: [] });
    if (alert) expect(alert.key).toMatch(/^(breakout|index):/);
  });
});

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------
describe("calendar and job scheduling", () => {
  const holidays = new Set(["2026-10-20"]);
  it("uses IST dates and skips weekends and holidays", () => {
    expect(localDate(new Date("2026-10-23T20:00:00Z"))).toBe("2026-10-24"); // 01:30 IST next day
    expect(isIndianTradingDay(new Date("2026-10-24T05:00:00Z"), holidays)).toBe(false); // Saturday
    expect(isIndianTradingDay(new Date("2026-10-20T05:00:00Z"), holidays)).toBe(false); // holiday
    expect(isIndianTradingDay(new Date("2026-10-21T05:00:00Z"), holidays)).toBe(true);
    expect(previousTradingDay(new Date("2026-10-25T05:00:00Z"), holidays)).toBe("2026-10-23");
  });

  it("derives the session from IST time", () => {
    expect(indianSession(new Date("2026-10-23T03:35:00Z"), holidays)).toBe("PRE_OPEN"); // 09:05
    expect(indianSession(new Date("2026-10-23T04:00:00Z"), holidays)).toBe("OPEN"); // 09:30
    expect(indianSession(new Date("2026-10-23T10:05:00Z"), holidays)).toBe("POST_CLOSE"); // 15:35
  });

  it("idempotency keys are stable within a window", () => {
    const daily = jobByName("whatsapp_daily_close")!;
    expect(idempotencyKey(daily, new Date("2026-10-23T11:00:00Z"))).toBe("whatsapp_daily_close:2026-10-23");
    expect(idempotencyKey(daily, new Date("2026-10-23T11:20:00Z"))).toBe("whatsapp_daily_close:2026-10-23");
    const news = jobByName("ingest_news")!;
    expect(idempotencyKey(news, new Date("2026-10-23T04:52:00Z"))).toBe("ingest_news:2026-10-23T10:15");
    expect(new Set(JOBS.map((j) => j.name)).size).toBe(JOBS.length);
  });
});

describe("recommendation outcomes", () => {
  const rec = { recommendedAt: "2026-10-01", referencePrice: 100, entryLow: 100, entryHigh: 102, stopLoss: 95, target1: 108, target2: 112, target3: 120 };
  const day = (date: string, low: number, high: number, close: number) => ({ date, low, high, close });

  it("tracks entry, target and stop", () => {
    const o = evaluateOutcome(rec, [day("2026-10-02", 98, 101, 100.5), day("2026-10-03", 100, 109, 108), day("2026-10-06", 94, 104, 96)]);
    expect(o.entryTriggeredAt).toBe("2026-10-02");
    expect(o.status).toBe("TARGET_1_HIT");
    expect(o.exitAt).toBe("2026-10-06");
    expect(o.returnPct).toBe(-5);
    expect(o.maxFavourableExcursionPct).toBe(9);
  });

  it("stopped out before any target", () => {
    const o = evaluateOutcome(rec, [day("2026-10-02", 99, 100.5, 100), day("2026-10-03", 94, 99, 95)]);
    expect(o.status).toBe("STOPPED_OUT");
  });

  it("entry never triggered", () => {
    const prices = Array.from({ length: 10 }, (_, i) => day(`2026-10-${String(i + 2).padStart(2, "0")}`, 95, 99, 97));
    expect(evaluateOutcome(rec, prices).status).toBe("ENTRY_NOT_TRIGGERED");
  });

  it("ignores prices on or before the recommendation date (no look-ahead)", () => {
    const o = evaluateOutcome(rec, [day("2026-10-01", 90, 130, 125)]);
    expect(o.status).toBe("OPEN");
    expect(o.entryTriggeredAt).toBeNull();
  });
});
