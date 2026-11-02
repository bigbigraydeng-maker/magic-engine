-- Agent loop baseline (read-only). Design: docs/specs/2026-11-03-me-agent-loop-upgrade-design-v0.md §2
-- Run against the app database (Supabase project glbdnayojixmexgofbsd) with any read-only role.
-- Every statement is a SELECT. Re-run at the end of each phase and compare with the B0 table in the spec.
-- Output is aggregate counts only; do not paste client-level rows into the public repo.

-- M1 + M2: actions per pillar (90d), how many got any outcome row, how many got a decided verdict.
select a.flywheel::text as pillar,
       count(distinct a.id) as actions_90d,
       count(distinct a.id) filter (where o.id is not null) as with_outcome,
       count(distinct a.id) filter (where o.verdict::text in ('confirmed', 'reversed')) as decided
from flywheel_actions a
left join flywheel_outcomes o on o.action_id = a.id
where a.created_at > now() - interval '90 days'
group by 1
order by 2 desc;

-- M1 detail: why outcomes are inconclusive (site-level metric keys are forced to inconclusive).
select coalesce(evaluator_key, '(none)') as evaluator, metric_key, verdict::text as verdict, count(*) as n
from flywheel_outcomes
where created_at > now() - interval '30 days'
group by 1, 2, 3
order by n desc;

-- M5: action naming. Distinct action_type values vs rows, and rows tied to a real executed item.
select flywheel::text as pillar,
       count(*) as rows_90d,
       count(distinct action_type) as distinct_action_types,
       count(*) filter (where action_run_id is not null) as with_kernel_run,
       count(*) filter (where execution_item_id is not null) as with_execution_item,
       count(*) filter (where execution_mode::text = 'external_manual') as external_manual
from flywheel_actions
where created_at > now() - interval '90 days'
group by 1
order by 2 desc;

-- M6: freshness of the learning inputs.
select 'client_learned_preferences_30d' as k, count(*)::text as v from client_learned_preferences where created_at > now() - interval '30 days'
union all select 'prescription_outcomes_last_write', max(created_at)::text from prescription_outcomes
union all select 'social_post_measurement_receipts_last_write', max(created_at)::text from social_post_measurement_receipts
union all select 'social_verification_verdicts_rows', count(*)::text from social_verification_verdicts
union all select 'seo_meta_log_last_change', max(optimised_at)::text from seo_meta_log
union all select 'seo_meta_log_rank_verdicts_90d', count(*) filter (where rank_verdict is not null)::text from seo_meta_log where created_at > now() - interval '90 days'
union all select 'kernel_action_runs_ads_all_time', count(*)::text from action_runs where action_key like 'ads.%'
union all select 'kernel_readback_steps_all_time', count(*)::text from action_run_steps where step_key ilike '%readback%';

-- M7: ads patrol problems that stay flagged day after day (30d). Long runs = loop stalled at a human step.
-- Filter on `date` (rows are overwritten daily, created_at does not move). Several D7 variants share
-- one code and one account unit, so group by title as well.
with p as (
  select s.client_id, s.date, pr->>'code' as code, pr->>'title' as title, u->>'id' as unit_id
  from ads_growth_states s,
       jsonb_array_elements(s.payload->'problems') pr,
       jsonb_array_elements(coalesce(pr->'units', '[]'::jsonb)) u
  where s.date > current_date - 30 and pr->>'status' = 'hit'
), runs as (
  select client_id, code, title, unit_id, count(distinct date) as days_flagged
  from p group by 1, 2, 3, 4
)
select code, left(title, 40) as title, count(*) as problem_units, round(avg(days_flagged), 1) as avg_days_flagged,
       count(*) filter (where days_flagged >= 7) as flagged_7plus_days
from runs
group by 1, 2
order by problem_units desc;
