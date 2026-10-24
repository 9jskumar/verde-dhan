-- Default global → Indian sector impact rules.
-- These encode sector economics (cost structures, revenue currency), not
-- proven causal links. Each must be validated against historical data
-- (see backtest_runs) before its confidence is raised.

insert into public.global_market_impact_rules
  (id, global_instrument, movement_type, threshold_pct, affected_sector, impact_direction, impact_mechanism, confidence, applicable_conditions, source_references)
values
  ('brent_up_omc', 'BRENT', 'UP', 2, 'Oil Marketing', 'NEGATIVE', 'Crude is the main input cost; retail fuel price pass-through is often delayed, compressing marketing margins.', 'HIGH', 'Weaker when retail prices are deregulated and being revised promptly.', '{"Company annual reports: cost of materials consumed"}'),
  ('brent_up_aviation', 'BRENT', 'UP', 2, 'Aviation', 'NEGATIVE', 'Aviation turbine fuel is the largest single operating cost for Indian airlines.', 'HIGH', null, '{"Airline annual reports: fuel cost share of operating expenses"}'),
  ('brent_up_paints', 'BRENT', 'UP', 2, 'Paints', 'NEGATIVE', 'Crude derivatives (solvents, monomers) are significant raw materials; pass-through lags.', 'MEDIUM', null, '{"Paint company annual reports: raw material mix"}'),
  ('brent_up_tyres', 'BRENT', 'UP', 2, 'Tyres', 'NEGATIVE', 'Synthetic rubber and carbon black are crude-linked inputs.', 'MEDIUM', null, '{}'),
  ('brent_up_upstream', 'BRENT', 'UP', 2, 'Upstream Oil & Gas', 'POSITIVE', 'Higher realisations on crude production.', 'MEDIUM', 'Muted when windfall taxes or price caps apply.', '{}'),
  ('brent_down_omc', 'BRENT', 'DOWN', 2, 'Oil Marketing', 'POSITIVE', 'Lower input cost can widen marketing margins.', 'HIGH', null, '{}'),
  ('brent_down_aviation', 'BRENT', 'DOWN', 2, 'Aviation', 'POSITIVE', 'Lower fuel cost.', 'HIGH', null, '{}'),
  ('brent_down_paints', 'BRENT', 'DOWN', 2, 'Paints', 'POSITIVE', 'Lower crude-linked raw material costs.', 'MEDIUM', null, '{}'),
  ('brent_down_upstream', 'BRENT', 'DOWN', 2, 'Upstream Oil & Gas', 'NEGATIVE', 'Lower realisations.', 'MEDIUM', null, '{}'),
  ('usdinr_up_it', 'USDINR', 'UP', 0.3, 'IT Services', 'POSITIVE', 'Revenues are largely USD-denominated while costs are mostly INR.', 'MEDIUM', 'Hedging programmes delay the effect.', '{"IT services annual reports: geographic revenue mix"}'),
  ('usdinr_up_pharma', 'USDINR', 'UP', 0.3, 'Pharmaceuticals', 'POSITIVE', 'Export-oriented generics earn in USD.', 'LOW', 'Only for export-heavy companies.', '{}'),
  ('usdinr_up_omc', 'USDINR', 'UP', 0.3, 'Oil Marketing', 'NEGATIVE', 'Crude imports are USD-priced.', 'LOW', null, '{}'),
  ('ndx_up_it', 'NDX', 'UP', 1, 'IT Services', 'POSITIVE', 'Read-through from US technology demand and sentiment.', 'LOW', 'Sentiment link; weak fundamental transmission in the short term.', '{}'),
  ('ndx_down_it', 'NDX', 'DOWN', 1.5, 'IT Services', 'NEGATIVE', 'Risk-off read-through to Indian IT from US tech sell-offs.', 'LOW', null, '{}'),
  ('copper_up_metals', 'COPPER', 'UP', 2, 'Metals', 'POSITIVE', 'Higher realisations for non-ferrous producers.', 'MEDIUM', null, '{}'),
  ('aluminium_up_metals', 'ALUMINIUM', 'UP', 2, 'Metals', 'POSITIVE', 'Higher realisations for aluminium producers.', 'MEDIUM', null, '{}'),
  ('zinc_up_metals', 'ZINC', 'UP', 2, 'Metals', 'POSITIVE', 'Higher realisations for zinc producers.', 'MEDIUM', null, '{}'),
  ('copper_down_metals', 'COPPER', 'DOWN', 2, 'Metals', 'NEGATIVE', 'Lower realisations.', 'MEDIUM', null, '{}'),
  ('gold_up_goldfin', 'XAU', 'UP', 1.5, 'Gold Finance', 'POSITIVE', 'Higher collateral value supports loan growth.', 'LOW', null, '{}'),
  ('gold_up_jewellery', 'XAU', 'UP', 1.5, 'Jewellery', 'NEGATIVE', 'Sharp price rises can dampen volume demand.', 'LOW', 'Inventory gains can offset in the short run.', '{}'),
  ('natgas_up_cgd', 'NATGAS', 'UP', 5, 'City Gas Distribution', 'NEGATIVE', 'Imported LNG is a key input cost.', 'MEDIUM', 'Domestic APM gas allocation dilutes the effect.', '{}'),
  ('spx_down_broad', 'SPX', 'DOWN', 1.5, 'Broad Market', 'NEGATIVE', 'Global risk-off can trigger foreign portfolio outflows.', 'LOW', null, '{}'),
  ('spx_up_broad', 'SPX', 'UP', 1, 'Broad Market', 'POSITIVE', 'Global risk-on supports foreign portfolio inflows.', 'LOW', null, '{}');
