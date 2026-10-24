/**
 * Runs one job immediately: `npm run job -- daily_ranking [--force]`.
 * `npm run job -- preview_reports` prints the WhatsApp report parameters
 * built from demo research without touching any database or API.
 */
import { demoResearch } from "../src/lib/data/demo-research";
import { DemoProvider } from "../src/lib/providers/demo";
import { COMMODITY_KEYS, FX_PAIRS, GLOBAL_INDEX_KEYS, INDIA_INDEX_KEYS } from "../src/lib/providers/types";
import { runJob } from "../src/lib/jobs/runner";
import { HANDLERS } from "../src/lib/jobs/tasks";
import { supabaseAdmin } from "../src/lib/supabase/admin";
import { dailyCloseParams, globalPremarketParams, indiaPremarketParams } from "../src/lib/whatsapp/reports";

const [name, ...flags] = process.argv.slice(2);
if (!name) {
  console.error(`usage: npm run job -- <${Object.keys(HANDLERS).join("|")}|preview_reports> [--force]`);
  process.exit(2);
}

async function main() {
  if (name === "preview_reports") {
    const p = new DemoProvider();
    const research = await demoResearch();
    const market = {
      india: await p.getIndexQuotes(INDIA_INDEX_KEYS),
      global: await p.getIndexQuotes(GLOBAL_INDEX_KEYS),
      fx: await p.getFxQuotes(FX_PAIRS),
      commodities: await p.getCommodityQuotes(COMMODITY_KEYS),
    };
    const now = new Date();
    console.log(JSON.stringify({
      GLOBAL_PREMARKET: globalPremarketParams(now, market, research, true),
      INDIA_PREMARKET: indiaPremarketParams(now, research),
      DAILY_CLOSE: dailyCloseParams(now, research, market),
    }, null, 2));
    return;
  }
  const db = supabaseAdmin();
  if (!db) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const out = await runJob(name!, HANDLERS, { db, now: new Date(), log: (m, e) => console.log(m, e ?? "") }, { force: flags.includes("--force") });
  console.log(JSON.stringify(out, null, 2));
  if (out.status === "FAILED") process.exit(1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
