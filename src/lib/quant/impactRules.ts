import type { ImpactRule } from "./globalImpact";

/**
 * Default impact rules, mirroring supabase/migrations/*_impact_rules_seed.sql
 * (kept in sync by impactRules.test.ts). Used in demo mode and as a
 * fallback when the rules table cannot be read; the database copy is the
 * editable source of truth in production.
 */
export const DEFAULT_IMPACT_RULES: ImpactRule[] = [
  {
    "id": "brent_up_omc",
    "globalInstrument": "BRENT",
    "movementType": "UP",
    "thresholdPct": 2.0,
    "affectedSector": "Oil Marketing",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Crude is the main input cost; retail fuel price pass-through is often delayed, compressing marketing margins.",
    "confidence": "HIGH",
    "applicableConditions": "Weaker when retail prices are deregulated and being revised promptly.",
    "sourceReferences": [
      "Company annual reports: cost of materials consumed"
    ]
  },
  {
    "id": "brent_up_aviation",
    "globalInstrument": "BRENT",
    "movementType": "UP",
    "thresholdPct": 2.0,
    "affectedSector": "Aviation",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Aviation turbine fuel is the largest single operating cost for Indian airlines.",
    "confidence": "HIGH",
    "applicableConditions": null,
    "sourceReferences": [
      "Airline annual reports: fuel cost share of operating expenses"
    ]
  },
  {
    "id": "brent_up_paints",
    "globalInstrument": "BRENT",
    "movementType": "UP",
    "thresholdPct": 2.0,
    "affectedSector": "Paints",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Crude derivatives (solvents, monomers) are significant raw materials; pass-through lags.",
    "confidence": "MEDIUM",
    "applicableConditions": null,
    "sourceReferences": [
      "Paint company annual reports: raw material mix"
    ]
  },
  {
    "id": "brent_up_tyres",
    "globalInstrument": "BRENT",
    "movementType": "UP",
    "thresholdPct": 2.0,
    "affectedSector": "Tyres",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Synthetic rubber and carbon black are crude-linked inputs.",
    "confidence": "MEDIUM",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "brent_up_upstream",
    "globalInstrument": "BRENT",
    "movementType": "UP",
    "thresholdPct": 2.0,
    "affectedSector": "Upstream Oil & Gas",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Higher realisations on crude production.",
    "confidence": "MEDIUM",
    "applicableConditions": "Muted when windfall taxes or price caps apply.",
    "sourceReferences": []
  },
  {
    "id": "brent_down_omc",
    "globalInstrument": "BRENT",
    "movementType": "DOWN",
    "thresholdPct": 2.0,
    "affectedSector": "Oil Marketing",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Lower input cost can widen marketing margins.",
    "confidence": "HIGH",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "brent_down_aviation",
    "globalInstrument": "BRENT",
    "movementType": "DOWN",
    "thresholdPct": 2.0,
    "affectedSector": "Aviation",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Lower fuel cost.",
    "confidence": "HIGH",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "brent_down_paints",
    "globalInstrument": "BRENT",
    "movementType": "DOWN",
    "thresholdPct": 2.0,
    "affectedSector": "Paints",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Lower crude-linked raw material costs.",
    "confidence": "MEDIUM",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "brent_down_upstream",
    "globalInstrument": "BRENT",
    "movementType": "DOWN",
    "thresholdPct": 2.0,
    "affectedSector": "Upstream Oil & Gas",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Lower realisations.",
    "confidence": "MEDIUM",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "usdinr_up_it",
    "globalInstrument": "USDINR",
    "movementType": "UP",
    "thresholdPct": 0.3,
    "affectedSector": "IT Services",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Revenues are largely USD-denominated while costs are mostly INR.",
    "confidence": "MEDIUM",
    "applicableConditions": "Hedging programmes delay the effect.",
    "sourceReferences": [
      "IT services annual reports: geographic revenue mix"
    ]
  },
  {
    "id": "usdinr_up_pharma",
    "globalInstrument": "USDINR",
    "movementType": "UP",
    "thresholdPct": 0.3,
    "affectedSector": "Pharmaceuticals",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Export-oriented generics earn in USD.",
    "confidence": "LOW",
    "applicableConditions": "Only for export-heavy companies.",
    "sourceReferences": []
  },
  {
    "id": "usdinr_up_omc",
    "globalInstrument": "USDINR",
    "movementType": "UP",
    "thresholdPct": 0.3,
    "affectedSector": "Oil Marketing",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Crude imports are USD-priced.",
    "confidence": "LOW",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "ndx_up_it",
    "globalInstrument": "NDX",
    "movementType": "UP",
    "thresholdPct": 1.0,
    "affectedSector": "IT Services",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Read-through from US technology demand and sentiment.",
    "confidence": "LOW",
    "applicableConditions": "Sentiment link; weak fundamental transmission in the short term.",
    "sourceReferences": []
  },
  {
    "id": "ndx_down_it",
    "globalInstrument": "NDX",
    "movementType": "DOWN",
    "thresholdPct": 1.5,
    "affectedSector": "IT Services",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Risk-off read-through to Indian IT from US tech sell-offs.",
    "confidence": "LOW",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "copper_up_metals",
    "globalInstrument": "COPPER",
    "movementType": "UP",
    "thresholdPct": 2.0,
    "affectedSector": "Metals",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Higher realisations for non-ferrous producers.",
    "confidence": "MEDIUM",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "aluminium_up_metals",
    "globalInstrument": "ALUMINIUM",
    "movementType": "UP",
    "thresholdPct": 2.0,
    "affectedSector": "Metals",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Higher realisations for aluminium producers.",
    "confidence": "MEDIUM",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "zinc_up_metals",
    "globalInstrument": "ZINC",
    "movementType": "UP",
    "thresholdPct": 2.0,
    "affectedSector": "Metals",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Higher realisations for zinc producers.",
    "confidence": "MEDIUM",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "copper_down_metals",
    "globalInstrument": "COPPER",
    "movementType": "DOWN",
    "thresholdPct": 2.0,
    "affectedSector": "Metals",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Lower realisations.",
    "confidence": "MEDIUM",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "gold_up_goldfin",
    "globalInstrument": "XAU",
    "movementType": "UP",
    "thresholdPct": 1.5,
    "affectedSector": "Gold Finance",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Higher collateral value supports loan growth.",
    "confidence": "LOW",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "gold_up_jewellery",
    "globalInstrument": "XAU",
    "movementType": "UP",
    "thresholdPct": 1.5,
    "affectedSector": "Jewellery",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Sharp price rises can dampen volume demand.",
    "confidence": "LOW",
    "applicableConditions": "Inventory gains can offset in the short run.",
    "sourceReferences": []
  },
  {
    "id": "natgas_up_cgd",
    "globalInstrument": "NATGAS",
    "movementType": "UP",
    "thresholdPct": 5.0,
    "affectedSector": "City Gas Distribution",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Imported LNG is a key input cost.",
    "confidence": "MEDIUM",
    "applicableConditions": "Domestic APM gas allocation dilutes the effect.",
    "sourceReferences": []
  },
  {
    "id": "spx_down_broad",
    "globalInstrument": "SPX",
    "movementType": "DOWN",
    "thresholdPct": 1.5,
    "affectedSector": "Broad Market",
    "impactDirection": "NEGATIVE",
    "impactMechanism": "Global risk-off can trigger foreign portfolio outflows.",
    "confidence": "LOW",
    "applicableConditions": null,
    "sourceReferences": []
  },
  {
    "id": "spx_up_broad",
    "globalInstrument": "SPX",
    "movementType": "UP",
    "thresholdPct": 1.0,
    "affectedSector": "Broad Market",
    "impactDirection": "POSITIVE",
    "impactMechanism": "Global risk-on supports foreign portfolio inflows.",
    "confidence": "LOW",
    "applicableConditions": null,
    "sourceReferences": []
  }
];
