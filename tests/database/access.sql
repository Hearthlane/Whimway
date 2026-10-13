begin;
create schema test;
grant usage on schema test to anon,authenticated;
create function test.check(condition boolean,label text) returns void language plpgsql as $$
begin
 if condition is not true then raise exception 'FAILED: %',label; end if;
 raise notice 'PASS: %',label;
end;
$$;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.plans(id,user_id,spec) values ('11111111-1111-4111-8111-111111111111',auth.uid(),'{"title":"A plan"}');
insert into public.profiles(id,preferences) values (auth.uid(),'{"enabled":true}');
select test.check((select count(*)=1 from public.plans),'owner can read own plan');
select test.check((select count(*)=1 from public.profiles),'owner can read own preferences');
insert into public.shares(id,plan_id,user_id,spec) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',auth.uid(),'{"title":"Public snapshot"}');
select test.check((select count(*)=1 from public.shares),'owner can create and read own share');
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select test.check((select count(*)=0 from public.plans),'another user cannot read private plans');
select test.check((select count(*)=0 from public.profiles),'another user cannot read private preferences');
select test.check((select count(*)=0 from public.shares),'another user cannot list another owner shares');
do $$declare changed integer;begin
 update public.plans set spec='{"title":"hijack"}' where id='11111111-1111-4111-8111-111111111111';get diagnostics changed=row_count;perform test.check(changed=0,'another user cannot update a private plan');
 delete from public.plans where id='11111111-1111-4111-8111-111111111111';get diagnostics changed=row_count;perform test.check(changed=0,'another user cannot delete a private plan');
 delete from public.shares where id='22222222-2222-4222-8222-222222222222';get diagnostics changed=row_count;perform test.check(changed=0,'another user cannot revoke an owner share');
 begin
  insert into public.plans(id,user_id,spec) values ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{}');
  raise exception 'forged owner insert unexpectedly succeeded';
 exception when insufficient_privilege then perform test.check(true,'cannot forge ownership on insert');end;
 begin
  insert into public.plans(id,user_id,spec) values ('11111111-1111-4111-8111-111111111111',auth.uid(),'{}') on conflict(id) do update set user_id=excluded.user_id,spec=excluded.spec;
  raise exception 'upsert hijack unexpectedly succeeded';
 exception when insufficient_privilege then perform test.check(true,'upsert cannot hijack another user plan');end;
 begin
  insert into public.shares(plan_id,user_id,spec) values ('11111111-1111-4111-8111-111111111111',auth.uid(),'{}');
  raise exception 'foreign-plan share unexpectedly succeeded';
 exception when insufficient_privilege then perform test.check(true,'cannot publish a share of another user plan');end;
 begin
  insert into public.profiles(id,preferences) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{}') on conflict(id) do update set preferences=excluded.preferences;
  raise exception 'profile hijack unexpectedly succeeded';
 exception when insufficient_privilege then perform test.check(true,'cannot overwrite another user preferences');end;
end;$$;
select test.check(public.read_shared_plan('22222222-2222-4222-8222-222222222222')->>'title'='Public snapshot','authenticated guest can read a token-addressed public copy');
reset role;
set role anon;
set request.jwt.claim.sub='';
select test.check(public.read_shared_plan('22222222-2222-4222-8222-222222222222')->>'title'='Public snapshot','anonymous viewer can read the public copy');
select test.check(public.read_shared_plan('ffffffff-ffff-4fff-8fff-ffffffffffff') is null,'invalid token returns no private data');
do $$begin
 begin perform count(*) from public.plans;raise exception 'anonymous private read succeeded';exception when insufficient_privilege then perform test.check(true,'anonymous table reads are denied');end;
 begin perform count(*) from public.shares;raise exception 'anonymous share listing succeeded';exception when insufficient_privilege then perform test.check(true,'anonymous share listing is denied');end;
 begin insert into public.plans(id,user_id,spec) values('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{}');raise exception 'anonymous write succeeded';exception when insufficient_privilege then perform test.check(true,'anonymous writes are denied');end;
 begin perform public.delete_own_account();raise exception 'anonymous account deletion succeeded';exception when insufficient_privilege then perform test.check(true,'anonymous account deletion is denied');end;
end;$$;
reset role;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.plans set spec='{"title":"Edited A plan"}' where id='11111111-1111-4111-8111-111111111111';
select test.check((select spec->>'title'='Edited A plan' from public.plans where id='11111111-1111-4111-8111-111111111111'),'owner can update the private plan');
select test.check(public.read_shared_plan('22222222-2222-4222-8222-222222222222')->>'title'='Public snapshot','public snapshot is independent of later private edits');
delete from public.shares where id='22222222-2222-4222-8222-222222222222';
select test.check(public.read_shared_plan('22222222-2222-4222-8222-222222222222') is null,'revoked share token stops resolving');
insert into public.shares(id,plan_id,user_id,spec) values('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',auth.uid(),'{}');
delete from public.plans where id='11111111-1111-4111-8111-111111111111';
select test.check(public.read_shared_plan('55555555-5555-4555-8555-555555555555') is null,'plan deletion revokes dependent shares');
-- Recreate A's plan to show that deleting B's account cannot touch it.
insert into public.plans(id,user_id,spec) values('11111111-1111-4111-8111-111111111111',auth.uid(),'{}');
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into public.plans(id,user_id,spec) values('66666666-6666-4666-8666-666666666666',auth.uid(),'{}');
insert into public.profiles(id,preferences) values(auth.uid(),'{}');
insert into public.shares(id,plan_id,user_id,spec) values('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666',auth.uid(),'{}');
select public.delete_own_account();
reset role;
select test.check((select count(*)=0 from auth.users where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'self-deletion removes only the authenticated account');
select test.check((select count(*)=0 from public.plans where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'account deletion removes owned plans');
select test.check((select count(*)=0 from public.profiles where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'account deletion removes owned preferences');
select test.check(public.read_shared_plan('77777777-7777-4777-8777-777777777777') is null,'account deletion revokes owned shares');
select test.check((select count(*)=1 from public.plans where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'another account plans remain intact');
set role authenticated;
set request.jwt.claim.sub='';
do $$begin begin perform public.delete_own_account();raise exception 'empty JWT account deletion succeeded';exception when raise_exception then
 if sqlerrm<>'Authentication required' then raise;end if;perform test.check(true,'authenticated role without a subject cannot delete accounts');end;end;$$;
reset role;
rollback;
