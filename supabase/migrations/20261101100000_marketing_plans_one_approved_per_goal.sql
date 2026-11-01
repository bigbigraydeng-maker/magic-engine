-- One approved marketing plan per client + goal.
-- A plan's goal is plan_data.promo.goal_id, or generation_meta.blank_draft.goal_id
-- when the plan has no promo structure (same order as planLinkedGoalId in app code).
-- Plans with no goal are not covered.
--
-- This file only creates the index. It never changes rows. If any client already
-- has two or more approved plans for the same goal, it stops with an error that
-- lists the counts; clean those up by hand (see the PR description), then re-run.
-- Safe to run more than once.

DO $$
DECLARE
  dup_groups integer;
  dup_detail text;
BEGIN
  WITH approved AS (
    SELECT
      client_id,
      COALESCE(
        NULLIF(btrim(plan_data -> 'promo' ->> 'goal_id'), ''),
        NULLIF(btrim(generation_meta -> 'blank_draft' ->> 'goal_id'), '')
      ) AS goal_id
    FROM marketing_plans
    WHERE status = 'approved'
  ),
  dups AS (
    SELECT client_id, goal_id, count(*) AS approved_count
    FROM approved
    WHERE goal_id IS NOT NULL
    GROUP BY client_id, goal_id
    HAVING count(*) > 1
  )
  SELECT
    count(*),
    string_agg(
      'client ' || client_id || ' / goal ' || goal_id || ': ' || approved_count || ' approved plans',
      E'\n' ORDER BY client_id, goal_id
    )
  INTO dup_groups, dup_detail
  FROM dups;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION E'Cannot add one-approved-plan-per-goal index: % client/goal groups have more than one approved plan. No data was changed. Archive the older plans in each group, then re-run this migration.\n%',
      dup_groups, dup_detail;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_plans_one_approved_per_goal
  ON marketing_plans (
    client_id,
    (COALESCE(
      NULLIF(btrim(plan_data -> 'promo' ->> 'goal_id'), ''),
      NULLIF(btrim(generation_meta -> 'blank_draft' ->> 'goal_id'), '')
    ))
  )
  WHERE status = 'approved'
    AND COALESCE(
      NULLIF(btrim(plan_data -> 'promo' ->> 'goal_id'), ''),
      NULLIF(btrim(generation_meta -> 'blank_draft' ->> 'goal_id'), '')
    ) IS NOT NULL;
