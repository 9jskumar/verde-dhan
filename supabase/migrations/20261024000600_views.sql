-- Verde Dhan — read views (Part 6).
--
-- Every view is security_invoker, so the caller's RLS on the underlying
-- tables always applies (no definer-rights bypass). Heavy "latest row" scans
-- are materialized and refreshed by the worker after ingestion /
-- calculation jobs, never per request. Materialized views cannot carry RLS,
-- so they are granted to `authenticated` only and hold shared market data.

-- Full stock identity in the shape described by the brief.
create view public.v_stocks with (security_invoker = true) as
select s.id, c.company_name, s.symbol, s.bse_code, c.isin, s.exchange, c.sector, c.industry,
       c.market_cap, c.market_cap_category, s.listing_status, s.instrument_type,
       c.is_financial_sector, s.company_id, s.created_at, s.updated_at
from public.stocks s
join public.companies c on c.id = s.company_id;

-- 1. Latest daily price per listing (materialized).
create materialized view public.mv_latest_stock_prices as
select distinct on (p.stock_id)
       p.stock_id, p.exchange, p."timestamp", p.open, p.high, p.low, p.close, p.adjusted_close,
       p.volume, p.traded_value, p.delivery_percentage, p.source, p.data_delay_seconds,
       prev.close as previous_close,
       case when prev.close > 0 then round(((p.close - prev.close) / prev.close * 100)::numeric, 4) end as change_pct
from public.market_prices p
left join lateral (
  select close from public.market_prices q
  where q.stock_id = p.stock_id and q.interval = '1d' and q.is_complete and q."timestamp" < p."timestamp"
  order by q."timestamp" desc limit 1
) prev on true
where p.interval = '1d' and p.is_complete
order by p.stock_id, p."timestamp" desc;
create unique index mv_latest_stock_prices_pk on public.mv_latest_stock_prices (stock_id);

create view public.v_latest_stock_prices with (security_invoker = true) as
select v.symbol, v.company_name, v.sector, m.*
from public.mv_latest_stock_prices m
join public.v_stocks v on v.id = m.stock_id;

-- 2. Latest fundamental metrics per company and basis (consolidated preferred).
create view public.v_latest_fundamental_metrics with (security_invoker = true) as
select distinct on (fm.company_id) fm.*
from public.fundamental_metrics fm
order by fm.company_id, (fm.reporting_basis = 'consolidated') desc, (fm.period_type = 'annual') desc, fm.calculation_date desc;

-- 3. Latest technical snapshot per listing (materialized).
create materialized view public.mv_latest_technical_indicators as
select distinct on (t.stock_id) t.*
from public.technical_indicators t
order by t.stock_id, t."timestamp" desc, t.created_at desc;
create unique index mv_latest_technical_indicators_pk on public.mv_latest_technical_indicators (stock_id);

create view public.v_latest_technical_indicators with (security_invoker = true) as select * from public.mv_latest_technical_indicators;

-- 4. Latest score per listing.
create view public.v_stock_quality_scores with (security_invoker = true) as
select distinct on (a.stock_id)
       a.stock_id, v.symbol, v.company_name, v.exchange, v.sector, a.analysis_date,
       a.fundamental_score, a.technical_score, a.catalyst_score, a.global_alignment_score,
       a.valuation_risk_score, a.total_score, a.data_coverage, a.classification,
       a.rejection_reasons, a.recommendation, a.is_demo
from public.stock_analysis a
join public.v_stocks v on v.id = a.stock_id
order by a.stock_id, a.analysis_date desc, a.created_at desc;

-- 5–7. Latest global index / forex / commodity readings.
create view public.v_global_market_latest with (security_invoker = true) as
select distinct on (g.symbol) g.*, gi.exchange_timezone
from public.global_indices g
join public.global_instruments gi on gi.symbol = g.symbol
order by g.symbol, g."timestamp" desc;

create view public.v_forex_latest with (security_invoker = true) as
select distinct on (f.pair) f.*
from public.forex_prices f
order by f.pair, f."timestamp" desc;

create view public.v_commodities_latest with (security_invoker = true) as
select distinct on (c.instrument, c.contract_type) c.*, gi.name
from public.commodity_prices c
join public.global_instruments gi on gi.symbol = c.instrument
order by c.instrument, c.contract_type, c."timestamp" desc;

-- 8. Sector performance from the latest session (market-cap weighted where available).
create view public.v_sector_performance with (security_invoker = true) as
select v.sector,
       count(*) as constituents,
       round(avg(m.change_pct), 3) as avg_change_pct,
       round((sum(m.change_pct * coalesce(v.market_cap, 0)) / nullif(sum(coalesce(v.market_cap, 0)), 0))::numeric, 3) as mcap_weighted_change_pct,
       count(*) filter (where m.change_pct > 0) as advancers,
       count(*) filter (where m.change_pct < 0) as decliners,
       max(m."timestamp") as as_of
from public.mv_latest_stock_prices m
join public.v_stocks v on v.id = m.stock_id
where v.sector is not null and v.listing_status = 'ACTIVE'
group by v.sector;

-- 9. Breakout candidates.
create view public.v_breakout_candidates with (security_invoker = true) as
select t.stock_id, v.symbol, v.company_name, v.exchange, v.sector, t."timestamp", t.close,
       t.breakout_stage, t.breakout_level, t.resistance_level, t.support_level,
       t.relative_volume, t.rsi_14, t.breakout_evidence
from public.mv_latest_technical_indicators t
join public.v_stocks v on v.id = t.stock_id
where t.breakout_stage in ('EARLY', 'CONFIRMED', 'RETEST', 'FAILED');

-- 10. Top 10 opportunities for the latest analysis date. Rejected and
-- "do not recommend" names never appear, whatever their score.
create view public.v_top_10_opportunities with (security_invoker = true) as
with latest as (select max(analysis_date) as d from public.stock_analysis)
select a.*, v.symbol, v.company_name, v.exchange, v.sector,
       row_number() over (order by a.total_score desc, a.technical_score desc) as rank
from public.stock_analysis a
join latest on a.analysis_date = latest.d
join public.v_stocks v on v.id = a.stock_id
where a.classification in ('EXCEPTIONAL', 'HIGH_POTENTIAL', 'QUALIFIED')
  and a.recommendation <> 'AVOID'
  and cardinality(a.rejection_reasons) = 0
order by a.total_score desc, a.technical_score desc
limit 10;

-- 11. Top 3: highest-ranked with a complete, validated trade plan.
create view public.v_top_3_opportunities with (security_invoker = true) as
select * from public.v_top_10_opportunities
where entry_low is not null and stop_loss is not null and target_1 is not null and risk_reward >= 1.5
order by rank
limit 3;

-- 12. Watchlist performance (private: caller's RLS applies).
create view public.v_watchlist_performance with (security_invoker = true) as
select w.id as watchlist_id, w.name as watchlist_name, w.user_id, ws.stock_id, v.symbol, v.company_name,
       ws.added_at, ws.added_price, m.close as last_close, m."timestamp" as last_price_at, m.change_pct as day_change_pct,
       case when ws.added_price > 0 then round(((m.close - ws.added_price) / ws.added_price * 100)::numeric, 2) end as return_since_added_pct
from public.watchlists w
join public.watchlist_stocks ws on ws.watchlist_id = w.id
join public.v_stocks v on v.id = ws.stock_id
left join public.v_latest_stock_prices m on m.stock_id = ws.stock_id;

-- 13. Recommendation performance.
create view public.v_recommendation_performance with (security_invoker = true) as
select r.list_type, coalesce(r.market_regime, 'UNKNOWN') as market_regime, v.sector, r.is_demo,
       count(*) as recommendations,
       count(o.*) filter (where o.status in ('TARGET_1_HIT', 'TARGET_2_HIT', 'TARGET_3_HIT')) as hits,
       count(o.*) filter (where o.status = 'STOPPED_OUT') as stopped_out,
       count(o.*) filter (where o.status = 'OPEN') as open_positions,
       round(avg(o.return_pct), 3) as avg_return_pct,
       round(min(o.max_adverse_excursion_pct), 3) as worst_adverse_excursion_pct
from public.recommendation_history r
join public.v_stocks v on v.id = r.stock_id
left join public.recommendation_outcomes o on o.recommendation_id = r.id
group by r.list_type, coalesce(r.market_regime, 'UNKNOWN'), v.sector, r.is_demo;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare v text;
begin
  execute 'revoke all on public.mv_latest_stock_prices, public.mv_latest_technical_indicators from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.mv_latest_stock_prices, public.mv_latest_technical_indicators from anon';
    execute 'grant select on public.mv_latest_stock_prices, public.mv_latest_technical_indicators to authenticated';
    foreach v in array array['v_stocks','v_latest_stock_prices','v_latest_fundamental_metrics','v_latest_technical_indicators',
                             'v_stock_quality_scores','v_global_market_latest','v_forex_latest','v_commodities_latest',
                             'v_sector_performance','v_breakout_candidates','v_top_10_opportunities','v_top_3_opportunities',
                             'v_watchlist_performance','v_recommendation_performance']
    loop
      execute format('revoke all on public.%I from anon', v);
      execute format('grant select on public.%I to authenticated', v);
    end loop;
  end if;
end $$;

-- Refresh after ingestion/calculation. CONCURRENTLY keeps readers unblocked.
create or replace function public.refresh_market_views()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view concurrently public.mv_latest_stock_prices;
  refresh materialized view concurrently public.mv_latest_technical_indicators;
end;
$$;
revoke all on function public.refresh_market_views() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.refresh_market_views() to service_role';
  end if;
end $$;
