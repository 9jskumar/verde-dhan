-- Verde Dhan — foundation: extensions, helper functions, users & access.
-- All objects live in `public` unless noted. Market/reference data is written
-- only by the service role (ingestion workers); private user data is
-- protected by row level security.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Used on append-only audit tables (recommendation history etc.)
create or replace function public.prevent_modification()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only: % is not permitted', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------
-- A. User and access management
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per auth user. Holds no contact data beyond a display name.';

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'analyst', 'member')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id),
  primary key (user_id, role)
);

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  default_exchange text not null default 'NSE' check (default_exchange in ('NSE', 'BSE')),
  risk_per_trade_pct numeric(5, 2) not null default 1.0 check (risk_per_trade_pct > 0 and risk_per_trade_pct <= 10),
  capital_inr numeric(18, 2) check (capital_inr is null or capital_inr > 0),
  updated_at timestamptz not null default now()
);

create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  whatsapp_enabled boolean not null default false,
  -- E.164; stored only once the user has explicitly opted in (see user_consents).
  whatsapp_number text check (whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  timezone text not null default 'Asia/Kolkata',
  global_premarket boolean not null default true,
  india_premarket boolean not null default true,
  daily_close boolean not null default true,
  exceptional_alerts boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now()
);

create table public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_type text not null check (consent_type in ('terms', 'research_disclaimer', 'whatsapp_opt_in', 'data_processing')),
  granted boolean not null,
  version text not null,
  recorded_at timestamptz not null default now()
);
create index user_consents_user_idx on public.user_consents (user_id, consent_type, recorded_at desc);

create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger user_preferences_updated before update on public.user_preferences for each row execute function public.set_updated_at();
create trigger notification_preferences_updated before update on public.notification_preferences for each row execute function public.set_updated_at();

-- Role check usable inside RLS policies. SECURITY DEFINER so it can read
-- user_roles without granting users read access to the whole table.
create or replace function public.has_role(required text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = required
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin');
$$;

-- Create profile + default preference rows on sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'member') on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS — user tables
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.user_consents enable row level security;

create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy user_roles_self_select on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy user_roles_admin_write on public.user_roles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy user_preferences_self on public.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_preferences_self on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Consents are append-only from the user's side: insert + read own.
create policy user_consents_self_select on public.user_consents for select to authenticated using (user_id = auth.uid());
create policy user_consents_self_insert on public.user_consents for insert to authenticated with check (user_id = auth.uid());
