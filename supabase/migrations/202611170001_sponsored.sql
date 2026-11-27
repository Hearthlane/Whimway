-- Sponsored placements: local businesses pay to be shown, clearly labelled, beside
-- organic recommendations. Campaign tables are closed to clients, and every function
-- below runs only for the service role, so the app's public key cannot read campaign
-- details or record views directly: all access goes through the API server, which counts
-- views and taps once per network per day. Managing campaigns also needs the admin
-- secret, stored hashed in app_secrets:
--   insert into public.app_secrets(name, hash)
--   values ('admin', encode(sha256(convert_to('<your ADMIN_KEY>', 'utf8')), 'hex'));
begin;

create table public.campaigns (
  id uuid primary key,
  business jsonb not null check (jsonb_typeof(business) = 'object' and char_length(business->>'name') between 1 and 120),
  headline text not null check (char_length(headline) between 1 and 80),
  body text not null default '' check (char_length(body) <= 200),
  cta text not null default 'Learn more' check (char_length(cta) between 1 and 30),
  url text not null check (url ~ '^https://' and char_length(url) <= 500),
  area jsonb not null check (jsonb_typeof(area) = 'object'),
  categories text[] not null default '{}' check (cardinality(categories) <= 12),
  surfaces text[] not null default '{home,discover}' check (surfaces <@ array['home','discover','options']::text[] and cardinality(surfaces) >= 1),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  active boolean not null default true,
  impression_cap integer not null default 0 check (impression_cap >= 0),
  updated_at timestamptz not null default now()
);
alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;

-- One row per install per campaign per day per kind: counts people, not refreshes.
create table public.ad_events (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  install text not null check (install ~ '^[A-Za-z0-9-]{8,64}$'),
  kind text not null check (kind in ('impression','click')),
  day date not null default current_date,
  primary key (campaign_id, install, kind, day)
);
create index ad_events_counts on public.ad_events (campaign_id, kind);
alter table public.ad_events enable row level security;
revoke all on public.ad_events from anon, authenticated;

create function public.campaign_json(c public.campaigns) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'id', c.id, 'business', c.business, 'headline', c.headline, 'body', c.body,
    'cta', c.cta, 'url', c.url, 'area', c.area, 'categories', to_jsonb(c.categories),
    'surfaces', to_jsonb(c.surfaces),
    'startsAt', to_char(c.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'endsAt', to_char(c.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'active', c.active, 'impressionCap', c.impression_cap);
$$;

-- Campaigns that could be shown right now (the API filters by place and category).
create function public.active_campaigns() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(public.campaign_json(c)), '[]'::jsonb)
  from public.campaigns c
  where c.active and c.starts_at <= now() and now() < c.ends_at
    and (c.impression_cap = 0 or (select count(*) from public.ad_events e
         where e.campaign_id = c.id and e.kind = 'impression') < c.impression_cap);
$$;

create function public.record_ad_event(campaign uuid, install text, what text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if install !~ '^[A-Za-z0-9-]{8,64}$' or what not in ('impression','click') then
    raise exception 'Invalid event';
  end if;
  insert into public.ad_events(campaign_id, install, kind)
  select campaign, install, what where exists (select 1 from public.campaigns where id = campaign)
  on conflict do nothing;
end;
$$;

create function public.is_admin(admin_secret text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.app_secrets
    where name = 'admin' and hash = encode(sha256(convert_to(coalesce(admin_secret, ''), 'utf8')), 'hex'));
$$;

create function public.admin_save_campaign(admin_secret text, campaign jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.campaigns;
begin
  if not public.is_admin(admin_secret) then raise exception 'Forbidden'; end if;
  insert into public.campaigns(id, business, headline, body, cta, url, area, categories, surfaces,
    starts_at, ends_at, active, impression_cap, updated_at)
  values ((campaign->>'id')::uuid, campaign->'business', campaign->>'headline',
    coalesce(campaign->>'body', ''), coalesce(campaign->>'cta', 'Learn more'), campaign->>'url',
    campaign->'area',
    array(select jsonb_array_elements_text(coalesce(campaign->'categories', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(campaign->'surfaces', '["home","discover"]'::jsonb))),
    (campaign->>'startsAt')::timestamptz, (campaign->>'endsAt')::timestamptz,
    coalesce((campaign->>'active')::boolean, true), coalesce((campaign->>'impressionCap')::integer, 0), now())
  on conflict (id) do update set
    business = excluded.business, headline = excluded.headline, body = excluded.body,
    cta = excluded.cta, url = excluded.url, area = excluded.area, categories = excluded.categories,
    surfaces = excluded.surfaces, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    active = excluded.active, impression_cap = excluded.impression_cap, updated_at = now()
  returning * into saved;
  return public.campaign_json(saved);
end;
$$;

-- Every campaign, including paused, scheduled and ended ones, for the admin.
create function public.admin_list_campaigns(admin_secret text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin(admin_secret) then raise exception 'Forbidden'; end if;
  return coalesce((select jsonb_agg(public.campaign_json(c) order by c.updated_at desc)
    from public.campaigns c), '[]'::jsonb);
end;
$$;

create function public.admin_delete_campaign(admin_secret text, campaign_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin(admin_secret) then raise exception 'Forbidden'; end if;
  delete from public.campaigns where id = campaign_id;
end;
$$;

create function public.campaign_stats(admin_secret text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin(admin_secret) then raise exception 'Forbidden'; end if;
  return coalesce((select jsonb_object_agg(c.id, jsonb_build_object(
      'impressions', (select count(*) from public.ad_events e where e.campaign_id = c.id and e.kind = 'impression'),
      'clicks', (select count(*) from public.ad_events e where e.campaign_id = c.id and e.kind = 'click')))
    from public.campaigns c), '{}'::jsonb);
end;
$$;

revoke all on function public.active_campaigns() from public, anon, authenticated;
revoke all on function public.record_ad_event(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_save_campaign(text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_list_campaigns(text) from public, anon, authenticated;
revoke all on function public.admin_delete_campaign(text, uuid) from public, anon, authenticated;
revoke all on function public.campaign_stats(text) from public, anon, authenticated;
revoke all on function public.is_admin(text) from public, anon, authenticated;
revoke all on function public.campaign_json(public.campaigns) from public, anon, authenticated;
grant execute on function public.active_campaigns() to service_role;
grant execute on function public.record_ad_event(uuid, text, text) to service_role;
grant execute on function public.admin_save_campaign(text, jsonb) to service_role;
grant execute on function public.admin_list_campaigns(text) to service_role;
grant execute on function public.admin_delete_campaign(text, uuid) to service_role;
grant execute on function public.campaign_stats(text) to service_role;
commit;
