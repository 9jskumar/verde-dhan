import { ProviderError } from "./types";

/**
 * Resilient HTTP for vendor adapters: timeouts, rate limiting, retry with
 * exponential backoff + jitter (429 / 5xx / network), a per-provider
 * circuit breaker, and a small TTL cache for idempotent GETs.
 */

export interface PolicyOptions {
  provider: string;
  /** Max requests per `perMs` window. */
  rateLimit?: { requests: number; perMs: number };
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  breaker?: { failureThreshold: number; cooldownMs: number };
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }
  /** Milliseconds to wait before a token is available (0 = take now). */
  take(): number {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (t - this.last) * this.refillPerMs);
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - this.tokens) / this.refillPerMs);
  }
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  state: CircuitState = "CLOSED";
  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  canRequest(): boolean {
    if (this.state === "OPEN" && this.now() - this.openedAt >= this.cooldownMs) this.state = "HALF_OPEN";
    return this.state !== "OPEN";
  }
  success() {
    this.failures = 0;
    this.state = "CLOSED";
  }
  failure() {
    this.failures += 1;
    if (this.state === "HALF_OPEN" || this.failures >= this.threshold) {
      this.state = "OPEN";
      this.openedAt = this.now();
    }
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpClient {
  private readonly bucket?: TokenBucket;
  private readonly breaker: CircuitBreaker;
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly opts: Required<Omit<PolicyOptions, "rateLimit" | "breaker">> & Pick<PolicyOptions, "rateLimit" | "breaker">;

  constructor(opts: PolicyOptions) {
    this.opts = {
      maxRetries: 3,
      baseDelayMs: 500,
      timeoutMs: 10_000,
      cacheTtlMs: 0,
      fetchImpl: globalThis.fetch.bind(globalThis),
      sleep: defaultSleep,
      now: Date.now,
      ...opts,
    };
    if (opts.rateLimit) {
      this.bucket = new TokenBucket(opts.rateLimit.requests, opts.rateLimit.requests / opts.rateLimit.perMs, this.opts.now);
    }
    const b = opts.breaker ?? { failureThreshold: 5, cooldownMs: 60_000 };
    this.breaker = new CircuitBreaker(b.failureThreshold, b.cooldownMs, this.opts.now);
  }

  get circuitState() {
    return this.breaker.state;
  }

  async getJson<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const { provider, cacheTtlMs, now } = this.opts;
    const cached = this.cache.get(url);
    if (cached && cacheTtlMs > 0 && now() - cached.at < cacheTtlMs) return cached.value as T;
    if (!this.breaker.canRequest()) throw new ProviderError(provider, "circuit open; skipping request", undefined, true);

    let attempt = 0;
    for (;;) {
      if (this.bucket) {
        let wait = this.bucket.take();
        while (wait > 0) {
          await this.opts.sleep(wait);
          wait = this.bucket.take();
        }
      }
      try {
        const value = await this.once<T>(url, headers);
        this.breaker.success();
        if (cacheTtlMs > 0) this.cache.set(url, { at: now(), value });
        return value;
      } catch (err) {
        const retryable = err instanceof ProviderError ? err.retryable : true;
        if (!retryable || attempt >= this.opts.maxRetries) {
          if (retryable) this.breaker.failure();
          throw err instanceof ProviderError ? err : new ProviderError(provider, String(err), undefined, true);
        }
        const delay = this.opts.baseDelayMs * 2 ** attempt * (0.5 + Math.random() / 2);
        attempt += 1;
        await this.opts.sleep(delay);
      }
    }
  }

  private async once<T>(url: string, headers: Record<string, string>): Promise<T> {
    const { provider, timeoutMs, fetchImpl } = this.opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal, cache: "no-store" });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        // Never echo request URLs (they may carry API keys) into errors.
        throw new ProviderError(provider, `HTTP ${res.status}`, res.status, retryable);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const name = (err as Error)?.name;
      throw new ProviderError(provider, name === "AbortError" ? "request timed out" : "network error", undefined, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Removes secrets from a URL before it is logged. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/key|token|secret|signature/i.test(k)) u.searchParams.set(k, "REDACTED");
    }
    return u.toString();
  } catch {
    return "[unparseable url]";
  }
}
