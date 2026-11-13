-- Server-side Magic Edit allowance: edits are counted per plan for each account (or install).
begin;

create function public.edits_on_plan(install text, plan uuid) returns integer
language sql stable security definer set search_path='' as $$
  select coalesce((select plans from public.plan_usage
    where identity = public.usage_identity(install) || ':edit:' || plan::text
      and month = to_char(now(), 'YYYY-MM')), 0);
$$;

create function public.count_edit(install text, plan uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare total integer;
begin
  if install !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'Invalid install'; end if;
  insert into public.plan_usage(identity, month, plans)
  values (public.usage_identity(install) || ':edit:' || plan::text, to_char(now(), 'YYYY-MM'), 1)
  on conflict (identity, month) do update set plans = public.plan_usage.plans + 1
  returning plans into total;
  return total;
end;
$$;

-- Identities now carry a plan id for edit counters.
alter table public.plan_usage drop constraint if exists plan_usage_identity_check;
alter table public.plan_usage add constraint plan_usage_identity_check check (char_length(identity) <= 140);

revoke all on function public.edits_on_plan(text, uuid) from public;
revoke all on function public.count_edit(text, uuid) from public;
grant execute on function public.edits_on_plan(text, uuid) to anon, authenticated;
grant execute on function public.count_edit(text, uuid) to anon, authenticated;

commit;
