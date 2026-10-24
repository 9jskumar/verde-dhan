-- Verde Dhan — fundamentals, technicals, news, announcements, AI analysis,
-- recommendation history and performance tracking (D, E, I, J, K, N).

-- ---------------------------------------------------------------------------
-- D. Fundamental data
-- ---------------------------------------------------------------------------
-- Statements belong to the company (not a listing). Consolidated and
-- standalone figures are separate rows and are never mixed in calculations.
create table public.financial_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  reporting_basis text not null check (reporting_basis in ('consolidated', 'standalone')),
  period_type text not null check (period_type in ('annual', 'quarterly')),
  financial_year text not null check (financial_year ~ '^FY[0-9]{4}$'),
  quarter smallint check (quarter between 1 and 4),
  reporting_period text not null,        -- 'FY2026' or 'FY2026-Q2'
  period_end date not null,
  currency text not null default 'INR',
  unit text not null default 'crore' check (unit in ('crore', 'lakh', 'absolute', 'million')),
  revenue numeric(22, 4),
  ebitda numeric(22, 4),
  ebit numeric(22, 4),
  pat numeric(22, 4),
  eps numeric(14, 4),
  interest_expense numeric(22, 4),
  total_assets numeric(22, 4),
  current_liabilities numeric(22, 4),
  total_debt numeric(22, 4),
  cash_and_equivalents numeric(22, 4),
  equity numeric(22, 4),
  operating_cash_flow numeric(22, 4),
  capex numeric(22, 4),
  free_cash_flow numeric(22, 4),
  shares_outstanding numeric(22, 4),
  is_audited boolean,
  source text not null,
  source_url text,
  reported_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((period_type = 'annual' and quarter is null) or (period_type = 'quarterly' and quarter is not null)),
  unique (company_id, reporting_basis, period_type, reporting_period)
);
create index financial_statements_company_idx on public.financial_statements (company_id, reporting_basis, period_end desc);

create table public.shareholding_patterns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  quarter_end date not null,
  promoter_holding numeric(6, 2) check (promoter_holding between 0 and 100),
  promoter_pledge numeric(6, 2) check (promoter_pledge between 0 and 100),
  fii_holding numeric(6, 2) check (fii_holding between 0 and 100),
  dii_holding numeric(6, 2) check (dii_holding between 0 and 100),
  public_holding numeric(6, 2) check (public_holding between 0 and 100),
  source text not null,
  source_url text,
  unique (company_id, quarter_end)
);

create table public.fundamental_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  reporting_basis text not null check (reporting_basis in ('consolidated', 'standalone')),
  period_type text not null check (period_type in ('annual', 'quarterly')),
  latest_period text not null,
  revenue_growth numeric(12, 4),
  revenue_cagr_3y numeric(12, 4),
  revenue_cagr_5y numeric(12, 4),
  ebitda_growth numeric(12, 4),
  pat_growth numeric(12, 4),
  pat_cagr_3y numeric(12, 4),
  eps_growth numeric(12, 4),
  ebitda_margin numeric(12, 4),
  roe numeric(12, 4),
  roce numeric(12, 4),
  debt_equity numeric(12, 4),
  interest_coverage numeric(12, 4),
  pe numeric(12, 4),
  peg numeric(12, 4),
  pb numeric(12, 4),
  ev_ebitda numeric(12, 4),
  cfo_pat_ratio numeric(12, 4),
  promoter_holding numeric(6, 2),
  promoter_pledge numeric(6, 2),
  fii_holding numeric(6, 2),
  dii_holding numeric(6, 2),
  calculation_version text not null,
  calculation_date timestamptz not null default now(),
  unique (company_id, reporting_basis, period_type, latest_period, calculation_version)
);
create index fundamental_metrics_company_idx on public.fundamental_metrics (company_id, calculation_date desc);

-- ---------------------------------------------------------------------------
-- E. Technical indicators (daily, completed bars only)
-- ---------------------------------------------------------------------------
create table public.technical_indicators (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks (id) on delete cascade,
  "timestamp" timestamptz not null,
  close numeric(18, 4) not null,
  sma_5 numeric(18, 4), sma_10 numeric(18, 4), sma_20 numeric(18, 4), sma_50 numeric(18, 4),
  sma_100 numeric(18, 4), sma_200 numeric(18, 4), ema_20 numeric(18, 4), ema_50 numeric(18, 4),
  rsi_14 numeric(8, 4) check (rsi_14 is null or rsi_14 between 0 and 100),
  macd numeric(18, 6), macd_signal numeric(18, 6), macd_histogram numeric(18, 6),
  adx_14 numeric(8, 4), atr_14 numeric(18, 4),
  bollinger_upper numeric(18, 4), bollinger_middle numeric(18, 4), bollinger_lower numeric(18, 4),
  vwap numeric(18, 4),
  average_volume_20d numeric(22, 2),
  average_traded_value_20d numeric(22, 2),
  relative_volume numeric(10, 4),
  relative_strength numeric(10, 6),
  support_level numeric(18, 4),
  resistance_level numeric(18, 4),
  breakout_level numeric(18, 4),
  breakout_stage text check (breakout_stage in ('CONFIRMED', 'RETEST', 'EARLY', 'FAILED', 'NONE')),
  breakout_evidence jsonb,
  calculation_version text not null,
  created_at timestamptz not null default now(),
  unique (stock_id, "timestamp", calculation_version)
);
create index technical_indicators_stock_ts_idx on public.technical_indicators (stock_id, "timestamp" desc);
create index technical_indicators_stage_idx on public.technical_indicators (breakout_stage, "timestamp" desc) where breakout_stage in ('CONFIRMED', 'RETEST', 'EARLY');

-- ---------------------------------------------------------------------------
-- I. News
-- ---------------------------------------------------------------------------
create table public.market_news (
  id uuid primary key default gen_random_uuid(),
  headline text not null,
  summary text,
  full_source_url text not null,
  canonical_url text not null,
  content_fingerprint text not null,   -- sha256 of normalised headline + publisher
  publisher text not null,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  sentiment text check (sentiment in ('VERY_POSITIVE', 'POSITIVE', 'NEUTRAL', 'NEGATIVE', 'VERY_NEGATIVE')),
  importance smallint check (importance between 1 and 5),
  country text,
  sector text,
  related_stock_ids uuid[] not null default '{}',
  event_type text,
  verified boolean not null default false,
  source_type text not null check (source_type in ('PUBLISHER_API', 'RSS', 'EXCHANGE_FILING', 'REGULATOR', 'MANUAL')),
  source text not null,
  constraint market_news_canonical_url_key unique (canonical_url),
  constraint market_news_fingerprint_key unique (content_fingerprint)
);
create index market_news_published_idx on public.market_news (published_at desc);
create index market_news_related_idx on public.market_news using gin (related_stock_ids);

-- ---------------------------------------------------------------------------
-- J. Corporate announcements
-- ---------------------------------------------------------------------------
create table public.corporate_announcements (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks (id) on delete cascade,
  exchange text not null check (exchange in ('NSE', 'BSE')),
  announcement_type text not null,
  headline text not null,
  description text,
  announcement_url text not null,
  announcement_timestamp timestamptz not null,
  verification_status text not null default 'UNVERIFIED' check (verification_status in ('UNVERIFIED', 'VERIFIED', 'DISPUTED')),
  is_governance_concern boolean not null default false,
  source text not null,
  created_at timestamptz not null default now(),
  unique (exchange, announcement_url)
);
create index corporate_announcements_stock_idx on public.corporate_announcements (stock_id, announcement_timestamp desc);

-- ---------------------------------------------------------------------------
-- Sector & global impact
-- ---------------------------------------------------------------------------
create table public.global_market_impact_rules (
  id text primary key,
  global_instrument text not null references public.global_instruments (symbol),
  movement_type text not null check (movement_type in ('UP', 'DOWN')),
  threshold_pct numeric(8, 4) not null check (threshold_pct > 0),
  affected_sector text not null,
  impact_direction text not null check (impact_direction in ('POSITIVE', 'NEGATIVE')),
  impact_mechanism text not null,
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  applicable_conditions text,
  source_references text[] not null default '{}',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.global_impact_snapshots (
  id uuid primary key default gen_random_uuid(),
  computed_at timestamptz not null default now(),
  sentiment text not null,
  sentiment_score numeric(8, 4),
  result jsonb not null,
  ai_interpretation jsonb,
  inputs jsonb not null
);
create index global_impact_snapshots_ts_idx on public.global_impact_snapshots (computed_at desc);

-- ---------------------------------------------------------------------------
-- K. AI analysis (scores are deterministic; AI adds narrative)
-- ---------------------------------------------------------------------------
create table public.stock_analysis (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks (id) on delete cascade,
  analysis_date date not null,
  fundamental_score numeric(6, 2) not null check (fundamental_score between 0 and 40),
  technical_score numeric(6, 2) not null check (technical_score between 0 and 35),
  catalyst_score numeric(6, 2) not null check (catalyst_score between 0 and 9),
  global_alignment_score numeric(6, 2) not null check (global_alignment_score between 0 and 6),
  valuation_risk_score numeric(6, 2) not null check (valuation_risk_score between 0 and 10),
  total_score numeric(6, 2) not null check (total_score between 0 and 100),
  data_coverage numeric(5, 3) not null,
  classification text not null check (classification in ('EXCEPTIONAL', 'HIGH_POTENTIAL', 'QUALIFIED', 'WATCHLIST', 'DO_NOT_RECOMMEND', 'REJECTED')),
  rejection_reasons text[] not null default '{}',
  recommendation text not null check (recommendation in ('BUY_BREAKOUT', 'BUY_ON_BREAKOUT', 'BUY_ON_RETEST', 'WATCH', 'AVOID')),
  entry_low numeric(18, 4),
  entry_high numeric(18, 4),
  stop_loss numeric(18, 4),
  target_1 numeric(18, 4),
  target_2 numeric(18, 4),
  target_3 numeric(18, 4),
  risk_reward numeric(8, 2),
  investment_horizon text,
  confidence_level text check (confidence_level in ('LOW', 'MEDIUM', 'HIGH')),
  analysis_json jsonb not null,        -- evidence: score components, breakout criteria, AI narrative
  source_references text[] not null default '{}',
  scoring_version text not null,
  model_version text,                  -- null when no AI narrative was produced
  prompt_version text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  -- Trade levels must be internally consistent when present.
  check (stop_loss is null or entry_low is null or stop_loss < entry_low),
  check (entry_low is null or entry_high is null or entry_low <= entry_high),
  check (target_1 is null or entry_high is null or target_1 > entry_high),
  check (target_2 is null or target_1 is null or target_2 >= target_1),
  check (target_3 is null or target_2 is null or target_3 >= target_2),
  -- A rejected stock can never carry a buy recommendation.
  check (classification <> 'REJECTED' or recommendation = 'AVOID'),
  unique (stock_id, analysis_date, scoring_version)
);
create index stock_analysis_date_score_idx on public.stock_analysis (analysis_date desc, total_score desc);

create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('GLOBAL_PREMARKET', 'INDIA_PREMARKET', 'DAILY_CLOSE', 'EXCEPTIONAL_ALERT')),
  report_date date not null,
  content jsonb not null,
  rendered_text text,
  model_version text,
  prompt_version text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (report_type, report_date, is_demo)
);

-- ---------------------------------------------------------------------------
-- N. Performance tracking — original recommendations are permanent.
-- ---------------------------------------------------------------------------
create table public.recommendation_history (
  id uuid primary key default gen_random_uuid(),
  stock_analysis_id uuid references public.stock_analysis (id) on delete set null,
  stock_id uuid not null references public.stocks (id) on delete restrict,
  symbol text not null,
  exchange text not null,
  recommended_at timestamptz not null,
  recommendation text not null,
  list_type text not null check (list_type in ('TOP_10', 'TOP_3', 'BREAKOUT_ALERT')),
  rank smallint,
  total_score numeric(6, 2) not null,
  reference_price numeric(18, 4) not null,
  entry_low numeric(18, 4),
  entry_high numeric(18, 4),
  stop_loss numeric(18, 4),
  target_1 numeric(18, 4),
  target_2 numeric(18, 4),
  target_3 numeric(18, 4),
  investment_horizon text,
  market_regime text,
  snapshot jsonb not null,
  scoring_version text not null,
  model_version text,
  is_demo boolean not null default false,
  unique (stock_id, recommended_at, list_type)
);
create trigger recommendation_history_immutable
  before update or delete on public.recommendation_history
  for each row execute function public.prevent_modification();

create table public.recommendation_price_history (
  recommendation_id uuid not null references public.recommendation_history (id),
  trade_date date not null,
  close numeric(18, 4) not null,
  high numeric(18, 4) not null,
  low numeric(18, 4) not null,
  primary key (recommendation_id, trade_date)
);

create table public.recommendation_outcomes (
  recommendation_id uuid primary key references public.recommendation_history (id),
  status text not null check (status in ('OPEN', 'ENTRY_NOT_TRIGGERED', 'TARGET_1_HIT', 'TARGET_2_HIT', 'TARGET_3_HIT', 'STOPPED_OUT', 'EXPIRED')),
  entry_triggered_at date,
  exit_at date,
  exit_price numeric(18, 4),
  return_pct numeric(10, 4),
  max_favourable_excursion_pct numeric(10, 4),
  max_adverse_excursion_pct numeric(10, 4),
  holding_days integer,
  evaluated_at timestamptz not null default now()
);

create table public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  strategy text not null,
  parameters jsonb not null,
  universe text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  code_version text not null,
  data_source text not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.backtest_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.backtest_runs (id) on delete cascade,
  metric text not null,
  segment text not null default 'ALL',  -- e.g. sector or market regime
  value numeric not null,
  details jsonb,
  unique (run_id, metric, segment)
);

-- ---------------------------------------------------------------------------
-- RLS: research outputs readable by signed-in users; writes via service role.
-- Backtests are visible to analysts/admins only.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['financial_statements','shareholding_patterns','fundamental_metrics','technical_indicators',
                           'market_news','corporate_announcements','global_market_impact_rules','global_impact_snapshots',
                           'stock_analysis','daily_reports','recommendation_history','recommendation_price_history',
                           'recommendation_outcomes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

alter table public.backtest_runs enable row level security;
alter table public.backtest_results enable row level security;
create policy backtest_runs_staff on public.backtest_runs for select to authenticated using (public.has_role('analyst') or public.is_admin());
create policy backtest_results_staff on public.backtest_results for select to authenticated using (public.has_role('analyst') or public.is_admin());
create policy impact_rules_admin_write on public.global_market_impact_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());
