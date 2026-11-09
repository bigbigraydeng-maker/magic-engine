-- Facebook 帖子 T+N 表现回收：测量回执表 + 业务身份唯一约束 + 客户归属组合外键
--
-- 为什么要新表：现有三张 flywheel 表都表达不了「读不到」。
--   · flywheel_metrics.metric_value 是 NOT NULL —— 无法测量没法写行；
--   · flywheel_outcomes 是归因结论，本期不写，冒充它会污染归因语义；
--   · 把回执塞进 flywheel_actions.payload 需要 read-modify-write，
--     T+4 与 T+72 两个独立 run 并发时会互相覆盖。
--
-- 所以只加这一张最小表，只装完成 Act→Check 所需字段。不存 token、不存完整响应。
--
-- 可重复执行：全部 IF NOT EXISTS / EXCEPTION WHEN duplicate_object / DO $$。

-- ── flywheel_actions：补 (id, client_id) 唯一键，为回执的组合外键铺路 ─────────
--
-- P4：光有两个独立外键（receipts.client_id → clients，receipts.action_id →
-- flywheel_actions）挡不住「B 客户的回执挂到 A 客户的 action」—— 消费者用
-- service role，RLS 不会替我们补隔离。要把「回执必须与其 action 属于同一客户」
-- 提升成数据库层的硬约束，只能靠组合外键指向一个能唯一确定这条 action 的键。
-- 因此先在 flywheel_actions 上加 (id, client_id) 的 UNIQUE。id 已是主键，加这个
-- UNIQUE 只多存一个索引条目，不改语义、对既有数据零影响。
DO $$ BEGIN
  ALTER TABLE public.flywheel_actions
    ADD CONSTRAINT flywheel_actions_id_client_uniq UNIQUE (id, client_id);
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN duplicate_table  THEN NULL; END $$;

-- ── social_post_measurement_receipts ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.social_post_measurement_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL,
  -- 发布动作行。回执与它一一对应，单帖查询从这里进。
  action_id       UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  post_id         TEXT NOT NULL,
  page_id         TEXT NOT NULL,
  -- 这次测量对应事件里的哪个窗口（4 / 72 …）。窗口值来自事件，不是常量。
  window_hours    INTEGER NOT NULL CHECK (window_hours > 0),
  -- 事件约定的应测时刻 vs 实际读到的时刻。迟测不算错，但要看得见。
  target_at       TIMESTAMPTZ NOT NULL,
  measured_at     TIMESTAMPTZ,
  status          TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'unmeasurable')),
  -- 明确读到的数字，例如 {"likes": 12, "comments": 3, "shares": 1}
  values          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 没读到的字段及保守原因，例如 {"shares": "omitted_unverified"}
  missing         JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason          TEXT,
  graph_code      INTEGER,
  graph_subcode   INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 🔴 P4：组合外键。回执的 client_id 必须与其 action 所属客户一致，否则数据库
  -- 直接拒绝写入。不需要触发器，也不需要应用代码自觉。
  CONSTRAINT social_post_measurement_receipts_action_client_fk
    FOREIGN KEY (action_id, client_id)
    REFERENCES public.flywheel_actions(id, client_id) ON DELETE CASCADE,
  CONSTRAINT social_post_measurement_receipts_client_fk
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE
);

-- 业务身份：一个动作的一个窗口只有一条回执。重跑同窗口更新同一行，不新增第二行。
CREATE UNIQUE INDEX IF NOT EXISTS social_post_measurement_receipts_identity
  ON public.social_post_measurement_receipts (action_id, window_hours);

CREATE INDEX IF NOT EXISTS social_post_measurement_receipts_client
  ON public.social_post_measurement_receipts (client_id, created_at DESC);

ALTER TABLE public.social_post_measurement_receipts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
  CREATE POLICY "service_role_full" ON public.social_post_measurement_receipts
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 业务身份唯一约束：并发只能靠数据库挡，不能靠「先查询再插入」 ──────────────

-- 发布动作：同一客户、同一动作类型、同一 idempotency_key 只有一行。
-- 部分索引 —— 只约束本功能写的行（带 idempotency_key 的），对既有 social.publish_post
-- 行（Publer 路径，payload 里没有这个键）零影响。
CREATE UNIQUE INDEX IF NOT EXISTS flywheel_actions_social_publish_idempotency
  ON public.flywheel_actions (client_id, action_type, (payload ->> 'idempotency_key'))
  WHERE action_type = 'social.publish_post'
    AND payload ->> 'idempotency_key' IS NOT NULL;

-- 测量数字：同一客户、同一指标、同一帖子、同一窗口只有一行。
-- 重跑复用原行，不产生重复数字。
CREATE UNIQUE INDEX IF NOT EXISTS flywheel_metrics_post_measurement_identity
  ON public.flywheel_metrics (
    client_id,
    metric_key,
    (source_ref ->> 'idempotency_key'),
    (source_ref ->> 'window_hours')
  )
  WHERE source_ref ->> 'idempotency_key' IS NOT NULL
    AND source_ref ->> 'window_hours' IS NOT NULL;

-- ── P3：原子快照 RPC ──────────────────────────────────────────────────────────
--
-- 一次测量 = 一个不可分割的快照。之前的实现「先写回执、再逐条写指标」在中途失败
-- 重跑时会用变化后的 Graph 数字覆盖回执，产生 receipt.likes=12 / metric.likes=10
-- 这样的自相矛盾。改用 RPC，回执与全部指标在同一事务里一次提交，要么全成、要么
-- 全不生效。
--
-- 幂等：`snapshot_hash` 由消费者按 (window_hours, values 序列化) 算出；同一
-- action_id + window_hours 已存在时，只有 hash 相同才更新，不同则拒绝——绝不让
-- 变化后的数字覆盖既有快照，也绝不让 ok/partial 被后续 unmeasurable 覆盖。
CREATE OR REPLACE FUNCTION public.record_post_measurement_snapshot(
  p_client_id       UUID,
  p_action_id       UUID,
  p_idempotency_key TEXT,
  p_post_id         TEXT,
  p_page_id         TEXT,
  p_window_hours    INTEGER,
  p_target_at       TIMESTAMPTZ,
  p_measured_at     TIMESTAMPTZ,
  p_status          TEXT,
  p_values          JSONB,
  p_missing         JSONB,
  p_snapshot_hash   TEXT,
  p_reason          TEXT DEFAULT NULL,
  p_graph_code      INTEGER DEFAULT NULL,
  p_graph_subcode   INTEGER DEFAULT NULL
) RETURNS TABLE (receipt_id UUID, outcome TEXT) AS $fn$
DECLARE
  v_receipt_id      UUID;
  v_existing_status TEXT;
  v_existing_hash   TEXT;
  v_key             TEXT;
  v_lock_key        BIGINT;
BEGIN
  -- 🔴 P3 修补：首次并发写入的竞态。
  --
  -- 两个并发首调（都还没写过任一行）时，`SELECT ... FOR UPDATE` 锁不到任何行 ——
  -- 两个 session 都会通过 hash mismatch 检查（都读到 NULL），随后 A INSERT 一份
  -- 完整快照（hash_A），B 撞 receipt 唯一约束 → `ON CONFLICT DO UPDATE` 把 receipt
  -- 覆盖成 hash_B；B 的指标撞既有唯一索引被跳过。结果：receipt=hash_B，
  -- metrics=hash_A —— 两套数字。
  --
  -- 解法：在读之前对 (action_id, window_hours) 拿一把事务级 advisory lock，把同
  -- (action, window) 的所有 RPC 调用串行化。用 int8 版本的 pg_advisory_xact_lock，
  -- 把两个 uuid 各折成 int8：uuid 的前 8 字节。事务结束自动释放。
  --
  -- 事故复现的双连接并发测试见本 migration 附带的 db-verify 脚本（P3-concurrent）。
  -- 把 (action_id, window_hours) 折成一个 int8：md5(拼接) 的前 16 hex → bit(64) → bigint
  v_lock_key := ('x' || substr(md5(p_action_id::text || ':' || p_window_hours::text), 1, 16))
                ::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- 拿到 advisory 锁后再读 —— 此刻并发的另一个 session 要么已完成整段事务并提交
  -- （我们会读到它的 receipt），要么还没进来（我们成为首调者）。
  SELECT r.id, r.status, r.missing ->> '__snapshot_hash'
    INTO v_receipt_id, v_existing_status, v_existing_hash
    FROM public.social_post_measurement_receipts r
   WHERE r.action_id = p_action_id AND r.window_hours = p_window_hours
   FOR UPDATE;

  IF v_receipt_id IS NOT NULL THEN
    -- 🔴 P3 铁律 1：ok/partial 不能被 unmeasurable 覆盖降级。原样返回旧回执，
    --    不 UPDATE、不写指标。
    IF v_existing_status IN ('ok', 'partial') AND p_status = 'unmeasurable' THEN
      receipt_id := v_receipt_id;
      outcome    := 'kept_success';
      RETURN NEXT;
      RETURN;
    END IF;

    -- 🔴 P3 铁律 2：ok/partial 快照 hash 不同的写入一律拒 —— 变化的 Graph 数字
    --    绝不能污染原快照。同 hash 的重放走下面的 upsert 分支（自然幂等）。
    IF v_existing_status IN ('ok', 'partial') AND p_status IN ('ok', 'partial')
       AND v_existing_hash IS NOT NULL AND v_existing_hash <> p_snapshot_hash THEN
      RAISE EXCEPTION 'snapshot_hash_mismatch existing=% incoming=%',
        v_existing_hash, p_snapshot_hash
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- upsert 回执：snapshot_hash 藏进 missing 里，无需加列 —— 少一次 migration。
  INSERT INTO public.social_post_measurement_receipts (
    client_id, action_id, idempotency_key, post_id, page_id,
    window_hours, target_at, measured_at, status, values, missing,
    reason, graph_code, graph_subcode
  ) VALUES (
    p_client_id, p_action_id, p_idempotency_key, p_post_id, p_page_id,
    p_window_hours, p_target_at, p_measured_at, p_status, p_values,
    p_missing || jsonb_build_object('__snapshot_hash', p_snapshot_hash),
    p_reason, p_graph_code, p_graph_subcode
  )
  ON CONFLICT (action_id, window_hours) DO UPDATE SET
    measured_at   = EXCLUDED.measured_at,
    status        = EXCLUDED.status,
    values        = EXCLUDED.values,
    missing       = EXCLUDED.missing,
    reason        = EXCLUDED.reason,
    graph_code    = EXCLUDED.graph_code,
    graph_subcode = EXCLUDED.graph_subcode,
    updated_at    = now()
  RETURNING id INTO v_receipt_id;

  -- 只有 ok / partial 才写数字。用「先查再插」而不是 ON CONFLICT —— 部分唯一索引
  -- 带 WHERE，ON CONFLICT 无法匹配它；同一事务里的先查后插仍是原子的（同一 RPC
  -- 里一次提交，外部看不到中间态）。
  IF p_status IN ('ok', 'partial') THEN
    FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.flywheel_metrics m
         WHERE m.client_id = p_client_id
           AND m.metric_key = 'social.post.' || v_key
           AND m.source_ref ->> 'idempotency_key' = p_idempotency_key
           AND m.source_ref ->> 'window_hours'    = p_window_hours::TEXT
      ) THEN
        INSERT INTO public.flywheel_metrics (
          client_id, flywheel, metric_key, metric_value, source, source_ref, measured_at
        ) VALUES (
          p_client_id, 'social', 'social.post.' || v_key,
          (p_values ->> v_key)::NUMERIC, 'meta_graph',
          jsonb_build_object(
            'action_id',       p_action_id,
            'idempotency_key', p_idempotency_key,
            'post_id',         p_post_id,
            'page_id',         p_page_id,
            'window_hours',    p_window_hours,
            'target_at',       p_target_at,
            'receipt_id',      v_receipt_id,
            'snapshot_hash',   p_snapshot_hash
          ),
          p_measured_at
        );
      END IF;
    END LOOP;
  END IF;

  receipt_id := v_receipt_id;
  outcome    := 'written';
  RETURN NEXT;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- 🔴 db-invariants 不变量 4：SECURITY DEFINER 以定义者身份执行完全绕过 RLS，
--    仅 REVOKE FROM PUBLIC 在 Supabase 上收不干净 —— anon/authenticated 由
--    ALTER DEFAULT PRIVILEGES 独立授权。必须显式 FROM PUBLIC, anon, authenticated。
--    2026-09-03 事故：20260815000001 就是漏了这一条，被库层 CI 抓住。
REVOKE ALL ON FUNCTION public.record_post_measurement_snapshot(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, JSONB, JSONB, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_post_measurement_snapshot(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, JSONB, JSONB, TEXT, TEXT, INTEGER, INTEGER
) TO service_role;
