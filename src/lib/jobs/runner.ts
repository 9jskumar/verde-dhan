import type { SupabaseClient } from "@supabase/supabase-js";
import { isIndianTradingDay } from "./calendar";
import { idempotencyKey, type JobDefinition, jobByName } from "./definitions";

export interface JobContext {
  db: SupabaseClient;
  now: Date;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

export interface JobOutcome {
  job: string;
  key: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  reason?: string;
  metrics?: Record<string, unknown>;
  error?: string;
}

const STALE_RUNNING_MS = 30 * 60_000;

export async function loadHolidays(db: SupabaseClient, exchange = "NSE"): Promise<Set<string>> {
  const { data, error } = await db.from("market_holidays").select("holiday_date").eq("exchange", exchange).eq("session", "FULL");
  if (error) throw new Error(`could not load market holidays: ${error.message}`);
  return new Set((data ?? []).map((r: { holiday_date: string }) => r.holiday_date));
}

/**
 * Claims the idempotency window, runs the handler, records the outcome.
 * Safe to call repeatedly: completed windows are skipped, failed windows are
 * retried with an incremented attempt counter.
 */
export async function runJob(name: string, handlers: Record<string, JobHandler>, ctx: JobContext, opts: { force?: boolean } = {}): Promise<JobOutcome> {
  const def: JobDefinition | undefined = jobByName(name);
  const handler = handlers[name];
  if (!def || !handler) throw new Error(`unknown job ${name}`);
  const key = idempotencyKey(def, ctx.now) + (opts.force ? `:force:${ctx.now.getTime()}` : "");
  const { db } = ctx;

  if (def.tradingDaysOnly) {
    const holidays = await loadHolidays(db);
    if (!isIndianTradingDay(ctx.now, holidays)) {
      await db.from("job_runs").upsert(
        { job_name: name, idempotency_key: key, scheduled_for: ctx.now.toISOString(), status: "SKIPPED", skip_reason: "not an Indian trading day", finished_at: new Date().toISOString() },
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      );
      return { job: name, key, status: "SKIPPED", reason: "not an Indian trading day" };
    }
  }

  const { data: existing } = await db.from("job_runs").select("id,status,attempt,started_at").eq("idempotency_key", key).maybeSingle();
  let runId: string;
  if (existing) {
    const runningFresh = existing.status === "RUNNING" && Date.now() - Date.parse(existing.started_at) < STALE_RUNNING_MS;
    if (existing.status === "SUCCEEDED" || existing.status === "SKIPPED" || runningFresh) {
      return { job: name, key, status: "SKIPPED", reason: `window already ${existing.status.toLowerCase()}` };
    }
    // Conditional update: only one concurrent retrier wins the claim.
    const { data: claimed } = await db
      .from("job_runs")
      .update({ status: "RUNNING", attempt: existing.attempt + 1, started_at: new Date().toISOString(), error: null })
      .eq("id", existing.id)
      .eq("status", existing.status)
      .select("id")
      .maybeSingle();
    if (!claimed) return { job: name, key, status: "SKIPPED", reason: "claimed by another worker" };
    runId = claimed.id;
  } else {
    const { data: inserted, error } = await db
      .from("job_runs")
      .insert({ job_name: name, idempotency_key: key, scheduled_for: ctx.now.toISOString(), status: "RUNNING" })
      .select("id")
      .single();
    if (error || !inserted) return { job: name, key, status: "SKIPPED", reason: "claimed by another worker" };
    runId = inserted.id;
  }

  try {
    const metrics = await handler(ctx);
    await db.from("job_runs").update({ status: "SUCCEEDED", finished_at: new Date().toISOString(), metrics }).eq("id", runId);
    return { job: name, key, status: "SUCCEEDED", metrics };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("job_runs").update({ status: "FAILED", finished_at: new Date().toISOString(), error: message.slice(0, 2000) }).eq("id", runId);
    ctx.log(`job ${name} failed`, { error: message });
    return { job: name, key, status: "FAILED", error: message };
  }
}
