import { describe, expect, it } from "vitest";
import { demoResearch } from "./demo-research";

describe("demo research pipeline (synthetic universe)", () => {
  it("runs end to end and flags everything as demo", async () => {
    const r = await demoResearch();
    expect(r.mode).toBe("demo");
    expect(r.analyses).toHaveLength(12);
    expect(r.analyses.every((a) => a.isDemo && a.source === "demo")).toBe(true);
  });

  it("never ranks rejected names, even with strong numbers", async () => {
    const r = await demoResearch();
    const garnet = r.analyses.find((a) => a.symbol === "DMGARNET")!;
    expect(garnet.score.rejections).toContain("GOVERNANCE_CONCERN");
    expect(garnet.recommendation).toBe("AVOID");
    expect(r.top10.map((a) => a.symbol)).not.toContain("DMGARNET");
    const iris = r.analyses.find((a) => a.symbol === "DMIRIS")!;
    expect(iris.recommendation).toBe("AVOID");
    expect(r.analyses.find((a) => a.symbol === "DMHARBOR")!.breakout.stage).toBe("FAILED");
  });

  it("top 3 have complete trade plans", async () => {
    const r = await demoResearch();
    expect(r.top10.length).toBeGreaterThan(0);
    for (const a of r.top3) {
      expect(a.breakout.plan).not.toBeNull();
      expect(a.breakout.plan!.stopLoss).toBeLessThan(a.breakout.plan!.entryLow);
    }
  });
});
