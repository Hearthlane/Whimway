-- Monetisation events for the paywall funnel.
begin;
alter table public.events drop constraint if exists events_name_check;
alter table public.events add constraint events_name_check check (name in (
  'onboarding_started','onboarding_completed','onboarding_skipped',
  'plan_requested','plan_generated','plan_failed','plan_viewed',
  'magic_edit_applied','stop_locked','plan_saved','plan_shared',
  'shared_plan_opened','shared_plan_copied',
  'navigation_opened','booking_link_opened',
  'feedback_submitted','app_opened',
  'poll_answered','plan_pulse','stop_reacted',
  'paywall_viewed','plus_started','plus_cancelled'
));
commit;
