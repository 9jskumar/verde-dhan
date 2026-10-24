import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jobByName } from "@/lib/jobs/definitions";
import { runJob } from "@/lib/jobs/runner";
import { HANDLERS } from "@/lib/jobs/tasks";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = env().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * External scheduler entry point (cPanel cron, MilesWeb cron, GitHub Actions…):
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/daily_ranking
 * Idempotency lives in job_runs, so a duplicate call inside the same window is a no-op.
 */
export async function POST(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!authorised(req)) return NextResponse.json({ message: "unauthorised" }, { status: 401 });
  const { job } = await params;
  if (!jobByName(job)) return NextResponse.json({ message: "unknown job" }, { status: 404 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ status: "pending_integration", message: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 503 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const out = await runJob(job, HANDLERS, { db, now: new Date(), log: (m, e) => console.log(`[cron:${job}] ${m}`, e ?? "") }, { force });
  return NextResponse.json(out, { status: out.status === "FAILED" ? 500 : 200 });
}
