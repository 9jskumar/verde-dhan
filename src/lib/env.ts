import { z } from "zod";

/**
 * Server-side configuration. Secrets are only ever read here, on the server;
 * nothing in this module may be imported by a client component. Values are
 * optional so the app boots without credentials, and every feature reports
 * "pending integration" until its credentials exist.
 */

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: optional,
  /** Synthetic demo data. Refused in production unless explicitly allowed. */
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  ALLOW_DEMO_IN_PRODUCTION: z.enum(["true", "false"]).default("false"),

  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,

  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),

  WHATSAPP_ACCESS_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  WHATSAPP_BUSINESS_ACCOUNT_ID: optional,
  WHATSAPP_API_VERSION: z.string().default("v23.0"),
  WHATSAPP_RECIPIENT: optional,
  /** Set to "true" only once the recipient has opted in to business messages. */
  WHATSAPP_RECIPIENT_OPTED_IN: z.enum(["true", "false"]).default("false"),
  WHATSAPP_APP_SECRET: optional,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: optional,

  INDIA_MARKET_PROVIDER: z.enum(["angelone", "none"]).default("none"),
  /** Angel One SmartAPI: app key, client code, login PIN and the TOTP setup key. */
  ANGELONE_API_KEY: optional,
  ANGELONE_CLIENT_CODE: optional,
  ANGELONE_PIN: optional,
  ANGELONE_TOTP_SECRET: optional,

  /**
   * What the Global, Forex and Commodities pages display. "tradingview"
   * embeds TradingView widgets, which render in the browser only and never
   * feed the scores, AI evidence or WhatsApp reports.
   */
  GLOBAL_MARKET_PROVIDER: z.enum(["tradingview", "none"]).default("tradingview"),
  /** Server-side source of global numbers for scoring and reports. */
  GLOBAL_DATA_PROVIDER: z.enum(["twelvedata", "none"]).default("none"),
  TWELVEDATA_API_KEY: optional,
  /** JSON object overriding internal key → vendor symbol, e.g. {"SPX":"SPX"} */
  TWELVEDATA_SYMBOL_MAP: optional,

  NEWS_RSS_FEEDS: optional, // comma-separated publisher RSS URLs you are licensed to use

  CRON_SECRET: optional,
  NOTIFICATION_TIMEZONE: z.string().default("Asia/Kolkata"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Report variable names only; never values.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests. */
export function resetEnvCache() {
  cached = null;
}

export function isDemoMode(e: Env = env()): boolean {
  if (e.DEMO_MODE !== "true") return false;
  if (e.NODE_ENV === "production" && e.ALLOW_DEMO_IN_PRODUCTION !== "true") return false;
  return true;
}

export function angelOneConfigured(e: Env = env()): boolean {
  return e.INDIA_MARKET_PROVIDER === "angelone" && Boolean(e.ANGELONE_API_KEY && e.ANGELONE_CLIENT_CODE && e.ANGELONE_PIN && e.ANGELONE_TOTP_SECRET);
}

export const integrationStatus = (e: Env = env()) => ({
  supabase: Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseService: Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY),
  claude: Boolean(e.ANTHROPIC_API_KEY),
  whatsapp: Boolean(e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_RECIPIENT),
  whatsappOptIn: e.WHATSAPP_RECIPIENT_OPTED_IN === "true",
  whatsappWebhook: Boolean(e.WHATSAPP_APP_SECRET && e.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
  indiaMarketData: angelOneConfigured(e),
  globalCharts: e.GLOBAL_MARKET_PROVIDER === "tradingview",
  globalMarketData: e.GLOBAL_DATA_PROVIDER === "twelvedata" && Boolean(e.TWELVEDATA_API_KEY),
  news: Boolean(e.NEWS_RSS_FEEDS),
  cron: Boolean(e.CRON_SECRET),
  demoMode: isDemoMode(e),
});
