-- 重大功能上线签字（最小版）—— 只追加的事件表。设计：docs/specs/2026-10-19-launch-signoff-design-v0.2.md
--
-- 🔴 不要自己 apply：PM 另点头。迁移只建表、不写任何数据、不动其它表。
--
-- 设计要点（对应设计稿第 5 节“加固”）：
--   · event_type 与各类型必填字段用 CHECK 约束；
--   · 触发器禁止 UPDATE / DELETE / TRUNCATE（审计记录能被改写 = 没有审计，同 authorization_decisions）；
--   · REVOKE 所有角色的 UPDATE/DELETE/TRUNCATE；
--   · RLS：仓库铁律模板 —— 只放行 service_role，**必须写 TO service_role**（漏写 = 对匿名访客敞开）。

CREATE TABLE IF NOT EXISTS public.launch_signoff_events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feature_key       text        NOT NULL CHECK (length(feature_key) BETWEEN 1 AND 80),
  event_type        text        NOT NULL
                    CHECK (event_type IN ('item_result', 'review', 'halt', 'unlock', 'signature', 'revoke')),
  item_key          text        CHECK (item_key IS NULL OR length(item_key) BETWEEN 1 AND 40),
  status            text        CHECK (status IS NULL OR status IN ('pass', 'fail')),
  evidence_ref      jsonb,
  evidence_snapshot jsonb,
  ref_event_id      bigint      REFERENCES public.launch_signoff_events (id),
  actor             text        NOT NULL CHECK (length(actor) BETWEEN 1 AND 200),
  actor_role        text        NOT NULL CHECK (actor_role IN ('executor', 'reviewer', 'human')),
  commit_sha        text,
  checklist_hash    text        NOT NULL CHECK (length(checklist_hash) = 64),
  note              text        CHECK (note IS NULL OR length(note) <= 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- 每种事件必须带的字段
  CONSTRAINT launch_signoff_item_result_fields CHECK (
    event_type <> 'item_result'
    OR (item_key IS NOT NULL AND status IS NOT NULL AND evidence_ref IS NOT NULL AND evidence_snapshot IS NOT NULL AND commit_sha IS NOT NULL)
  ),
  CONSTRAINT launch_signoff_review_fields CHECK (
    event_type <> 'review'
    OR (item_key IS NOT NULL AND status IS NOT NULL AND ref_event_id IS NOT NULL)
  ),
  CONSTRAINT launch_signoff_halt_unlock_fields CHECK (
    event_type NOT IN ('halt', 'unlock') OR (note IS NOT NULL AND length(btrim(note)) > 0)
  ),
  CONSTRAINT launch_signoff_signature_fields CHECK (
    event_type <> 'signature'
    OR (evidence_snapshot IS NOT NULL AND commit_sha IS NOT NULL AND actor_role = 'human')
  ),
  CONSTRAINT launch_signoff_revoke_fields CHECK (
    event_type <> 'revoke'
    OR (ref_event_id IS NOT NULL AND note IS NOT NULL AND length(btrim(note)) > 0 AND actor_role = 'human')
  )
);

CREATE INDEX IF NOT EXISTS launch_signoff_events_feature_idx
  ON public.launch_signoff_events (feature_key, id);

-- 只追加：UPDATE / DELETE / TRUNCATE 一律报错
CREATE OR REPLACE FUNCTION public.launch_signoff_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'launch_signoff_events is append-only (% not allowed)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS launch_signoff_events_no_update_delete ON public.launch_signoff_events;
CREATE TRIGGER launch_signoff_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.launch_signoff_events
  FOR EACH ROW EXECUTE FUNCTION public.launch_signoff_events_append_only();

DROP TRIGGER IF EXISTS launch_signoff_events_no_truncate ON public.launch_signoff_events;
CREATE TRIGGER launch_signoff_events_no_truncate
  BEFORE TRUNCATE ON public.launch_signoff_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.launch_signoff_events_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON public.launch_signoff_events FROM PUBLIC, anon, authenticated, service_role;

-- RLS：只有服务端（service_role）能读写；**必须带 TO service_role**
ALTER TABLE public.launch_signoff_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS launch_signoff_events_service_role_all ON public.launch_signoff_events;
CREATE POLICY launch_signoff_events_service_role_all
  ON public.launch_signoff_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.launch_signoff_events IS
  '重大功能上线签字事件（只追加）。设计：docs/specs/2026-10-19-launch-signoff-design-v0.2.md';
