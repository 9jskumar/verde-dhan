/**
 * Scheduled job catalogue (Part 15). Cron expressions are evaluated in
 * Asia/Kolkata by the worker. The same jobs can be triggered by an
 * external cron (cPanel/MilesWeb) via POST /api/cron/<job>.
 *
 * Idempotency: each run claims `<job>:<window>` in job_runs. A retried or
 * duplicated trigger inside the same window is skipped, and WhatsApp
 * messages carry their own per-recipient idempotency key, so retries never
 * double-send.
 */

export type JobName =
  | "ingest_india_prices"
  | "ingest_global_markets"
  | "ingest_news"
  | "compute_analysis"
  | "global_impact"
  | "daily_ranking"
  | "whatsapp_global_premarket"
  | "whatsapp_india_premarket"
  | "whatsapp_daily_close"
  | "exceptional_alerts"
  | "dispatch_notifications"
  | "recommendation_performance"
  | "data_quality"
  | "refresh_views";

export interface JobDefinition {
  name: JobName;
  description: string;
  cron: string;
  /** Granularity of the idempotency window. */
  window: "minute" | "15min" | "hour" | "day";
  /** Only run on Indian trading days. */
  tradingDaysOnly: boolean;
}

export const JOBS: JobDefinition[] = [
  { name: "ingest_india_prices", description: "NSE/BSE quotes intraday and EOD candles (provider permitting)", cron: "*/15 9-15 * * 1-5", window: "15min", tradingDaysOnly: true },
  { name: "ingest_global_markets", description: "Global indices, forex and commodities", cron: "*/30 * * * *", window: "15min", tradingDaysOnly: false },
  { name: "ingest_news", description: "Licensed news feeds, deduplicated", cron: "*/20 * * * *", window: "15min", tradingDaysOnly: false },
  { name: "compute_analysis", description: "Technicals, breakout detection and scoring after new data", cron: "45 15 * * 1-5", window: "day", tradingDaysOnly: true },
  { name: "global_impact", description: "Rule-based global impact plus AI interpretation", cron: "40 7 * * 1-5", window: "day", tradingDaysOnly: false },
  { name: "daily_ranking", description: "Daily Top 10 / Top 3 after the Indian close", cron: "10 16 * * 1-5", window: "day", tradingDaysOnly: true },
  { name: "whatsapp_global_premarket", description: "08:00 IST global pre-market report", cron: "0 8 * * 1-5", window: "day", tradingDaysOnly: true },
  { name: "whatsapp_india_premarket", description: "08:30 IST Indian pre-market opportunities", cron: "30 8 * * 1-5", window: "day", tradingDaysOnly: true },
  { name: "whatsapp_daily_close", description: "Daily closing report (16:00–17:00 IST)", cron: "30 16 * * 1-5", window: "day", tradingDaysOnly: true },
  { name: "exceptional_alerts", description: "Threshold-based alerts during market hours", cron: "*/15 9-15 * * 1-5", window: "15min", tradingDaysOnly: true },
  { name: "dispatch_notifications", description: "Send due WhatsApp jobs and retry failures", cron: "* * * * *", window: "minute", tradingDaysOnly: false },
  { name: "recommendation_performance", description: "Track outcomes of past recommendations", cron: "30 18 * * 1-5", window: "day", tradingDaysOnly: true },
  { name: "data_quality", description: "Stale data, gaps, duplicates, provider health", cron: "5 * * * *", window: "hour", tradingDaysOnly: false },
  { name: "refresh_views", description: "Refresh materialized views", cron: "50 15 * * 1-5", window: "day", tradingDaysOnly: false },
];

export function jobByName(name: string): JobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}

/** `<job>:<window-start>` in IST, e.g. daily_ranking:2026-10-23 or ingest_news:2026-10-23T10:15 */
export function idempotencyKey(job: JobDefinition, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = `${g("year")}-${g("month")}-${g("day")}`;
  const minute = Number(g("minute"));
  switch (job.window) {
    case "day":
      return `${job.name}:${day}`;
    case "hour":
      return `${job.name}:${day}T${g("hour")}`;
    case "15min":
      return `${job.name}:${day}T${g("hour")}:${String(minute - (minute % 15)).padStart(2, "0")}`;
    case "minute":
      return `${job.name}:${day}T${g("hour")}:${g("minute")}`;
  }
}
