-- Functions that write counters, ratings, poll answers, analytics or entitlements may only be
-- called by the server (service role), which applies usage limits and validation first. With
-- the public key alone, anyone could otherwise call them directly and skip those checks.
-- Read-only aggregates and the token-addressed shared-plan reader stay public by design.
revoke execute on function public.count_plan(text) from public, anon, authenticated;
revoke execute on function public.plans_this_month(text) from public, anon, authenticated;
revoke execute on function public.count_edit(text, uuid) from public, anon, authenticated;
revoke execute on function public.edits_on_plan(text, uuid) from public, anon, authenticated;
revoke execute on function public.record_signals(text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.answer_poll(text, text, text) from public, anon, authenticated;
revoke execute on function public.track_event(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_entitlement(text, uuid, boolean, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.count_plan(text) to service_role;
grant execute on function public.plans_this_month(text) to service_role;
grant execute on function public.count_edit(text, uuid) to service_role;
grant execute on function public.edits_on_plan(text, uuid) to service_role;
grant execute on function public.record_signals(text, text, jsonb, text) to service_role;
grant execute on function public.answer_poll(text, text, text) to service_role;
grant execute on function public.track_event(text, text, jsonb) to service_role;
grant execute on function public.apply_entitlement(text, uuid, boolean, text, timestamptz, text) to service_role;
-- Deleting your own account needs a signed-in user; nobody anonymous can call it.
revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
