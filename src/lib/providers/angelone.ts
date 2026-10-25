import { createHmac } from "node:crypto";
import { HttpClient, type PolicyOptions } from "./http";
import { dedupeBars, isDailyCandleComplete } from "./validate";
import {
  type CommoditiesProvider,
  type CommodityQuote,
  DataValidationError,
  type ForexProvider,
  type FxQuote,
  type HistoricalSeries,
  type IndexQuote,
  INSTRUMENT_NAMES,
  type MarketDataProvider,
  type MarketQuote,
  type MarketStatus,
  ProviderError,
} from "./types";

/**
 * Angel One SmartAPI adapter for NSE/BSE equities, the NIFTY 50 / SENSEX
 * indices, MCX commodity futures and NSE currency futures (CDS).
 *
 * Commodities and currencies are front-month exchange futures priced in
 * the contract's own terms (mostly INR), not international spot prices.
 * Every record is tagged with contract type, currency and unit so they are
 * never mistaken for spot. Brent has no actively traded MCX contract, so
 * it is left unmapped rather than substituted with another crude.
 *
 * Licensing: SmartAPI market data is provided to the Angel One account
 * holder for their own use. Showing it to anyone else generally needs an
 * exchange data-vending licence. See docs/API_INTEGRATION_PLAN.md.
 *
 * Authentication: each session is opened with the SmartAPI app key, the
 * client code, the MPIN and a TOTP code. The TOTP code is generated here
 * from the secret shown when TOTP is enabled on the account, so the daily
 * login needs no manual step. Sessions are re-opened before they expire and
 * whenever the API reports an invalid token.
 *
 * Endpoint shapes follow the published SmartAPI REST docs (loginByPassword,
 * market/v1/quote, historical/v1/getCandleData). Parsing fails loudly
 * (DataValidationError) rather than guessing if a payload differs.
 *
 * Symbols are resolved to SmartAPI instrument tokens through the
 * `stocks.provider_ids.angelone` column or the resolver passed in; see
 * `scripMasterTokens` for building that mapping.
 */

const BASE = "https://apiconnect.angelone.in";
export const ANGELONE_SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

/** SmartAPI tokens for the Indian indices tracked on the India page. */
export const ANGELONE_INDEX_TOKENS: Record<string, { exchange: "NSE" | "BSE"; token: string }> = {
  NIFTY50: { exchange: "NSE", token: "99926000" },
  SENSEX: { exchange: "BSE", token: "99919000" },
};

/** Re-open the session well before SmartAPI's own expiry. */
const SESSION_TTL_MS = 6 * 3600_000;

/** Internal commodity key → MCX underlying name and quoting terms. */
// Crude, natural gas, gold and silver come from CFI Financial in USD
// (bridge/cfi_mt5), so only the base metals CFI lacks are read from MCX.
export const MCX_COMMODITIES: Record<string, { name: string; unit: string }> = {
  COPPER: { name: "COPPER", unit: "kg" },
  ALUMINIUM: { name: "ALUMINIUM", unit: "kg" },
  ZINC: { name: "ZINC", unit: "kg" },
};

/**
 * Internal pair → NSE currency-futures underlying. JPYINR futures are quoted
 * per 100 JPY, so prices are divided by `perUnits` to give INR per 1 JPY.
 */
export const CDS_PAIRS: Record<string, { name: string; perUnits: number }> = {
  USDINR: { name: "USDINR", perUnits: 1 },
  EURINR: { name: "EURINR", perUnits: 1 },
  GBPINR: { name: "GBPINR", perUnits: 1 },
  JPYINR: { name: "JPYINR", perUnits: 100 },
};

export interface FuturesContract {
  exchange: "MCX" | "CDS";
  token: string;
  tradingSymbol: string;
  /** YYYY-MM-DD */
  expiry: string;
}

type Exchange = "NSE" | "BSE" | "MCX" | "CDS";

export interface AngelOneOptions {
  apiKey: string;
  clientCode: string;
  mpin: string;
  totpSecret: string;
  resolveToken: (symbol: string, exchange: "NSE" | "BSE") => Promise<string | null>;
  /** Internal key (WTI, USDINR…) → current front-month contract. Defaults to the scrip master. */
  loadContracts?: () => Promise<Map<string, FuturesContract>>;
  http?: Partial<PolicyOptions>;
  now?: () => number;
}

interface Envelope<T> {
  status: boolean;
  message?: string;
  errorcode?: string;
  data?: T | null;
}

interface AngelQuote {
  exchange: string;
  tradingSymbol?: string;
  symbolToken: string;
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  /** Previous session's close. */
  close?: number;
  netChange?: number;
  percentChange?: number;
  tradeVolume?: number;
  exchFeedTime?: string;
}

type AngelCandle = [string, number, number, number, number, number];

// ---------------------------------------------------------------------------
// TOTP (RFC 6238: HMAC-SHA1, 30 s step, 6 digits), as used by SmartAPI login.
// ---------------------------------------------------------------------------

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error("TOTP secret is not valid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, at = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(at / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, "0");
}

/** "21-Jun-2026 10:46:10" (IST) → ISO 8601 with offset. */
export function parseAngelTime(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mon = months.indexOf(m[2]!.toLowerCase());
  if (mon < 0) return null;
  return `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}T${m[4]}:${m[5]}:${m[6]}+05:30`;
}

/** SmartAPI date-time parameter: "YYYY-MM-DD HH:mm" in IST. */
function angelDate(day: string, time: string) {
  return `${day.slice(0, 10)} ${time}`;
}

/** Indian cash session (09:15–15:30 IST, weekdays). Holidays are not known here. */
function sessionStatus(now: number): MarketStatus {
  const ist = new Date(now + 5.5 * 3600_000);
  const dow = ist.getUTCDay();
  if (dow === 0 || dow === 6) return "CLOSED";
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) return "PRE_OPEN";
  if (mins >= 9 * 60 + 15 && mins < 15 * 60 + 30) return "OPEN";
  return "CLOSED";
}

export class AngelOneProvider implements MarketDataProvider, CommoditiesProvider, ForexProvider {
  readonly id = "angelone";
  private readonly http: HttpClient;
  private readonly now: () => number;
  private session: { jwt: string; at: number } | null = null;
  private contracts: { map: Map<string, FuturesContract>; at: number } | null = null;

  constructor(private readonly opts: AngelOneOptions) {
    this.now = opts.now ?? Date.now;
    // SmartAPI allows 3 historical requests per second; stay at that for all calls.
    this.http = new HttpClient({ provider: this.id, rateLimit: { requests: 3, perMs: 1000 }, ...opts.http });
  }

  private baseHeaders(): Record<string, string> {
    // SmartAPI requires these headers on every call. They identify the
    // calling machine; market-data calls accept placeholder values.
    return {
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "127.0.0.1",
      "X-MACAddress": "00:00:00:00:00:00",
      "X-PrivateKey": this.opts.apiKey,
    };
  }

  private async login(): Promise<string> {
    const body = await this.http.postJson<Envelope<{ jwtToken?: string }>>(
      `${BASE}/rest/auth/angelbroking/user/v1/loginByPassword`,
      { clientcode: this.opts.clientCode, password: this.opts.mpin, totp: totp(this.opts.totpSecret, this.now()) },
      this.baseHeaders(),
    );
    const jwt = body.data?.jwtToken;
    if (!body.status || !jwt) {
      // Report SmartAPI's error code only; never echo credentials.
      throw new ProviderError(this.id, `login failed${body.errorcode ? ` (${body.errorcode})` : ""}`);
    }
    this.session = { jwt: jwt.replace(/^Bearer\s+/i, ""), at: this.now() };
    return this.session.jwt;
  }

  private async jwt(): Promise<string> {
    if (this.session && this.now() - this.session.at < SESSION_TTL_MS) return this.session.jwt;
    return this.login();
  }

  /** Authenticated POST; re-opens the session once if SmartAPI rejects the token. */
  private async post<T>(path: string, payload: unknown): Promise<Envelope<T>> {
    const call = async () =>
      this.http.postJson<Envelope<T>>(`${BASE}${path}`, payload, { ...this.baseHeaders(), Authorization: `Bearer ${await this.jwt()}` });
    let res: Envelope<T>;
    try {
      res = await call();
    } catch (err) {
      if (!(err instanceof ProviderError) || err.status !== 401) throw err;
      this.session = null;
      return call();
    }
    // AG8001 invalid token, AG8002 token expired, AG8003 token missing.
    if (!res.status && /^AG800[123]$/.test(res.errorcode ?? "")) {
      this.session = null;
      res = await call();
    }
    return res;
  }

  private async token(symbol: string, exchange: "NSE" | "BSE") {
    const t = await this.opts.resolveToken(symbol, exchange);
    if (!t) throw new ProviderError(this.id, `no SmartAPI token mapped for ${exchange}:${symbol}`);
    return t;
  }

  private async quotes(exchange: Exchange, tokens: string[]): Promise<AngelQuote[]> {
    const body = await this.post<{ fetched?: AngelQuote[] }>("/rest/secure/angelbroking/market/v1/quote/", {
      mode: "FULL",
      exchangeTokens: { [exchange]: tokens },
    });
    const fetched = body.data?.fetched;
    if (!body.status || !Array.isArray(fetched)) {
      throw new DataValidationError(this.id, [`unexpected quote payload${body.errorcode ? ` (${body.errorcode})` : ""}`]);
    }
    return fetched;
  }

  private async candles(exchange: Exchange, token: string, from: string, to: string, label: string): Promise<HistoricalSeries["bars"]> {
    const body = await this.post<AngelCandle[]>("/rest/secure/angelbroking/historical/v1/getCandleData", {
      exchange,
      symboltoken: token,
      interval: "ONE_DAY",
      fromdate: angelDate(from, "09:15"),
      todate: angelDate(to, "15:30"),
    });
    const rows = body.data;
    if (!body.status || !Array.isArray(rows)) {
      throw new DataValidationError(this.id, [`unexpected historical payload for ${label}${body.errorcode ? ` (${body.errorcode})` : ""}`]);
    }
    return dedupeBars(
      rows.map((c) => ({
        timestamp: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        // SmartAPI candles are not split-adjusted; adjustment is applied from
        // corporate_actions by the ingestion job.
        adjustedClose: null,
        volume: c[5],
        complete: isDailyCandleComplete(c[0], new Date(this.now())),
      })),
    );
  }

  async getQuote(symbol: string, exchange: "NSE" | "BSE" = "NSE"): Promise<MarketQuote> {
    const token = await this.token(symbol, exchange);
    const q = (await this.quotes(exchange, [token])).find((x) => x.symbolToken === token);
    if (!q || typeof q.ltp !== "number") throw new DataValidationError(this.id, [`no quote returned for ${exchange}:${symbol}`]);
    const prev = typeof q.close === "number" && q.close > 0 ? q.close : null;
    return {
      symbol,
      exchange,
      timestamp: parseAngelTime(q.exchFeedTime) ?? new Date(this.now()).toISOString(),
      lastPrice: q.ltp,
      open: q.open ?? null,
      high: q.high ?? null,
      low: q.low ?? null,
      previousClose: prev,
      changePct: typeof q.percentChange === "number" ? q.percentChange : prev ? ((q.ltp - prev) / prev) * 100 : null,
      volume: q.tradeVolume ?? null,
      source: this.id,
      isDemo: false,
      dataDelaySeconds: 0,
      fetchedAt: new Date(this.now()).toISOString(),
    };
  }

  async getHistoricalPrices(symbol: string, from: string, to: string, exchange: "NSE" | "BSE" = "NSE"): Promise<HistoricalSeries> {
    const token = await this.token(symbol, exchange);
    const bars = await this.candles(exchange, token, from, to, `${exchange}:${symbol}`);
    return { symbol, interval: "1d", bars, source: this.id, isDemo: false, dataDelaySeconds: 0, fetchedAt: new Date(this.now()).toISOString() };
  }

  /** NIFTY 50 and SENSEX. Keys without a known token are skipped, not guessed. */
  async getIndexQuotes(keys: readonly string[]): Promise<IndexQuote[]> {
    const out: IndexQuote[] = [];
    for (const key of keys) {
      const ref = ANGELONE_INDEX_TOKENS[key];
      if (!ref) continue;
      const q = (await this.quotes(ref.exchange, [ref.token])).find((x) => x.symbolToken === ref.token);
      if (!q || typeof q.ltp !== "number") throw new DataValidationError(this.id, [`no quote returned for ${key}`]);
      const prev = typeof q.close === "number" && q.close > 0 ? q.close : null;
      out.push({
        symbol: key,
        name: INSTRUMENT_NAMES[key] ?? key,
        currency: "INR",
        timestamp: parseAngelTime(q.exchFeedTime) ?? new Date(this.now()).toISOString(),
        lastValue: q.ltp,
        previousClose: prev,
        absoluteChange: typeof q.netChange === "number" ? q.netChange : prev ? q.ltp - prev : null,
        percentageChange: typeof q.percentChange === "number" ? q.percentChange : prev ? ((q.ltp - prev) / prev) * 100 : null,
        dayHigh: q.high ?? null,
        dayLow: q.low ?? null,
        marketStatus: sessionStatus(this.now()),
        source: this.id,
        isDemo: false,
        dataDelaySeconds: 0,
        fetchedAt: new Date(this.now()).toISOString(),
      });
    }
    return out;
  }

  async getIndexHistory(key: string, from: string, to: string): Promise<HistoricalSeries> {
    const ref = ANGELONE_INDEX_TOKENS[key];
    if (!ref) throw new ProviderError(this.id, `no SmartAPI token for index ${key}`);
    const bars = await this.candles(ref.exchange, ref.token, from, to, key);
    return { symbol: key, interval: "1d", bars, source: this.id, isDemo: false, dataDelaySeconds: 0, fetchedAt: new Date(this.now()).toISOString() };
  }

  // -------------------------------------------------------------------------
  // MCX commodity and NSE currency futures (front month)
  // -------------------------------------------------------------------------

  private async contract(key: string): Promise<FuturesContract | null> {
    // The scrip master changes daily as contracts list and expire.
    if (!this.contracts || this.now() - this.contracts.at > 12 * 3600_000) {
      const today = new Date(this.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
      const map = this.opts.loadContracts ? await this.opts.loadContracts() : frontMonthContracts(await fetchScripMasterRows(), today);
      this.contracts = { map, at: this.now() };
    }
    return this.contracts.map.get(key) ?? null;
  }

  private async futuresQuote(key: string) {
    const c = await this.contract(key);
    if (!c) return null;
    const q = (await this.quotes(c.exchange, [c.token])).find((x) => x.symbolToken === c.token);
    if (!q || typeof q.ltp !== "number") throw new DataValidationError(this.id, [`no quote returned for ${c.tradingSymbol}`]);
    const prev = typeof q.close === "number" && q.close > 0 ? q.close : null;
    return {
      c,
      q,
      prev,
      timestamp: parseAngelTime(q.exchFeedTime) ?? new Date(this.now()).toISOString(),
      pct: typeof q.percentChange === "number" ? q.percentChange : prev ? ((q.ltp - prev) / prev) * 100 : null,
    };
  }

  /** Keys with no MCX contract (e.g. BRENT) are skipped, not substituted. */
  async getCommodityQuotes(keys: readonly string[]): Promise<CommodityQuote[]> {
    const out: CommodityQuote[] = [];
    for (const key of keys) {
      const meta = MCX_COMMODITIES[key];
      if (!meta) continue;
      const r = await this.futuresQuote(key);
      if (!r) continue;
      out.push({
        instrument: key,
        timestamp: r.timestamp,
        price: r.q.ltp,
        currency: "INR",
        unit: meta.unit,
        contractType: "FRONT_MONTH_FUTURE",
        contractMonth: r.c.expiry,
        previousClose: r.prev,
        percentageChange: r.pct,
        source: this.id,
        isDemo: false,
        dataDelaySeconds: 0,
        fetchedAt: new Date(this.now()).toISOString(),
      });
    }
    return out;
  }

  async getFxQuotes(pairs: readonly string[]): Promise<FxQuote[]> {
    const out: FxQuote[] = [];
    for (const pair of pairs) {
      const meta = CDS_PAIRS[pair];
      if (!meta) continue;
      const r = await this.futuresQuote(pair);
      if (!r) continue;
      const k = meta.perUnits;
      out.push({
        pair,
        timestamp: r.timestamp,
        // Futures last trade, not a spot bid/ask.
        bid: null,
        ask: null,
        mid: r.q.ltp / k,
        previousClose: r.prev !== null ? r.prev / k : null,
        percentageChange: r.pct,
        source: this.id,
        isDemo: false,
        dataDelaySeconds: 0,
        fetchedAt: new Date(this.now()).toISOString(),
      });
    }
    return out;
  }

  private async futuresHistory(key: string, from: string, to: string, divisor: number): Promise<HistoricalSeries> {
    const c = await this.contract(key);
    if (!c) throw new ProviderError(this.id, `no ${key} futures contract on SmartAPI`);
    // Only the current contract's own history: series are not stitched across rolls.
    const bars = (await this.candles(c.exchange, c.token, from, to, c.tradingSymbol)).map((b) =>
      divisor === 1 ? b : { ...b, open: b.open / divisor, high: b.high / divisor, low: b.low / divisor, close: b.close / divisor },
    );
    return { symbol: key, interval: "1d", bars, source: this.id, isDemo: false, dataDelaySeconds: 0, fetchedAt: new Date(this.now()).toISOString() };
  }

  getCommodityHistory(instrument: string, from: string, to: string) {
    return this.futuresHistory(instrument, from, to, 1);
  }

  getFxHistory(pair: string, from: string, to: string) {
    return this.futuresHistory(pair, from, to, CDS_PAIRS[pair]?.perUnits ?? 1);
  }
}

export interface ScripRow {
  token?: string;
  symbol?: string;
  name?: string;
  expiry?: string;
  exch_seg?: string;
  instrumenttype?: string;
}

/** Scrip master expiry "19NOV2026" → "2026-11-19". */
export function parseExpiry(s: string | undefined): string | null {
  const m = /^(\d{2})([A-Z]{3})(\d{4})$/.exec((s ?? "").trim().toUpperCase());
  if (!m) return null;
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(m[2]!);
  return mon < 0 ? null : `${m[3]}-${String(mon + 1).padStart(2, "0")}-${m[1]}`;
}

/**
 * Picks, for each internal key, the nearest unexpired future on the exact
 * underlying (so GOLD never matches GOLDM or GOLDPETAL).
 */
export function frontMonthContracts(rows: readonly ScripRow[], today: string): Map<string, FuturesContract> {
  const wanted: Array<[string, "MCX" | "CDS", string, string]> = [
    ...Object.entries(MCX_COMMODITIES).map(([k, v]) => [k, "MCX", "FUTCOM", v.name] as [string, "MCX", string, string]),
    ...Object.entries(CDS_PAIRS).map(([k, v]) => [k, "CDS", "FUTCUR", v.name] as [string, "CDS", string, string]),
  ];
  const out = new Map<string, FuturesContract>();
  for (const [key, exch, type, name] of wanted) {
    let best: FuturesContract | null = null;
    for (const r of rows) {
      if (r.exch_seg !== exch || r.instrumenttype !== type || r.name !== name || !r.token || !r.symbol) continue;
      const expiry = parseExpiry(r.expiry);
      if (!expiry || expiry < today) continue;
      if (!best || expiry < best.expiry) best = { exchange: exch, token: r.token, tradingSymbol: r.symbol, expiry };
    }
    if (best) out.set(key, best);
  }
  return out;
}

/**
 * Builds "EXCHANGE:SYMBOL" → SmartAPI token for cash equities from the
 * published scrip master. NSE lists equities as "<SYMBOL>-EQ"; BSE uses the
 * plain symbol.
 */
export function scripMasterTokens(rows: readonly ScripRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.token || !r.symbol || (r.instrumenttype ?? "") !== "") continue;
    if (r.exch_seg === "NSE" && r.symbol.endsWith("-EQ")) out.set(`NSE:${r.symbol.slice(0, -3)}`, r.token);
    else if (r.exch_seg === "BSE") out.set(`BSE:${r.symbol}`, r.token);
  }
  return out;
}

export async function fetchScripMasterRows(fetchImpl: typeof fetch = fetch): Promise<ScripRow[]> {
  const res = await fetchImpl(ANGELONE_SCRIP_MASTER_URL, { cache: "no-store" });
  if (!res.ok) throw new ProviderError("angelone", `scrip master HTTP ${res.status}`, res.status, res.status >= 500);
  const rows = (await res.json()) as ScripRow[];
  if (!Array.isArray(rows)) throw new DataValidationError("angelone", ["scrip master is not an array"]);
  return rows;
}
