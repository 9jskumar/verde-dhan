import { describe, expect, it } from "vitest";
import { demoResearch } from "../data/demo-research";
import { assistantEvidence } from "./assistant-evidence";
import { verifyAssistantAnswer } from "./verify";

describe("assistant evidence and verification", () => {
  it("prefixes ids per symbol and covers the Top 3 by default", async () => {
    const r = await demoResearch();
    const pack = assistantEvidence(r, null)!;
    expect(pack.isDemo).toBe(true);
    for (const a of r.top3) expect(pack.items.some((i) => i.id === `${a.symbol}.score.total`)).toBe(true);
    expect(new Set(pack.items.map((i) => i.id)).size).toBe(pack.items.length);
  });

  it("returns null for a symbol outside the universe", async () => {
    expect(assistantEvidence(await demoResearch(), "NOPE")).toBeNull();
  });

  it("accepts traced numbers and rejects invented ones and certainty language", async () => {
    const r = await demoResearch();
    const a = r.top3[0]!;
    const pack = assistantEvidence(r, a.symbol)!;
    const ok = verifyAssistantAnswer({ answer: `${a.symbol} scores ${a.score.total.toFixed(1)} out of 100.`, evidenceIds: [`${a.symbol}.score.total`] }, pack);
    expect(ok.issues).toEqual([]);
    const bad = verifyAssistantAnswer({ answer: "It is a guaranteed move to 9137.4.", evidenceIds: ["made.up"] }, pack);
    expect(bad.accepted).toBe(false);
    expect(bad.issues.join(" ")).toMatch(/9137.4/);
    expect(bad.issues.join(" ")).toMatch(/guaranteed/);
    expect(bad.issues.join(" ")).toMatch(/made.up/);
  });
});
