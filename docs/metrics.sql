-- Whimway product metrics. Run in the Supabase SQL editor (service role / dashboard).
-- Events are anonymous (random per-install ID), sent only when the user allows usage stats.
-- Explicit reactions (polls, thumbs, plan pulse, feedback) are stored in public.signals.

-- 1. Onboarding completion
select
  count(distinct install_id) filter (where name = 'onboarding_started')   as started,
  count(distinct install_id) filter (where name = 'onboarding_completed') as completed,
  count(distinct install_id) filter (where name = 'onboarding_skipped')   as skipped
from public.events where created_at > now() - interval '30 days';

-- 2. Activation funnel: opened → requested → generated → saved → shared → navigated
select name, count(distinct install_id) as installs
from public.events
where created_at > now() - interval '30 days'
  and name in ('app_opened','plan_requested','plan_generated','plan_saved','plan_shared','navigation_opened','booking_link_opened','feedback_submitted')
group by name order by installs desc;

-- 3. Time to generate a plan (client-measured, ms): median and p90
select
  percentile_cont(0.5) within group (order by (props->>'ms')::int) as p50_ms,
  percentile_cont(0.9) within group (order by (props->>'ms')::int) as p90_ms
from public.events where name = 'plan_generated' and created_at > now() - interval '7 days';

-- 4. The main question: do people actually go, and come back?
--    "Went" rate from post-outing feedback, and repeat planning within 7 / 30 days.
select props->>'went' as went, count(*) from public.events
where name = 'feedback_submitted' group by 1;

with firsts as (
  select install_id, min(created_at) as first_plan
  from public.events where name = 'plan_generated' group by install_id
)
select
  count(*) as cohort,
  count(*) filter (where exists (
    select 1 from public.events e where e.install_id = f.install_id and e.name = 'plan_generated'
      and e.created_at > f.first_plan + interval '12 hours' and e.created_at <= f.first_plan + interval '7 days')) as repeat_7d,
  count(*) filter (where exists (
    select 1 from public.events e where e.install_id = f.install_id and e.name = 'plan_generated'
      and e.created_at > f.first_plan + interval '12 hours' and e.created_at <= f.first_plan + interval '30 days')) as repeat_30d
from firsts f where f.first_plan < now() - interval '30 days';

-- 5. Share loop: recipients opening shared plans per plan shared
select
  count(*) filter (where name = 'plan_shared')        as shared,
  count(*) filter (where name = 'shared_plan_opened') as opened,
  count(*) filter (where name = 'shared_plan_copied') as copied
from public.events where created_at > now() - interval '30 days';

-- 6. WHAT'S FUN (and what isn't): community sentiment by category / type / venue.
--    Same smoothing the planner uses: (up - down) / (n + 8), only with 5+ people.
select key,
  count(*) filter (where value = 1)  as up,
  count(*) filter (where value = -1) as down,
  count(distinct install_id)         as people,
  round(((count(*) filter (where value = 1)) - (count(*) filter (where value = -1)))::numeric
        / (count(*) + 8), 3)         as sentiment
from public.signals
where updated_at > now() - interval '180 days'
group by key having count(distinct install_id) >= 5
order by sentiment desc;   -- flip to ASC for "least fun"

-- 7. Why plans miss: Plan Pulse thumbs-down reasons
select reason, count(distinct install_id) as people
from public.signals where source = 'plan' and value = -1 and reason is not null
group by reason order by people desc;

-- 8. Poll results
select * from jsonb_each(public.poll_tallies());

-- 9. AI + places cost per generated plan
--    Server logs (not the database) carry this: each `plan_generated` log line has
--    {ms, stops, attempts: {google_places, google_routes, openai}, inputTokens, outputTokens}.
--    Query your log drain (e.g. Vercel → Datadog/BigQuery) and multiply by provider prices.
