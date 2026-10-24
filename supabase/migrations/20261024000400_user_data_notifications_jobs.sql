-- Verde Dhan — watchlists, portfolios, alerts (L), notifications (M),
-- scheduled jobs, data quality and audit.

-- ---------------------------------------------------------------------------
-- L. Watchlists and portfolio (private, owner-only)
-- ---------------------------------------------------------------------------
create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  is_private boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.watchlist_stocks (
  watchlist_id uuid not null references public.watchlists (id) on delete cascade,
  stock_id uuid not null references public.stocks (id) on delete cascade,
  added_at timestamptz not null default now(),
  added_price numeric(18, 4),
  notes text check (char_length(notes) <= 1000),
  primary key (watchlist_id, stock_id)
);

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  base_currency text not null default 'INR',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.portfolio_transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  stock_id uuid not null references public.stocks (id) on delete restrict,
  side text not null check (side in ('BUY', 'SELL')),
  quantity numeric(18, 4) not null check (quantity > 0),
  price numeric(18, 4) not null check (price > 0),
  fees numeric(18, 4) not null default 0 check (fees >= 0),
  executed_at timestamptz not null,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);
create index portfolio_transactions_portfolio_idx on public.portfolio_transactions (portfolio_id, executed_at);

-- Derived from transactions by the application (FIFO); stored for fast reads.
create table public.portfolio_holdings (
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  stock_id uuid not null references public.stocks (id) on delete restrict,
  quantity numeric(18, 4) not null check (quantity >= 0),
  average_cost numeric(18, 4) not null,
  realised_pnl numeric(18, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (portfolio_id, stock_id)
);

create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  stock_id uuid not null references public.stocks (id) on delete cascade,
  condition text not null check (condition in ('PRICE_ABOVE', 'PRICE_BELOW', 'PCT_CHANGE_ABOVE', 'PCT_CHANGE_BELOW', 'BREAKOUT_CONFIRMED')),
  threshold numeric(18, 4),
  is_active boolean not null default true,
  triggered_at timestamptz,
  created_at timestamptz not null default now(),
  check (condition = 'BREAKOUT_CONFIRMED' or threshold is not null)
);
create index price_alerts_active_idx on public.price_alerts (stock_id) where is_active;

alter table public.watchlists enable row level security;
alter table public.watchlist_stocks enable row level security;
alter table public.portfolios enable row level security;
alter table public.portfolio_transactions enable row level security;
alter table public.portfolio_holdings enable row level security;
alter table public.price_alerts enable row level security;

create policy watchlists_owner on public.watchlists for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy watchlist_stocks_owner on public.watchlist_stocks for all to authenticated
  using (exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid()))
  with check (exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid()));
create policy portfolios_owner on public.portfolios for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy portfolio_transactions_owner on public.portfolio_transactions for all to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));
create policy portfolio_holdings_owner_read on public.portfolio_holdings for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));
create policy price_alerts_owner on public.price_alerts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- M. Notifications
-- ---------------------------------------------------------------------------
create table public.whatsapp_templates (
  name text primary key,               -- must match the template approved in Meta Business Manager
  language_code text not null default 'en',
  category text not null check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  message_type text not null check (message_type in ('GLOBAL_PREMARKET', 'INDIA_PREMARKET', 'DAILY_CLOSE', 'EXCEPTIONAL_ALERT', 'TEST')),
  body_parameter_count smallint not null default 0,
  meta_status text not null default 'PENDING' check (meta_status in ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED')),
  description text,
  updated_at timestamptz not null default now()
);

insert into public.whatsapp_templates (name, category, message_type, body_parameter_count, description) values
  ('vd_global_premarket', 'UTILITY', 'GLOBAL_PREMARKET', 4, '08:00 IST global pre-market intelligence'),
  ('vd_india_premarket', 'UTILITY', 'INDIA_PREMARKET', 4, '08:30 IST Indian pre-market opportunities'),
  ('vd_daily_close', 'UTILITY', 'DAILY_CLOSE', 5, 'Post-close daily report'),
  ('vd_exceptional_alert', 'UTILITY', 'EXCEPTIONAL_ALERT', 3, 'Threshold-triggered alert');

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  message_type text not null check (message_type in ('GLOBAL_PREMARKET', 'INDIA_PREMARKET', 'DAILY_CLOSE', 'EXCEPTIONAL_ALERT', 'TEST')),
  channel text not null default 'WHATSAPP' check (channel in ('WHATSAPP')),
  -- Recipients are referenced by a hash; the number itself lives only in env
  -- config (primary recipient) or notification_preferences (opted-in users).
  recipient_hash text not null,
  -- Deterministic key, e.g. 'DAILY_CLOSE:2026-10-23:<recipient_hash>'. A
  -- retried scheduler run hits the unique constraint instead of re-sending.
  idempotency_key text not null unique,
  scheduled_for timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED')),
  retry_count smallint not null default 0,
  max_retries smallint not null default 3,
  next_attempt_at timestamptz,
  payload jsonb not null,
  daily_report_id uuid references public.daily_reports (id),
  sent_at timestamptz,
  provider_message_id text unique,
  last_error text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_jobs_due_idx on public.notification_jobs (status, scheduled_for) where status in ('PENDING', 'FAILED');
create trigger notification_jobs_updated before update on public.notification_jobs for each row execute function public.set_updated_at();

create table public.notification_logs (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.notification_jobs (id) on delete cascade,
  attempt smallint not null,
  event text not null check (event in ('ATTEMPT', 'PROVIDER_ACCEPTED', 'PROVIDER_REJECTED', 'NETWORK_ERROR', 'SKIPPED')),
  http_status integer,
  -- Provider response with any phone numbers removed by the application.
  provider_response jsonb,
  created_at timestamptz not null default now()
);
create index notification_logs_job_idx on public.notification_logs (job_id, created_at);

create table public.notification_delivery_status (
  id bigint generated always as identity primary key,
  provider_message_id text not null,
  status text not null check (status in ('sent', 'delivered', 'read', 'failed', 'deleted', 'warning')),
  status_timestamp timestamptz not null,
  error_code text,
  error_title text,
  received_at timestamptz not null default now(),
  unique (provider_message_id, status)
);
create index notification_delivery_status_msg_idx on public.notification_delivery_status (provider_message_id);

-- ---------------------------------------------------------------------------
-- Scheduled jobs, data quality, audit
-- ---------------------------------------------------------------------------
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  idempotency_key text not null unique,  -- '<job>:<window>' e.g. 'daily_ranking:2026-10-23'
  scheduled_for timestamptz not null,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  attempt smallint not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  skip_reason text,
  error text,
  metrics jsonb not null default '{}'::jsonb
);
create index job_runs_name_idx on public.job_runs (job_name, started_at desc);

create table public.data_quality_issues (
  id bigint generated always as identity primary key,
  check_name text not null,
  severity text not null check (severity in ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  entity_type text not null,
  entity_id text,
  details jsonb not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index data_quality_open_idx on public.data_quality_issues (severity, detected_at desc) where resolved_at is null;

create table public.provider_health (
  provider text not null,
  capability text not null,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0,
  circuit_state text not null default 'CLOSED' check (circuit_state in ('CLOSED', 'OPEN', 'HALF_OPEN')),
  last_error text,
  primary key (provider, capability)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users (id),
  action text not null,
  target text,
  details jsonb,
  created_at timestamptz not null default now()
);
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.prevent_modification();

-- Operational tables: admins read, service role writes.
do $$
declare t text;
begin
  foreach t in array array['whatsapp_templates','notification_jobs','notification_logs','notification_delivery_status',
                           'job_runs','data_quality_issues','provider_health','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
  end loop;
end $$;
