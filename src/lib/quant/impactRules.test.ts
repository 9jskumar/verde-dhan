import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_IMPACT_RULES } from "./impactRules";

describe("impact rules", () => {
  it("TypeScript defaults match the SQL seed migration", () => {
    const dir = path.resolve(__dirname, "../../../supabase/migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_impact_rules_seed.sql"))!;
    const sql = readFileSync(path.join(dir, file), "utf8");
    const sqlIds = [...sql.matchAll(/^\s*\('([a-z0-9_]+)', '([A-Z0-9]+)', '(UP|DOWN)', ([\d.]+), '([^']+)', '(POSITIVE|NEGATIVE)'/gm)].map(
      (m) => `${m[1]}|${m[2]}|${m[3]}|${Number(m[4])}|${m[5]}|${m[6]}`,
    );
    const tsIds = DEFAULT_IMPACT_RULES.map((r) => `${r.id}|${r.globalInstrument}|${r.movementType}|${r.thresholdPct}|${r.affectedSector}|${r.impactDirection}`);
    expect(tsIds).toEqual(sqlIds);
    expect(tsIds.length).toBeGreaterThan(20);
  });
});
