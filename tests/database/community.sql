-- Community signals, polls, events and feedback: anonymous writes through functions only,
-- k-anonymous aggregates, no raw-row access for clients.
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

set role anon;
do $$begin
 begin perform 1 from public.signals; raise exception 'anon read signals';
 exception when insufficient_privilege then perform test.check(true,'anonymous clients cannot read raw signals'); end;
 begin perform 1 from public.poll_answers; raise exception 'anon read poll answers';
 exception when insufficient_privilege then perform test.check(true,'anonymous clients cannot read raw poll answers'); end;
 begin perform 1 from public.events; raise exception 'anon read events';
 exception when insufficient_privilege then perform test.check(true,'anonymous clients cannot read raw events'); end;
 begin insert into public.signals(install_id,key,source,value) values ('install-0001','cat:bar','stop',1); raise exception 'anon direct insert';
 exception when insufficient_privilege then perform test.check(true,'signals cannot be written directly, only via the function'); end;
end$$;

-- Four people dislike a venue: below the k-anonymity threshold, so nothing is published.
select public.record_signals('install-000'||n,'stop','[{"key":"place:gta-x","value":-1},{"key":"cat:aquarium","value":-1}]'::jsonb)
  from generate_series(1,4) n;
select test.check(public.crowd_tallies() ? 'place:gta-x' = false,'signals from fewer than five people stay hidden');
-- Re-voting replaces the earlier opinion instead of stacking.
select public.record_signals('install-0001','stop','[{"key":"place:gta-x","value":-1}]'::jsonb);
select public.record_signals('install-0001','stop','[{"key":"place:gta-x","value":-1}]'::jsonb);
select public.record_signals('install-0005','stop','[{"key":"place:gta-x","value":-1}]'::jsonb);
select test.check((public.crowd_tallies()->'place:gta-x'->>'down')::int = 5,'five distinct people publish a tally; repeat votes do not stack');
select test.check(public.crowd_tallies() ? 'cat:aquarium' = false,'each key needs its own five people');

do $$begin
 begin perform public.record_signals('install-0009','stop','[{"key":"drop table signals","value":1}]'::jsonb); raise exception 'bad key accepted';
 exception when check_violation then perform test.check(true,'malformed signal keys are rejected'); end;
 begin perform public.record_signals('install-0009','stop','[{"key":"cat:bar","value":7}]'::jsonb); raise exception 'bad value accepted';
 exception when check_violation then perform test.check(true,'signal values are limited to +1 or -1'); end;
 begin perform public.record_signals('install-0009','stop',(select jsonb_agg(jsonb_build_object('key','cat:k'||g,'value',1)) from generate_series(1,17) g)); raise exception 'oversized batch accepted';
 exception when raise_exception then
  if sqlerrm <> 'Invalid signals' then raise; end if;
  perform test.check(true,'signal batches are capped at 16 entries'); end;
 begin perform public.track_event('keylogger','install-0001','{}'::jsonb); raise exception 'unknown event accepted';
 exception when check_violation then perform test.check(true,'only allow-listed analytics events are stored'); end;
end$$;
select public.track_event('poll_answered','install-0001','{"poll":"date-idea"}'::jsonb);
select test.check(true,'allow-listed new events (poll_answered) are accepted');

select public.answer_poll('date-idea','install-0001','a');
select public.answer_poll('date-idea','install-0002','b');
select test.check(public.answer_poll('date-idea','install-0001','b') = '{"a":0,"b":2}'::jsonb,'poll re-votes replace the earlier answer');
select test.check(public.poll_tallies()->'date-idea' = '{"a":0,"b":2}'::jsonb,'poll tallies expose only counts');

-- Feedback is private to its owner.
reset role;
set role authenticated;
set request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.feedback(user_id,plan_id,went,rating) values (auth.uid(),'11111111-1111-4111-8111-111111111111','yes',5);
select test.check((select count(*)=1 from public.feedback),'owner can read own feedback');
set request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select test.check((select count(*)=0 from public.feedback),'another user cannot read private feedback');
do $$begin
 insert into public.feedback(user_id,plan_id,went) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','no');
 raise exception 'forged feedback accepted';
exception when insufficient_privilege then perform test.check(true,'feedback ownership cannot be forged'); end$$;
reset role;
rollback;
