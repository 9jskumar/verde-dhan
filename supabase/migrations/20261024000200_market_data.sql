-- Verde Dhan — reference & market data (B, C, F, G, H) plus calendars and
-- data provenance. Written by the ingestion worker (service role) only.

-- ---------------------------------------------------------------------------
-- B. Company identity and exchange listings
-- ---------------------------------------------------------------------------
-- One company, many listings: an NSE and a BSE listing share the same
-- company row (keyed by ISIN), so identity is never duplicated.
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  isin text unique check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  sector text,
  industry text,
  is_financial_sector boolean not null default false,
  market_cap numeric(22, 2),
  market_cap_category text check (market_cap_category in ('LARGE', 'MID', 'SMALL', 'MICRO')),
  market_cap_as_of date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  exchange text not null check (exchange in ('NSE', 'BSE')),
  symbol text not null,
  bse_code text check (bse_code is null or bse_code ~ '^[0-9]{6}$'),
  -- Provider-specific instrument identifiers, e.g. {"upstox": "NSE_EQ|INE002A01018"}
  provider_ids jsonb not null default '{}'::jsonb,
  listing_status text not null default 'ACTIVE' check (listing_status in ('ACTIVE', 'SUSPENDED', 'DELISTED')),
  instrument_type text not null default 'EQ' check (instrument_type in ('EQ', 'BE', 'SM', 'ETF', 'INDEX')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stocks_exchange_symbol_key unique (exchange, symbol)
);
create index stocks_company_idx on public.stocks (company_id);
create unique index stocks_bse_code_key on public.stocks (bse_code) where bse_code is not null;

create trigger companies_updated before update on public.companies for each row execute function public.set_updated_at();
create trigger stocks_updated before update on public.stocks for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Data sources and provenance
-- ---------------------------------------------------------------------------
create table public.data_sources (
  id text primary key,                 -- e.g. 'upstox', 'twelvedata', 'demo'
  display_name text not null,
  category text[] not null,            -- {'india_equities','global_indices',...}
  licence_notes text,
  is_demo boolean not null default false,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);
insert into public.data_sources (id, display_name, category, licence_notes, is_demo, enabled) values
  ('demo', 'Synthetic demo generator', '{india_equities,global_indices,forex,commodities}',
   'Synthetic data for development only. Never shown as real market data.', true, true);

create table public.market_holidays (
  exchange text not null check (exchange in ('NSE', 'BSE', 'NYSE', 'NASDAQ', 'LSE', 'XETRA', 'TSE', 'MCX')),
  holiday_date date not null,
  description text not null,
  session text not null default 'FULL' check (session in ('FULL', 'MUHURAT_ONLY', 'PARTIAL')),
  source text not null,
  primary key (exchange, holiday_date)
);

-- ---------------------------------------------------------------------------
-- C. Market prices (partitioned by year on timestamp)
-- ---------------------------------------------------------------------------
create table public.market_prices (
  id uuid not null default gen_random_uuid(),
  stock_id uuid not null references public.stocks (id) on delete cascade,
  exchange text not null check (exchange in ('NSE', 'BSE')),
  interval text not null default '1d' check (interval in ('1m', '5m', '15m', '1h', '1d', '1w')),
  "timestamp" timestamptz not null,
  open numeric(18, 4) not null check (open > 0),
  high numeric(18, 4) not null check (high > 0),
  low numeric(18, 4) not null check (low > 0),
  close numeric(18, 4) not null check (close > 0),
  adjusted_close numeric(18, 4) check (adjusted_close is null or adjusted_close > 0),
  volume bigint not null check (volume >= 0),
  traded_value numeric(22, 2),
  delivery_quantity bigint,
  delivery_percentage numeric(6, 2) check (delivery_percentage is null or delivery_percentage between 0 and 100),
  is_complete boolean not null default true,
  source text not null references public.data_sources (id),
  data_delay_seconds integer not null default 0 check (data_delay_seconds >= 0),
  created_at timestamptz not null default now(),
  constraint market_prices_ohlc_valid check (high >= low and high >= greatest(open, close) and low <= least(open, close)),
  -- Prevents duplicate candles from retries or overlapping provider pulls.
  constraint market_prices_unique_candle unique (stock_id, exchange, interval, "timestamp"),
  primary key (id, "timestamp")
) partition by range ("timestamp");

do $$
declare y int;
begin
  for y in 2010..2031 loop
    execute format(
      'create table public.market_prices_%s partition of public.market_prices for values from (%L) to (%L)',
      y, make_date(y, 1, 1), make_date(y + 1, 1, 1));
  end loop;
end $$;
create table public.market_prices_default partition of public.market_prices default;

create index market_prices_stock_ts_idx on public.market_prices (stock_id, interval, "timestamp" desc);
create index market_prices_ts_idx on public.market_prices ("timestamp");
create index market_prices_exchange_idx on public.market_prices (exchange, "timestamp" desc);

-- Corporate actions drive adjusted_close; kept for audit and re-adjustment.
create table public.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks (id) on delete cascade,
  action_type text not null check (action_type in ('SPLIT', 'BONUS', 'DIVIDEND', 'RIGHTS', 'BUYBACK', 'MERGER', 'DEMERGER')),
  ex_date date not null,
  ratio_numerator numeric,
  ratio_denominator numeric,
  amount numeric(18, 4),
  source text not null,
  source_url text,
  created_at timestamptz not null default now(),
  unique (stock_id, action_type, ex_date)
);

-- ---------------------------------------------------------------------------
-- F. Global indices
-- ---------------------------------------------------------------------------
create table public.global_instruments (
  symbol text primary key,             -- canonical internal key: SPX, NDX, DJI, FTSE, DAX, N225, NIFTY50, SENSEX
  name text not null,
  country text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  asset_class text not null check (asset_class in ('INDEX', 'FX', 'COMMODITY')),
  -- Provider-specific identifiers. Never assume one vendor's ticker (e.g.
  -- '.INX') works for another.
  provider_ids jsonb not null default '{}'::jsonb,
  unit text,
  is_spot boolean,                     -- commodities: true = spot, false = futures
  exchange_timezone text not null default 'UTC'
);

insert into public.global_instruments (symbol, name, country, currency, asset_class, exchange_timezone) values
  ('NIFTY50', 'NIFTY 50', 'IN', 'INR', 'INDEX', 'Asia/Kolkata'),
  ('SENSEX', 'S&P BSE SENSEX', 'IN', 'INR', 'INDEX', 'Asia/Kolkata'),
  ('SPX', 'S&P 500', 'US', 'USD', 'INDEX', 'America/New_York'),
  ('NDX', 'Nasdaq-100', 'US', 'USD', 'INDEX', 'America/New_York'),
  ('DJI', 'Dow Jones Industrial Average', 'US', 'USD', 'INDEX', 'America/New_York'),
  ('FTSE', 'FTSE 100', 'GB', 'GBP', 'INDEX', 'Europe/London'),
  ('DAX', 'DAX 40', 'DE', 'EUR', 'INDEX', 'Europe/Berlin'),
  ('N225', 'Nikkei 225', 'JP', 'JPY', 'INDEX', 'Asia/Tokyo');

insert into public.global_instruments (symbol, name, country, currency, asset_class, exchange_timezone) values
  ('EURUSD', 'EUR/USD', 'XX', 'USD', 'FX', 'UTC'),
  ('GBPUSD', 'GBP/USD', 'XX', 'USD', 'FX', 'UTC'),
  ('USDJPY', 'USD/JPY', 'XX', 'JPY', 'FX', 'UTC'),
  ('USDINR', 'USD/INR', 'IN', 'INR', 'FX', 'Asia/Kolkata'),
  ('EURINR', 'EUR/INR', 'IN', 'INR', 'FX', 'Asia/Kolkata'),
  ('GBPINR', 'GBP/INR', 'IN', 'INR', 'FX', 'Asia/Kolkata'),
  ('JPYINR', 'JPY/INR', 'IN', 'INR', 'FX', 'Asia/Kolkata');

insert into public.global_instruments (symbol, name, country, currency, asset_class, unit, is_spot) values
  ('BRENT', 'Brent crude', 'XX', 'USD', 'COMMODITY', 'bbl', false),
  ('WTI', 'WTI crude', 'US', 'USD', 'COMMODITY', 'bbl', false),
  ('XAU', 'Gold spot', 'XX', 'USD', 'COMMODITY', 'troy oz', true),
  ('XAG', 'Silver spot', 'XX', 'USD', 'COMMODITY', 'troy oz', true),
  ('NATGAS', 'Natural gas (Henry Hub)', 'US', 'USD', 'COMMODITY', 'MMBtu', false),
  ('COPPER', 'Copper', 'XX', 'USD', 'COMMODITY', 'tonne', false),
  ('ALUMINIUM', 'Aluminium', 'XX', 'USD', 'COMMODITY', 'tonne', false),
  ('ZINC', 'Zinc', 'XX', 'USD', 'COMMODITY', 'tonne', false);

create table public.global_indices (
  id bigint generated always as identity primary key,
  symbol text not null references public.global_instruments (symbol),
  name text not null,
  country text not null,
  currency text not null,
  "timestamp" timestamptz not null,
  last_value numeric(18, 4) not null check (last_value > 0),
  previous_close numeric(18, 4) check (previous_close is null or previous_close > 0),
  absolute_change numeric(18, 4),
  percentage_change numeric(9, 4),
  day_high numeric(18, 4),
  day_low numeric(18, 4),
  market_status text not null check (market_status in ('PRE_OPEN', 'OPEN', 'CLOSED', 'HOLIDAY', 'UNKNOWN')),
  source text not null references public.data_sources (id),
  data_delay_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  unique (symbol, "timestamp", source)
);
create index global_indices_symbol_ts_idx on public.global_indices (symbol, "timestamp" desc);

-- ---------------------------------------------------------------------------
-- G. Forex
-- ---------------------------------------------------------------------------
create table public.forex_prices (
  id bigint generated always as identity primary key,
  pair text not null references public.global_instruments (symbol),
  "timestamp" timestamptz not null,
  bid numeric(18, 8),
  ask numeric(18, 8),
  mid numeric(18, 8) not null check (mid > 0),
  previous_close numeric(18, 8),
  percentage_change numeric(9, 4),
  source text not null references public.data_sources (id),
  data_delay_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  check (bid is null or ask is null or ask >= bid),
  unique (pair, "timestamp", source)
);
create index forex_prices_pair_ts_idx on public.forex_prices (pair, "timestamp" desc);

-- ---------------------------------------------------------------------------
-- H. Commodities
-- ---------------------------------------------------------------------------
create table public.commodity_prices (
  id bigint generated always as identity primary key,
  instrument text not null references public.global_instruments (symbol),
  "timestamp" timestamptz not null,
  price numeric(18, 6) not null check (price > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  unit text not null,
  contract_type text not null check (contract_type in ('SPOT', 'FRONT_MONTH_FUTURE', 'CONTINUOUS_FUTURE')),
  contract_month date,
  percentage_change numeric(9, 4),
  previous_close numeric(18, 6),
  source text not null references public.data_sources (id),
  data_delay_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  check (contract_type = 'SPOT' or contract_month is not null or contract_type = 'CONTINUOUS_FUTURE'),
  unique (instrument, "timestamp", source, contract_type)
);
create index commodity_prices_instr_ts_idx on public.commodity_prices (instrument, "timestamp" desc);

-- ---------------------------------------------------------------------------
-- RLS: market & reference data is readable by signed-in users only (vendor
-- licences generally forbid public redistribution). Writes: service role.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['companies','stocks','data_sources','market_holidays','market_prices',
                           'corporate_actions','global_instruments','global_indices','forex_prices','commodity_prices']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

-- Partitions are reachable by name and RLS on the parent does not cover
-- direct partition access, so lock the partitions down to the service role.
do $$
declare p record;
begin
  for p in select inhrelid::regclass as rel from pg_inherits where inhparent = 'public.market_prices'::regclass loop
    execute format('alter table %s enable row level security', p.rel);
    execute format('revoke all on %s from public', p.rel);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on %s from anon, authenticated', p.rel);
    end if;
  end loop;
end $$;
