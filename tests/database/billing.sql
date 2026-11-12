-- Entitlements and plan usage: only the authenticated billing webhook can grant Plus.
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
insert into public.app_secrets(name, hash) values ('billing_webhook', encode(sha256(convert_to('whsec-test','utf8')),'hex'));

set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$begin
 begin insert into public.entitlements(user_id,active,plan) values (auth.uid(),true,'yearly'); raise exception 'self-grant succeeded';
 exception when insufficient_privilege then perform test.check(true,'a user cannot grant themselves Plus'); end;
 begin perform public.apply_entitlement('guess', auth.uid(), true, 'yearly', null); raise exception 'wrong secret accepted';
 exception when raise_exception then
  if sqlerrm <> 'Not authorised' then raise; end if;
  perform test.check(true,'the entitlement function rejects a wrong secret'); end;
 begin perform 1 from public.app_secrets; raise exception 'secrets readable';
 exception when insufficient_privilege then perform test.check(true,'clients cannot read stored secret hashes'); end;
 begin perform 1 from public.plan_usage; raise exception 'usage readable';
 exception when insufficient_privilege then perform test.check(true,'clients cannot read or edit the usage table'); end;
end$$;
select public.apply_entitlement('whsec-test','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,'yearly',now() + interval '30 days');
select test.check((select active and plan='yearly' from public.entitlements),'the webhook secret grants Plus and the owner can read it');
do $$declare changed integer;begin
 begin update public.entitlements set until = now() + interval '10 years'; get diagnostics changed=row_count;
  if changed > 0 then raise exception 'owner extended own entitlement'; end if;
  perform test.check(true,'an owner cannot extend their own entitlement');
 exception when insufficient_privilege then perform test.check(true,'an owner cannot extend their own entitlement'); end;
end$$;
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select test.check((select count(*)=0 from public.entitlements),'another user cannot see someone else''s entitlement');

-- Usage counts per account when signed in, per install for guests.
select public.count_plan('install-0001');
select public.count_plan('install-0002');
select test.check(public.plans_this_month('install-9999') = 2,'signed-in usage follows the account across installs');
reset role;
set role anon;
set request.jwt.claim.sub='';
select public.count_plan('install-0001');
select test.check(public.plans_this_month('install-0001') = 1,'guest usage is counted per install');
select test.check(public.plans_this_month('install-0002') = 0,'one guest install does not affect another');
do $$begin
 perform public.count_plan('x'); raise exception 'bad install accepted';
exception when raise_exception then
 if sqlerrm <> 'Invalid install' then raise; end if;
 perform test.check(true,'malformed install ids are rejected'); end$$;
reset role;
rollback;
