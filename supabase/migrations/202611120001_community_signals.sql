-- Community signals: polls, reactions and ratings from every user, aggregated
-- anonymously to learn what's fun (and what isn't) and re-rank recommendations.
begin;

-- One opinion per install per key per source: the latest reaction wins (no vote stuffing).
create table public.signals (
  install_id text not null check (install_id ~ '^[A-Za-z0-9-]{8,64}$'),
  key text not null check (key ~ '^(cat|type|place):[A-Za-z0-9_ &.''-]{1,120}$'),
  source text not null check (source in ('stop','plan','feedback','poll')),
  value smallint not null check (value in (-1, 1)),
  reason text check (reason in ('too_pricey','too_far','not_my_vibe','wrong_time','seen_it')),
  user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (install_id, key, source)
);
create index signals_key on public.signals(key);
alter table public.signals enable row level security;
revoke all on public.signals from anon, authenticated;

create table public.poll_answers (
  poll_id text not null check (poll_id ~ '^[a-z0-9-]{1,40}$'),
  install_id text not null check (install_id ~ '^[A-Za-z0-9-]{8,64}$'),
  choice text not null check (choice in ('a','b')),
  updated_at timestamptz not null default now(),
  primary key (poll_id, install_id)
);
alter table public.poll_answers enable row level security;
revoke all on public.poll_answers from anon, authenticated;

-- Writes go through these functions only; at most 16 entries per call.
create function public.record_signals(install text, src text, entries jsonb, why text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) > 16 then
    raise exception 'Invalid signals';
  end if;
  insert into public.signals(install_id, key, source, value, reason, user_id, updated_at)
  select install, e->>'key', src, (e->>'value')::smallint, why, auth.uid(), now()
  from jsonb_array_elements(entries) e
  on conflict (install_id, key, source)
  do update set value = excluded.value, reason = excluded.reason, updated_at = now();
end;
$$;

create function public.answer_poll(poll text, install text, pick text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  insert into public.poll_answers(poll_id, install_id, choice) values (poll, install, pick)
  on conflict (poll_id, install_id) do update set choice = excluded.choice, updated_at = now();
  select jsonb_build_object('a', count(*) filter (where choice='a'), 'b', count(*) filter (where choice='b'))
    into result from public.poll_answers where poll_id = poll;
  return result;
end;
$$;

-- Aggregates only, k-anonymous: a key appears once at least 5 distinct installs reacted.
create function public.crowd_tallies()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(key, jsonb_build_object('up', up, 'down', down)), '{}'::jsonb)
  from (
    select key, count(*) filter (where value = 1) up, count(*) filter (where value = -1) down
    from public.signals
    where updated_at > now() - interval '180 days'
    group by key
    having count(distinct install_id) >= 5
  ) t;
$$;

create function public.poll_tallies()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(poll_id, jsonb_build_object('a', a, 'b', b)), '{}'::jsonb)
  from (
    select poll_id, count(*) filter (where choice='a') a, count(*) filter (where choice='b') b
    from public.poll_answers group by poll_id
  ) t;
$$;

revoke all on function public.record_signals(text, text, jsonb, text) from public;
revoke all on function public.answer_poll(text, text, text) from public;
revoke all on function public.crowd_tallies() from public;
revoke all on function public.poll_tallies() from public;
grant execute on function public.record_signals(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.answer_poll(text, text, text) to anon, authenticated;
grant execute on function public.crowd_tallies() to anon, authenticated;
grant execute on function public.poll_tallies() to anon, authenticated;

-- New product events.
alter table public.events drop constraint if exists events_name_check;
alter table public.events add constraint events_name_check check (name in (
  'onboarding_started','onboarding_completed','onboarding_skipped',
  'plan_requested','plan_generated','plan_failed','plan_viewed',
  'magic_edit_applied','stop_locked','plan_saved','plan_shared',
  'shared_plan_opened','shared_plan_copied',
  'navigation_opened','booking_link_opened',
  'feedback_submitted','app_opened',
  'poll_answered','plan_pulse','stop_reacted'
));

commit;
