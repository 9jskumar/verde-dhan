import { z } from "zod";

/**
 * Structured AI output contracts (Part 11). Kept to plain types so they map
 * cleanly onto the API's structured-output JSON Schema subset; range and
 * consistency rules are enforced afterwards in verify.ts.
 */

export const RECOMMENDATIONS = ["BUY_BREAKOUT", "BUY_ON_BREAKOUT", "BUY_ON_RETEST", "WATCH", "AVOID"] as const;

export const stockRecommendationSchema = z.object({
  symbol: z.string(),
  companyName: z.string(),
  fundamentalScore: z.number(),
  technicalScore: z.number(),
  catalystScore: z.number(),
  valuationRiskScore: z.number(),
  globalAlignmentScore: z.number(),
  totalScore: z.number(),
  recommendation: z.enum(RECOMMENDATIONS),
  entryLow: z.number().nullable(),
  entryHigh: z.number().nullable(),
  stopLoss: z.number().nullable(),
  target1: z.number().nullable(),
  target2: z.number().nullable(),
  target3: z.number().nullable(),
  riskReward: z.number().nullable(),
  investmentHorizon: z.string().nullable(),
  summary: z.string(),
  supportingEvidence: z.array(z.object({ claim: z.string(), evidenceIds: z.array(z.string()) })),
  riskFactors: z.array(z.string()),
  sourceReferences: z.array(z.string()),
  /** How well the evidence supports the view. Not a probability of profit. */
  evidenceConfidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  dataGaps: z.array(z.string()),
});
export type StockRecommendation = z.infer<typeof stockRecommendationSchema>;

export const globalImpactNarrativeSchema = z.object({
  globalSentimentSummary: z.string(),
  indianMarketImplications: z.array(z.object({ point: z.string(), evidenceIds: z.array(z.string()) })),
  sectorBeneficiaries: z.array(z.object({ sector: z.string(), reason: z.string(), evidenceIds: z.array(z.string()) })),
  sectorsUnderPressure: z.array(z.object({ sector: z.string(), reason: z.string(), evidenceIds: z.array(z.string()) })),
  potentialCatalysts: z.array(z.string()),
  riskWarnings: z.array(z.string()),
  dataGaps: z.array(z.string()),
});
export type GlobalImpactNarrative = z.infer<typeof globalImpactNarrativeSchema>;

export const assistantAnswerSchema = z.object({
  answer: z.string(),
  evidenceIds: z.array(z.string()),
  /** True when the question can't be answered from the supplied data. */
  insufficientData: z.boolean(),
  followUps: z.array(z.string()),
});
export type AssistantAnswer = z.infer<typeof assistantAnswerSchema>;
