-- Verde Dhan — hardening after the Supabase security advisor run.
-- Supabase grants EXECUTE on new functions to anon/authenticated by default,
-- so "revoke from public" alone is not enough.

alter function public.set_updated_at() set search_path = public;
alter function public.prevent_modification() set search_path = public;

-- Trigger-only function: nobody should call it over the API.
revoke all on function public.handle_new_user() from public;

-- Role helpers are used inside RLS policies and by the admin page, so signed-in
-- users keep EXECUTE (they only reveal the caller's own roles). Anonymous
-- callers do not need them.
revoke all on function public.has_role(text) from public;
revoke all on function public.is_admin() from public;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.handle_new_user() from anon, authenticated';
    execute 'revoke all on function public.has_role(text) from anon';
    execute 'revoke all on function public.is_admin() from anon';
    execute 'grant execute on function public.has_role(text) to authenticated';
    execute 'grant execute on function public.is_admin() to authenticated';
    execute 'revoke all on function public.refresh_market_views() from anon, authenticated';
  end if;
end $$;
