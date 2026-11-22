-- Sponsored campaigns: closed to clients, managed only with the admin secret, and
-- impressions/clicks counted once per person per day.
begin;
create schema if not exists test;
grant usage on schema test to anon,authenticated;
create or replace function test.check(condition boolean,label text) returns void language plpgsql as $$
begin
 if condition is not true then raise exception 'FAILED: %',label; end if;
 raise notice 'PASS: %',label;
end;
$$;
grant execute on function test.check(boolean,text) to anon,authenticated;
insert into public.app_secrets(name, hash) values ('admin', encode(sha256(convert_to('admin-test','utf8')),'hex'));

set role anon;
do $$begin
 begin perform 1 from public.campaigns; raise exception 'campaigns readable';
 exception when insufficient_privilege then perform test.check(true,'clients cannot read the campaigns table'); end;
 begin insert into public.campaigns(id,business,headline,url,area,starts_at,ends_at)
   values (gen_random_uuid(),'{"name":"x"}','x','https://x.test','{}',now(),now()+interval '1 day');
   raise exception 'campaign inserted';
 exception when insufficient_privilege then perform test.check(true,'clients cannot create campaigns directly'); end;
 begin perform 1 from public.ad_events; raise exception 'events readable';
 exception when insufficient_privilege then perform test.check(true,'clients cannot read ad events'); end;
 begin perform public.admin_save_campaign('guess', '{}'::jsonb); raise exception 'wrong admin secret accepted';
 exception when raise_exception then
  if sqlerrm <> 'Forbidden' then raise; end if;
  perform test.check(true,'saving a campaign needs the admin secret'); end;
 begin perform public.campaign_stats('guess'); raise exception 'stats without secret';
 exception when raise_exception then perform test.check(true,'campaign stats need the admin secret'); end;
end$$;

select public.admin_save_campaign('admin-test', jsonb_build_object(
  'id','11111111-1111-4111-8111-111111111111',
  'business', jsonb_build_object('name','Test Tacos','category','mexican restaurant'),
  'headline','Two-for-one tacos', 'url','https://example.com/tacos',
  'area', jsonb_build_object('center', jsonb_build_object('lat',43.651,'lng',-79.3815), 'radius', 3000),
  'categories', jsonb_build_array('mexican'), 'surfaces', jsonb_build_array('home'),
  'startsAt', to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'endsAt', to_char(now() + interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
select test.check(jsonb_array_length(public.active_campaigns()) = 1,'a running campaign is served');
select test.check(public.active_campaigns()->0->>'headline' = 'Two-for-one tacos','served campaigns keep their content');

do $$begin
 begin perform public.admin_save_campaign('admin-test', jsonb_build_object(
   'id','22222222-2222-4222-8222-222222222222','business',jsonb_build_object('name','Bad'),
   'headline','Bad','url','http://insecure.test','area','{}'::jsonb,
   'startsAt','2026-01-01T00:00:00Z','endsAt','2027-01-01T00:00:00Z'));
   raise exception 'http link accepted';
 exception when check_violation then perform test.check(true,'campaign links must use https'); end;
end$$;

select public.record_ad_event('11111111-1111-4111-8111-111111111111','install-0001','impression');
select public.record_ad_event('11111111-1111-4111-8111-111111111111','install-0001','impression');
select public.record_ad_event('11111111-1111-4111-8111-111111111111','install-0002','impression');
select public.record_ad_event('11111111-1111-4111-8111-111111111111','install-0001','click');
select public.record_ad_event('33333333-3333-4333-8333-333333333333','install-0001','click');
select test.check((public.campaign_stats('admin-test')->'11111111-1111-4111-8111-111111111111'->>'impressions')::int = 2,'impressions count each person once a day');
select test.check((public.campaign_stats('admin-test')->'11111111-1111-4111-8111-111111111111'->>'clicks')::int = 1,'clicks are counted');
do $$begin
 begin perform public.record_ad_event('11111111-1111-4111-8111-111111111111','bad id!','impression'); raise exception 'bad install accepted';
 exception when raise_exception then
  if sqlerrm <> 'Invalid event' then raise; end if;
  perform test.check(true,'malformed events are rejected'); end;
end$$;

-- Pausing stops serving; an impression cap is respected.
select public.admin_save_campaign('admin-test', (public.active_campaigns()->0) || '{"impressionCap":2}'::jsonb);
select test.check(jsonb_array_length(public.active_campaigns()) = 0,'a campaign stops serving at its impression cap');
reset role;
update public.campaigns set impression_cap = 0, active = false;
set role anon;
select test.check(jsonb_array_length(public.active_campaigns()) = 0,'a paused campaign is not served');
select public.admin_delete_campaign('admin-test','11111111-1111-4111-8111-111111111111');
reset role;
select test.check((select count(*) = 0 from public.ad_events),'deleting a campaign removes its events');
rollback;
