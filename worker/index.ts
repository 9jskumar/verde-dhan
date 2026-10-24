/**
 * Long-running background worker (Part 15). Run with `npm run worker` under
 * a process manager (PM2 / systemd / MilesWeb Node.js app). Schedules are
 * evaluated in Asia/Kolkata. Each tick goes through runJob(), which makes
 * retries and overlapping triggers idempotent.
 *
 * If the host cannot keep a background process alive, disable this worker
 * and call POST /api/cron/<job> from the host's cron instead (see
 * docs/DEPLOYMENT_GUIDE.md).
 */
import { Cron } from "croner";
import { integrationStatus } from "../src/lib/env";
import { JOBS } from "../src/lib/jobs/definitions";
import { runJob } from "../src/lib/jobs/runner";
import { HANDLERS } from "../src/lib/jobs/tasks";
import { supabaseAdmin } from "../src/lib/supabase/admin";

const log = (msg: string, extra?: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg, ...extra }));

const db = supabaseAdmin();
if (!db) {
  console.error("Worker needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Exiting.");
  process.exit(1);
}

log("worker starting", { integrations: integrationStatus() });
const crons = JOBS.map(
  (job) =>
    new Cron(job.cron, { timezone: "Asia/Kolkata", protect: true, name: job.name }, async () => {
      const outcome = await runJob(job.name, HANDLERS, { db, now: new Date(), log });
      if (outcome.status !== "SKIPPED" || job.window !== "minute") log("job finished", { ...outcome });
    }),
);
for (const c of crons) log("scheduled", { job: c.name, next: c.nextRun()?.toISOString() });

const shutdown = () => {
  log("worker stopping");
  for (const c of crons) c.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
