-- Database security & integrity tests. Run with supabase/tests/run_local.sh.
-- Each block raises an exception (failing the run) when an expectation breaks.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner, i.e. service-level access)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.test'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.test');
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000ad', 'admin');

insert into public.companies (id, company_name, isin, sector) values
  ('10000000-0000-0000-0000-000000000001', 'Demo Industries Ltd', 'INE000A01001', 'Industrials');
insert into public.stocks (id, company_id, exchange, symbol) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'NSE', 'DEMOIND'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'BSE', 'DEMOIND');
insert into public.market_prices (stock_id, exchange, "timestamp", open, high, low, close, volume, source) values
  ('20000000-0000-0000-0000-000000000001', 'NSE', '2026-10-22', 100, 105, 99, 104, 1000, 'demo'),
  ('20000000-0000-0000-0000-000000000001', 'NSE', '2026-10-23', 104, 108, 103, 107, 1500, 'demo');

insert into public.watchlists (id, user_id, name) values
  ('30000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Alice list'),
  ('30000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Bob list');
insert into public.watchlist_stocks (watchlist_id, stock_id, added_price) values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 100);
insert into public.portfolios (id, user_id, name) values
  ('40000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Bob portfolio');
insert into public.portfolio_transactions (portfolio_id, stock_id, side, quantity, price, executed_at) values
  ('40000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000001', 'BUY', 10, 100, now());

select public.refresh_market_views();

-- ---------------------------------------------------------------------------
-- 1. Sign-up trigger created profile, preferences and member role.
-- ---------------------------------------------------------------------------
do $$ begin
  if (select count(*) from public.profiles) <> 3 then raise exception 'profiles not created on sign-up'; end if;
  if not exists (select 1 from public.user_roles where user_id = '00000000-0000-0000-0000-00000000000a' and role = 'member') then
    raise exception 'member role not granted on sign-up';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Anonymous users see no market data and no private data.
-- ---------------------------------------------------------------------------
set role anon;
do $$ begin
  if (select count(*) from public.stocks) <> 0 then raise exception 'anon can read stocks'; end if;
  if (select count(*) from public.market_prices) <> 0 then raise exception 'anon can read market_prices'; end if;
  if (select count(*) from public.watchlists) <> 0 then raise exception 'anon can read watchlists'; end if;
end $$;
do $$ begin
  perform 1 from public.market_prices_2026;
  raise exception 'anon can read a market_prices partition directly';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from public.mv_latest_stock_prices;
  raise exception 'anon can read materialized view';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 3. Alice: reads market data, sees only her own private rows.
-- ---------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.stocks) <> 2 then raise exception 'authenticated cannot read stocks'; end if;
  if (select count(*) from public.v_latest_stock_prices) <> 1 then raise exception 'latest price view wrong'; end if;
  if (select change_pct from public.v_latest_stock_prices) <> 2.8846 then raise exception 'change_pct wrong: %', (select change_pct from public.v_latest_stock_prices); end if;
  if (select count(*) from public.watchlists) <> 1 then raise exception 'alice sees other watchlists'; end if;
  if (select count(*) from public.watchlist_stocks) <> 1 then raise exception 'alice watchlist rows wrong'; end if;
  if (select count(*) from public.portfolios) <> 0 then raise exception 'alice sees bob portfolio'; end if;
  if (select count(*) from public.portfolio_transactions) <> 0 then raise exception 'alice sees bob transactions'; end if;
  if (select count(*) from public.v_watchlist_performance) <> 1 then raise exception 'watchlist view leaks or empty'; end if;
  if (select return_since_added_pct from public.v_watchlist_performance) <> 7.00 then raise exception 'watchlist return wrong'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'alice sees other profiles'; end if;
  if (select count(*) from public.notification_jobs) <> 0 then raise exception 'non-admin sees notification jobs'; end if;
end $$;

-- Alice cannot write market data or insert into someone else's watchlist.
do $$ begin
  insert into public.stocks (company_id, exchange, symbol) values ('10000000-0000-0000-0000-000000000001', 'NSE', 'HACK');
  raise exception 'authenticated user inserted into stocks';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.watchlist_stocks (watchlist_id, stock_id) values ('30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000002');
  raise exception 'alice inserted into bob watchlist';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.watchlists (user_id, name) values ('00000000-0000-0000-0000-00000000000b', 'spoof');
  raise exception 'alice created a watchlist owned by bob';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000a', 'admin');
  raise exception 'alice escalated to admin';
exception when insufficient_privilege then null;
end $$;

-- Alice can manage her own data; user_id defaults to auth.uid().
insert into public.watchlists (name) values ('Alice second');
do $$ begin
  if (select count(*) from public.watchlists) <> 2 then raise exception 'own insert failed'; end if;
end $$;
update public.watchlists set name = 'renamed' where id = '30000000-0000-0000-0000-00000000000b';
reset role;
do $$ begin
  if (select name from public.watchlists where id = '30000000-0000-0000-0000-00000000000b') <> 'Bob list' then
    raise exception 'alice renamed bob watchlist';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Admin sees operational tables.
-- ---------------------------------------------------------------------------
insert into public.job_runs (job_name, idempotency_key, scheduled_for) values ('test', 'test:1', now());
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ad';
do $$ begin
  if (select count(*) from public.job_runs) <> 1 then raise exception 'admin cannot read job_runs'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. Integrity constraints.
-- ---------------------------------------------------------------------------
do $$ begin
  insert into public.market_prices (stock_id, exchange, "timestamp", open, high, low, close, volume, source)
  values ('20000000-0000-0000-0000-000000000001', 'NSE', '2026-10-23', 104, 108, 103, 107, 1500, 'demo');
  raise exception 'duplicate candle accepted';
exception when unique_violation then null;
end $$;
do $$ begin
  insert into public.market_prices (stock_id, exchange, "timestamp", open, high, low, close, volume, source)
  values ('20000000-0000-0000-0000-000000000001', 'NSE', '2026-10-24', 104, 100, 103, 107, 1500, 'demo');
  raise exception 'invalid OHLC accepted';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.stock_analysis (stock_id, analysis_date, fundamental_score, technical_score, catalyst_score,
    global_alignment_score, valuation_risk_score, total_score, data_coverage, classification, recommendation,
    analysis_json, scoring_version)
  values ('20000000-0000-0000-0000-000000000001', '2026-10-23', 38, 33, 8, 5, 9, 93, 1, 'REJECTED', 'BUY_BREAKOUT', '{}', 't');
  raise exception 'rejected stock accepted with BUY recommendation';
exception when check_violation then null;
end $$;
do $$ begin
  insert into public.stock_analysis (stock_id, analysis_date, fundamental_score, technical_score, catalyst_score,
    global_alignment_score, valuation_risk_score, total_score, data_coverage, classification, recommendation,
    entry_low, entry_high, stop_loss, analysis_json, scoring_version)
  values ('20000000-0000-0000-0000-000000000001', '2026-10-23', 30, 30, 5, 5, 5, 75, 1, 'HIGH_POTENTIAL', 'BUY_BREAKOUT',
    100, 102, 105, '{}', 't');
  raise exception 'stop-loss above entry accepted';
exception when check_violation then null;
end $$;

-- Top-10 view excludes rejected names even with a high score.
insert into public.stock_analysis (stock_id, analysis_date, fundamental_score, technical_score, catalyst_score,
  global_alignment_score, valuation_risk_score, total_score, data_coverage, classification, rejection_reasons, recommendation,
  entry_low, entry_high, stop_loss, target_1, target_2, risk_reward, analysis_json, scoring_version)
values
  ('20000000-0000-0000-0000-000000000001', '2026-10-23', 38, 33, 8, 5, 9, 93, 1, 'REJECTED', '{GOVERNANCE_CONCERN}', 'AVOID', null, null, null, null, null, null, '{}', 'v1'),
  ('20000000-0000-0000-0000-000000000002', '2026-10-23', 30, 28, 6, 4, 7, 75, 1, 'HIGH_POTENTIAL', '{}', 'BUY_BREAKOUT', 100, 102, 96, 108, 112, 2.2, '{}', 'v1');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.v_top_10_opportunities) <> 1 then raise exception 'top10 includes rejected stock'; end if;
  if (select count(*) from public.v_top_3_opportunities) <> 1 then raise exception 'top3 missing qualified stock'; end if;
end $$;
reset role;

-- Recommendation history is permanent.
insert into public.recommendation_history (stock_id, symbol, exchange, recommended_at, recommendation, list_type,
  total_score, reference_price, snapshot, scoring_version)
values ('20000000-0000-0000-0000-000000000002', 'DEMOIND', 'BSE', now(), 'BUY_BREAKOUT', 'TOP_10', 75, 101, '{}', 'v1');
do $$ begin
  update public.recommendation_history set total_score = 99;
  raise exception 'recommendation history was modified';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  delete from public.recommendation_history;
  raise exception 'recommendation history was deleted';
exception when insufficient_privilege then null;
end $$;

-- Notification idempotency: the same key cannot be queued twice.
insert into public.notification_jobs (message_type, recipient_hash, idempotency_key, scheduled_for, payload)
values ('DAILY_CLOSE', 'h', 'DAILY_CLOSE:2026-10-23:h', now(), '{}');
do $$ begin
  insert into public.notification_jobs (message_type, recipient_hash, idempotency_key, scheduled_for, payload)
  values ('DAILY_CLOSE', 'h', 'DAILY_CLOSE:2026-10-23:h', now(), '{}');
  raise exception 'duplicate notification job accepted';
exception when unique_violation then null;
end $$;

-- Every public table has RLS enabled.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if missing is not null then raise exception 'tables without RLS: %', missing; end if;
end $$;

select 'ALL DATABASE TESTS PASSED' as result;
