begin;
create table public.plans (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 spec jsonb not null check (jsonb_typeof(spec)='object' and octet_length(spec::text)<32768),
 updated_at timestamptz not null default now()
);
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 preferences jsonb not null default '{}'::jsonb check (octet_length(preferences::text)<8192)
);
create table public.shares (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.plans(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 spec jsonb not null check (jsonb_typeof(spec)='object' and octet_length(spec::text)<32768),
 created_at timestamptz not null default now()
);
create index plans_user on public.plans(user_id);
create index shares_user on public.shares(user_id);
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.shares enable row level security;
create policy own_plans on public.plans for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy own_profile on public.profiles for all to authenticated using (auth.uid()=id) with check (auth.uid()=id);
create policy own_shares on public.shares for all to authenticated using (auth.uid()=user_id) with check (
 auth.uid()=user_id and exists(select 1 from public.plans where plans.id=plan_id and plans.user_id=auth.uid())
);
revoke all on public.plans,public.profiles,public.shares from anon;
grant select,insert,update,delete on public.plans,public.profiles,public.shares to authenticated;
-- No listing endpoint or anonymous table access. Possession of a high-entropy token grants read-only access.
create function public.read_shared_plan(token uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select spec from public.shares where id=token;
$$;
revoke all on function public.read_shared_plan(uuid) from public;
grant execute on function public.read_shared_plan(uuid) to anon,authenticated;
create function public.delete_own_account() returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 delete from auth.users where id=auth.uid();
end;
$$;
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
commit;
