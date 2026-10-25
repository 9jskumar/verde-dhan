import { describe, expect, it } from "vitest";
import { AngelOneProvider, frontMonthContracts, parseAngelTime, parseExpiry, scripMasterTokens, totp } from "./angelone";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 of "12345678901234567890"

describe("Angel One helpers", () => {
  it("generates RFC 6238 TOTP codes", () => {
    expect(totp(RFC_SECRET, 59_000)).toBe("287082");
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe("081804");
    expect(totp(RFC_SECRET, 1_234_567_890_000)).toBe("005924");
  });

  it("parses SmartAPI times and expiries", () => {
    expect(parseAngelTime("21-Jun-2026 10:46:10")).toBe("2026-06-21T10:46:10+05:30");
    expect(parseAngelTime("garbage")).toBeNull();
    expect(parseExpiry("19NOV2026")).toBe("2026-11-19");
    expect(parseExpiry("")).toBeNull();
  });

  it("maps cash equities from the scrip master", () => {
    const m = scripMasterTokens([
      { token: "2885", symbol: "RELIANCE-EQ", exch_seg: "NSE", instrumenttype: "" },
      { token: "500325", symbol: "RELIANCE", exch_seg: "BSE", instrumenttype: "" },
      { token: "999", symbol: "RELIANCE24NOVFUT", exch_seg: "NFO", instrumenttype: "FUTSTK" },
    ]);
    expect(m.get("NSE:RELIANCE")).toBe("2885");
    expect(m.get("BSE:RELIANCE")).toBe("500325");
    expect(m.size).toBe(2);
  });

  it("picks the nearest unexpired future on the exact underlying", () => {
    const rows = [
      { token: "1", symbol: "GOLD05OCT26FUT", name: "GOLD", expiry: "05OCT2026", exch_seg: "MCX", instrumenttype: "FUTCOM" },
      { token: "2", symbol: "GOLD05DEC26FUT", name: "GOLD", expiry: "05DEC2026", exch_seg: "MCX", instrumenttype: "FUTCOM" },
      { token: "3", symbol: "GOLD05FEB27FUT", name: "GOLD", expiry: "05FEB2027", exch_seg: "MCX", instrumenttype: "FUTCOM" },
      { token: "4", symbol: "GOLDM03NOV26FUT", name: "GOLDM", expiry: "03NOV2026", exch_seg: "MCX", instrumenttype: "FUTCOM" },
      { token: "5", symbol: "USDINR26NOV26FUT", name: "USDINR", expiry: "26NOV2026", exch_seg: "CDS", instrumenttype: "FUTCUR" },
      { token: "6", symbol: "USDINR26NOV2683CE", name: "USDINR", expiry: "26NOV2026", exch_seg: "CDS", instrumenttype: "OPTCUR" },
    ];
    const m = frontMonthContracts(rows, "2026-10-25");
    expect(m.get("XAU")?.token).toBe("2");
    expect(m.get("XAU")?.expiry).toBe("2026-12-05");
    expect(m.get("USDINR")?.token).toBe("5");
    expect(m.has("BRENT")).toBe(false);
  });
});

function fakeFetch(handler: (url: string, body: Record<string, unknown>, headers: Record<string, string>) => unknown) {
  const calls: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const out = handler(url, body, (init?.headers ?? {}) as Record<string, string>);
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

const NOW = Date.parse("2026-10-26T06:00:00Z"); // 11:30 IST, Monday

function provider(fetchImpl: typeof fetch) {
  return new AngelOneProvider({
    apiKey: "k",
    clientCode: "C1",
    mpin: "1234",
    totpSecret: RFC_SECRET,
    resolveToken: async (s) => (s === "RELIANCE" ? "2885" : null),
    loadContracts: async () =>
      new Map([
        ["JPYINR", { exchange: "CDS" as const, token: "77", tradingSymbol: "JPYINR26NOV26FUT", expiry: "2026-11-26" }],
        ["XAU", { exchange: "MCX" as const, token: "88", tradingSymbol: "GOLD05DEC26FUT", expiry: "2026-12-05" }],
      ]),
    now: () => NOW,
    http: { sleep: async () => {}, fetchImpl, maxRetries: 0 },
  });
}

describe("Angel One provider", () => {
  it("logs in with a TOTP code, then parses a quote", async () => {
    let logins = 0;
    const { impl } = fakeFetch((url, body, headers) => {
      if (url.includes("loginByPassword")) {
        logins += 1;
        expect(body).toMatchObject({ clientcode: "C1", password: "1234" });
        expect(String(body.totp)).toMatch(/^\d{6}$/);
        expect(headers["X-PrivateKey"]).toBe("k");
        return { status: true, data: { jwtToken: "Bearer jwt1" } };
      }
      expect(headers.Authorization).toBe("Bearer jwt1");
      return { status: true, data: { fetched: [{ exchange: "NSE", symbolToken: "2885", ltp: 1300, open: 1290, high: 1310, low: 1285, close: 1280, percentChange: 1.5625, tradeVolume: 1000, exchFeedTime: "26-Oct-2026 11:29:59" }] } };
    });
    const p = provider(impl);
    const q = await p.getQuote("RELIANCE", "NSE");
    expect(q).toMatchObject({ lastPrice: 1300, previousClose: 1280, changePct: 1.5625, source: "angelone", isDemo: false, timestamp: "2026-10-26T11:29:59+05:30" });
    await p.getQuote("RELIANCE", "NSE");
    expect(logins).toBe(1);
  });

  it("re-opens the session once when the token is rejected", async () => {
    let logins = 0;
    let quoteCalls = 0;
    const { impl } = fakeFetch((url) => {
      if (url.includes("loginByPassword")) {
        logins += 1;
        return { status: true, data: { jwtToken: `jwt${logins}` } };
      }
      quoteCalls += 1;
      if (quoteCalls === 1) return { status: false, errorcode: "AG8001", message: "Invalid Token" };
      return { status: true, data: { fetched: [{ exchange: "NSE", symbolToken: "2885", ltp: 1300, close: 1280 }] } };
    });
    const q = await provider(impl).getQuote("RELIANCE");
    expect(q.lastPrice).toBe(1300);
    expect(logins).toBe(2);
  });

  it("reports a failed login without echoing credentials", async () => {
    const { impl } = fakeFetch(() => ({ status: false, errorcode: "AB1050", message: "Invalid totp" }));
    await expect(provider(impl).getQuote("RELIANCE")).rejects.toThrow(/login failed \(AB1050\)/);
    await expect(provider(impl).getQuote("RELIANCE")).rejects.not.toThrow(/1234/);
  });

  it("refuses unmapped symbols instead of guessing", async () => {
    const { impl, calls } = fakeFetch(() => ({ status: true, data: { jwtToken: "j" } }));
    await expect(provider(impl).getQuote("UNKNOWN")).rejects.toThrow(/no SmartAPI token/);
    expect(calls).toHaveLength(0);
  });

  it("labels MCX prices as INR front-month futures and converts JPY/INR to per-yen", async () => {
    const { impl } = fakeFetch((url, body) => {
      if (url.includes("loginByPassword")) return { status: true, data: { jwtToken: "j" } };
      const ex = body.exchangeTokens as Record<string, string[]>;
      if (ex.CDS) return { status: true, data: { fetched: [{ exchange: "CDS", symbolToken: "77", ltp: 55.5, close: 55, percentChange: 0.9091 }] } };
      return { status: true, data: { fetched: [{ exchange: "MCX", symbolToken: "88", ltp: 120000, close: 119000, percentChange: 0.8403 }] } };
    });
    const p = provider(impl);
    const [gold] = await p.getCommodityQuotes(["XAU", "BRENT"]);
    expect(gold).toMatchObject({ instrument: "XAU", price: 120000, currency: "INR", unit: "10 g", contractType: "FRONT_MONTH_FUTURE", contractMonth: "2026-12-05" });
    expect(await p.getCommodityQuotes(["BRENT"])).toEqual([]);
    const [jpy] = await p.getFxQuotes(["JPYINR"]);
    expect(jpy!.mid).toBeCloseTo(0.555, 6);
    expect(jpy!.previousClose).toBeCloseTo(0.55, 6);
    expect(jpy!.percentageChange).toBeCloseTo(0.9091, 4);
  });

  it("parses daily candles and marks today's as still forming", async () => {
    const { impl } = fakeFetch((url, body) => {
      if (url.includes("loginByPassword")) return { status: true, data: { jwtToken: "j" } };
      expect(body).toMatchObject({ exchange: "NSE", symboltoken: "99926000", interval: "ONE_DAY", fromdate: "2026-10-01 09:15", todate: "2026-10-26 15:30" });
      return {
        status: true,
        data: [
          ["2026-10-26T00:00:00+05:30", 25100, 25200, 25050, 25150, 0],
          ["2026-10-23T00:00:00+05:30", 25000, 25120, 24950, 25080, 0],
        ],
      };
    });
    const s = await provider(impl).getIndexHistory("NIFTY50", "2026-10-01", "2026-10-26");
    expect(s.bars.map((b) => b.timestamp.slice(0, 10))).toEqual(["2026-10-23", "2026-10-26"]);
    expect(s.bars.map((b) => b.complete)).toEqual([true, false]);
  });
});
