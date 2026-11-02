-- 社媒读回 WP1 P2：判定表 + Story 防重复唯一索引。
-- 规格：docs/specs/2026-10-29-social-wp1-readback-implementation-brief-v2.md §4 / S2。
--
-- 不要自行 apply。合并后等 PM 回 go apply。本文件不 DELETE、不 UPDATE 任何已有行。
--
-- Story 重复行：建唯一索引之前只数 social.publish_story 里
-- (client_id, payload.idempotency_key) 相同的组。有一组多于一行就报错停下。
-- 不删、不改。整份迁移必须在一个事务里跑（Supabase 默认如此），预检失败会连同新表一起回滚。
-- 防重复键的取值约定是 story-lite:<item_id>（P3 才写入）；索引只认键本身，不解析前缀。

-- ── Story 重复预检（只读）。必须写在唯一索引之前。──────────────────────────
LOCK TABLE public.flywheel_actions IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  duplicate_groups integer;
BEGIN
  SELECT count(*)::integer INTO duplicate_groups
  FROM (
    SELECT 1
    FROM public.flywheel_actions
    WHERE action_type = 'social.publish_story'
      AND payload ->> 'idempotency_key' IS NOT NULL
    GROUP BY client_id, action_type, (payload ->> 'idempotency_key')
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'social.publish_story idempotency duplicates: % group(s). Unique index was not created. No rows were deleted or updated. A person must choose which rows to keep before applying again.',
      duplicate_groups;
  END IF;
END $$;

CREATE TABLE public.social_verification_verdicts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deterministic per judgement attempt: derived from the triggering Inngest event id
  -- (uuid v5 of `<event.id>:<record_type>`). Replays of the same event produce the same id.
  request_id            UUID NOT NULL,
  client_id             UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  record_type           TEXT NOT NULL CHECK (record_type IN
                         ('c1_fidelity','c2_performance','c3_goal_pace','story_dm_count','boost_check')),
  content_action_id     UUID,
  period_key            TEXT,
  -- Hard-coded on purpose: adding a platform (e.g. tiktok) = schema change (A, go apply).
  platform              TEXT NOT NULL CHECK (platform IN ('facebook','instagram')),
  verdict               TEXT NOT NULL,
  read_point            TEXT NOT NULL CHECK (length(read_point) BETWEEN 1 AND 64),
  window_hours          INTEGER CHECK (window_hours IS NULL OR window_hours > 0),
  boost_status          TEXT CHECK (boost_status IS NULL OR boost_status IN ('not_boosted','boosted','boost_unknown')),
  sample_size           INTEGER CHECK (sample_size IS NULL OR sample_size >= 0),
  observed_value        NUMERIC CHECK (observed_value IS NULL OR observed_value >= 0),
  evidence_receipt_ids  UUID[] NOT NULL DEFAULT '{}',
  evidence_verdict_ids  UUID[] NOT NULL DEFAULT '{}',
  cohort_definition     JSONB,
  baseline_value        NUMERIC,
  not_comparable_reasons TEXT[],
  reason                TEXT,
  logic_version         TEXT NOT NULL CHECK (logic_version ~ '^[a-z0-9_.-]{1,40}$'),
  subject_key           TEXT GENERATED ALWAYS AS
                          (COALESCE(content_action_id::text, 'period:' || period_key)) STORED,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT svv_content_client_fk FOREIGN KEY (content_action_id, client_id)
    REFERENCES public.flywheel_actions(id, client_id) ON DELETE RESTRICT,

  CONSTRAINT svv_subject_shape_chk CHECK (
    CASE record_type
      WHEN 'c3_goal_pace' THEN content_action_id IS NULL AND period_key IS NOT NULL
      ELSE content_action_id IS NOT NULL AND period_key IS NULL
    END),

  CONSTRAINT svv_verdict_domain_chk CHECK (
    (record_type = 'c1_fidelity'    AND verdict IN ('match','mismatch')) OR
    (record_type = 'c2_performance' AND verdict IN ('above','within','below','insufficient_sample','not_comparable')) OR
    (record_type = 'c3_goal_pace'   AND verdict IN ('on_track','behind','unreachable_within_quota','insufficient_sample')) OR
    (record_type = 'story_dm_count' AND verdict IN ('counted','not_readable')) OR
    (record_type = 'boost_check'    AND verdict IN ('not_boosted','boosted','boost_unknown'))),

  -- story_dm_count: required = content_action_id, window_hours, read_point;
  -- forbidden = period_key (shape chk), boost_status, sample_size, baseline_value, cohort_definition;
  -- observed_value only when counted; reason only (and required) when not_readable.
  CONSTRAINT svv_story_dm_shape_chk CHECK (
    record_type <> 'story_dm_count' OR (
      window_hours IS NOT NULL AND boost_status IS NULL AND sample_size IS NULL
      AND baseline_value IS NULL AND cohort_definition IS NULL
      AND ( (verdict = 'counted'      AND observed_value IS NOT NULL AND reason IS NULL)
         OR (verdict = 'not_readable' AND observed_value IS NULL     AND reason IS NOT NULL) ))),

  CONSTRAINT svv_boost_shape_chk CHECK (
    record_type <> 'boost_check'
    OR (boost_status = verdict AND observed_value IS NULL
        AND (verdict <> 'boost_unknown' OR reason IS NOT NULL))),

  CONSTRAINT svv_not_comparable_reason_chk CHECK (
    verdict <> 'not_comparable' OR COALESCE(array_length(not_comparable_reasons, 1), 0) > 0)
);

-- (a) Same triggering event replayed → same request_id → 23505 → caller treats as already written.
CREATE UNIQUE INDEX svv_request_uniq ON public.social_verification_verdicts (request_id);
-- (b) Same judgement input, different event (e.g. manual resend) → also blocked: one verdict per
--     (subject, read point, logic version). Re-judging requires a new logic_version.
CREATE UNIQUE INDEX svv_identity_uniq ON public.social_verification_verdicts
  (client_id, record_type, subject_key, read_point, logic_version);
CREATE INDEX svv_client_created_idx ON public.social_verification_verdicts (client_id, created_at DESC);

-- Append-only.
CREATE OR REPLACE FUNCTION public.social_verification_verdicts_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'social_verification_verdicts is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'check_violation';
END; $$;

REVOKE ALL ON FUNCTION public.social_verification_verdicts_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_verification_verdicts_append_only() TO service_role;

CREATE TRIGGER svv_append_only_row BEFORE UPDATE OR DELETE ON public.social_verification_verdicts
  FOR EACH ROW EXECUTE FUNCTION public.social_verification_verdicts_append_only();
CREATE TRIGGER svv_append_only_truncate BEFORE TRUNCATE ON public.social_verification_verdicts
  FOR EACH STATEMENT EXECUTE FUNCTION public.social_verification_verdicts_append_only();

ALTER TABLE public.social_verification_verdicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON public.social_verification_verdicts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.social_verification_verdicts FROM anon, authenticated;

-- 部分索引：只约束 social.publish_story 且带 idempotency_key 的行。
-- 图文发布（social.publish_post）和没有这个键的旧行不受影响。
CREATE UNIQUE INDEX IF NOT EXISTS flywheel_actions_social_publish_story_idempotency
  ON public.flywheel_actions (client_id, action_type, (payload ->> 'idempotency_key'))
  WHERE action_type = 'social.publish_story' AND payload ->> 'idempotency_key' IS NOT NULL;

COMMENT ON TABLE public.social_verification_verdicts IS
  'Append-only social verification verdicts. WP1 P2. Do not update or delete; client removal is a separate authorised procedure.';
