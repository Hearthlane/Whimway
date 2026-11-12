-- Whimway Plus on the server: entitlements set only by the billing webhook, and a
-- monthly plan counter per account (or per install for guests).
begin;

create table public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null,
  plan text not null check (plan in ('monthly','yearly')),
  until timestamptz,
  source text not null default 'store' check (char_length(source) <= 40),
  updated_at timestamptz not null default now()
);
alter table public.entitlements enable row level security;
-- People can read their own entitlement. Nobody can write it from a client.
create policy own_entitlement on public.entitlements for select to authenticated using (auth.uid() = user_id);
revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;

create table public.plan_usage (
  identity text not null check (char_length(identity) <= 80),
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  plans integer not null default 0,
  primary key (identity, month)
);
alter table public.plan_usage enable row level security;
revoke all on public.plan_usage from anon, authenticated;

-- Server-side secrets, stored as SHA-256 hashes. Set the billing webhook secret once with:
--   insert into public.app_secrets(name, hash)
--   values ('billing_webhook', encode(sha256(convert_to('<your secret>', 'utf8')), 'hex'));
create table public.app_secrets (name text primary key, hash text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

create function public.usage_identity(install text) returns text
language sql stable security definer set search_path='' as $$
  select coalesce('u:' || auth.uid()::text, 'i:' || install);
$$;

-- Plans made this month by the caller (their account if signed in, else their install).
create function public.plans_this_month(install text) returns integer
language sql stable security definer set search_path='' as $$
  select coalesce((select plans from public.plan_usage
    where identity = public.usage_identity(install) and month = to_char(now(), 'YYYY-MM')), 0);
$$;

create function public.count_plan(install text) returns integer
language plpgsql security definer set search_path='' as $$
declare total integer;
begin
  if install !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'Invalid install'; end if;
  insert into public.plan_usage(identity, month, plans)
  values (public.usage_identity(install), to_char(now(), 'YYYY-MM'), 1)
  on conflict (identity, month) do update set plans = public.plan_usage.plans + 1
  returning plans into total;
  return total;
end;
$$;

-- Called by the API after it has authenticated the billing provider's webhook.
create function public.apply_entitlement(secret text, target uuid, is_active boolean, plan_name text, expires timestamptz, src text default 'store')
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.app_secrets
    where name = 'billing_webhook' and hash = encode(sha256(convert_to(secret, 'utf8')), 'hex')) then
    raise exception 'Not authorised';
  end if;
  insert into public.entitlements(user_id, active, plan, until, source, updated_at)
  values (target, is_active, plan_name, expires, src, now())
  on conflict (user_id) do update
    set active = excluded.active, plan = excluded.plan, until = excluded.until, source = excluded.source, updated_at = now();
end;
$$;

revoke all on function public.usage_identity(text) from public;
revoke all on function public.plans_this_month(text) from public;
revoke all on function public.count_plan(text) from public;
revoke all on function public.apply_entitlement(text, uuid, boolean, text, timestamptz, text) from public;
grant execute on function public.plans_this_month(text) to anon, authenticated;
grant execute on function public.count_plan(text) to anon, authenticated;
grant execute on function public.apply_entitlement(text, uuid, boolean, text, timestamptz, text) to anon, authenticated;

commit;
