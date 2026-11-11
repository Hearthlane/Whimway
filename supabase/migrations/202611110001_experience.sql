-- Experience companion: product analytics events and post-outing feedback.
begin;

-- Anonymous, allow-listed product events. No prompts, locations, place IDs or free text.
create table public.events (
  id bigint generated always as identity primary key,
  name text not null check (name in (
    'onboarding_started','onboarding_completed','onboarding_skipped',
    'plan_requested','plan_generated','plan_failed','plan_viewed',
    'magic_edit_applied','stop_locked','plan_saved','plan_shared',
    'shared_plan_opened','shared_plan_copied',
    'navigation_opened','booking_link_opened',
    'feedback_submitted','app_opened'
  )),
  -- Random per-install ID generated on device (not a device identifier).
  install_id text not null check (install_id ~ '^[A-Za-z0-9-]{8,64}$'),
  user_id uuid references auth.users(id) on delete set null,
  props jsonb not null default '{}'::jsonb check (jsonb_typeof(props)='object' and octet_length(props::text) < 2048),
  created_at timestamptz not null default now()
);
create index events_name_time on public.events(name, created_at);
create index events_install_time on public.events(install_id, created_at);
alter table public.events enable row level security;
-- No direct table access for clients; writes go through the RPC, reads through the dashboard/service role.
revoke all on public.events from anon, authenticated;

create function public.track_event(event_name text, install text, properties jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.events(name, install_id, user_id, props)
  values (event_name, install, auth.uid(), coalesce(properties, '{}'::jsonb));
end;
$$;
revoke all on function public.track_event(text, text, jsonb) from public;
grant execute on function public.track_event(text, text, jsonb) to anon, authenticated;

-- "Did you go? How was it?" — the core retention signal.
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  went text not null check (went in ('yes','partly','no')),
  rating smallint check (rating between 1 and 5),
  stops jsonb not null default '[]'::jsonb check (jsonb_typeof(stops)='array' and octet_length(stops::text) < 4096),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, plan_id)
);
alter table public.feedback enable row level security;
create policy own_feedback on public.feedback for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.feedback from anon;
grant select, insert, update, delete on public.feedback to authenticated;

-- Room for the taste profile (affinities, skipped places, favourites) alongside web preferences.
alter table public.profiles drop constraint if exists profiles_preferences_check;
alter table public.profiles add constraint profiles_preferences_size
  check (octet_length(preferences::text) < 16384);

commit;
