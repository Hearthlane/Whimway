-- Usage protection counters for the API when it runs as a Supabase Edge Function (no Redis).
-- Only the server (service role) can count; people's devices cannot read or change counters.
create table if not exists public.rate_counters (
  key text primary key,
  n integer not null default 0,
  expires_at timestamptz not null
);
alter table public.rate_counters enable row level security;
revoke all on public.rate_counters from anon, authenticated;

create or replace function public.rate_hit(p_key text, p_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  result integer;
begin
  if length(p_key) > 200 or p_seconds < 1 or p_seconds > 172800 then
    raise exception 'invalid counter';
  end if;
  insert into public.rate_counters as c (key, n, expires_at)
  values (p_key, 1, now() + make_interval(secs => p_seconds))
  on conflict (key) do update
    set n = case when c.expires_at < now() then 1 else c.n + 1 end,
        expires_at = case when c.expires_at < now() then now() + make_interval(secs => p_seconds) else c.expires_at end
  returning n into result;
  -- Light cleanup: now and then, drop counters that have expired.
  if random() < 0.01 then
    delete from public.rate_counters where expires_at < now() - interval '1 hour';
  end if;
  return result;
end;
$$;
revoke all on function public.rate_hit(text, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer) to service_role;
