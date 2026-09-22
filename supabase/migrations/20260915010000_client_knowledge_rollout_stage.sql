-- ============================================================================
-- Client Knowledge Base — step 6/6 (Issue #1648)：阶段切换双签存储层
--
-- `client_knowledge_events`（dimension='phase'）已经在
-- 20260913235959_client_knowledge_facts_v1.sql 建好，故意没给 value 加
-- CHECK enum——本迁移是那条注释说的"后续萃取/审核 issue"，在这里把词表
-- 定下来：'0'（内部整理）/ '1'（客户共测）/ '2'（上线）。
--
-- 阶段前进（0→1、1→2）必须双签（ME + 客户各一个签名）才能写事件；本迁移
-- 只新增"阶段前进"专用的一次性签名链接存储层——跟 issue #1646 的
-- client_knowledge_confirmation_requests 是**同一个模式**（哈希令牌 / 单次
-- 使用 / 只增不改），但不是同一张表：那张表批的是"一批知识事实的客户确认"，
-- 这张表批的是"阶段前进本身"，字段形状完全不同（fromStage/toStage/抽查结
-- 果，不是 fact_fingerprints），硬塞进一张表只会让两种语义互相污染。
--
-- 阶段后退（说错价格 → 退回阶段 1）不需要客户签字（design doc §7.3 "任何
-- 时候发现说错价格 → 一键退回阶段 1"），直接由 ME 侧写一条 client_knowledge_
-- events，不经过这张表——应用层保证 to_stage < 当前阶段。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_knowledge_rollout_advance_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 阶段前进只能是 0→1 或 1→2（design doc §7.3 三段表），一次只走一段。
  from_stage            text NOT NULL CHECK (from_stage IN ('0','1')),
  to_stage              text NOT NULL CHECK (to_stage IN ('1','2')),

  -- 收件人 = 该客户在 client_knowledge_confirmers 登记过的确认人邮箱（跟
  -- issue #1646 用的是同一张登记表，不重复造）。
  confirmer_email       text NOT NULL,
  token_hash            text NOT NULL,

  -- 离开阶段 1（1→2）时必须有抽查结果；0→1 不需要，留空。
  -- {"sampleSize": 30, "priceErrors": 0, "otherAccuracyPct": 95}
  sample_check          jsonb,

  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','confirmed','expired')),
  expires_at            timestamptz NOT NULL,
  confirmed_at          timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by_email      text NOT NULL,

  CONSTRAINT rollout_advance_token_hash_is_sha256_hex CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT rollout_advance_expiry_in_future CHECK (expires_at > created_at),
  CONSTRAINT rollout_advance_confirmed_at_pairing
    CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)),
  -- 阶段号必须真的是"前进一段"，不许跳段（0→2）也不许"前进到同一段"。
  CONSTRAINT rollout_advance_is_one_step_forward
    CHECK (to_stage::int = from_stage::int + 1),
  -- 离开阶段 1 必须带抽查结果；0→1 不需要。
  CONSTRAINT rollout_advance_sample_check_required_leaving_stage_1
    CHECK ((from_stage = '1') = (sample_check IS NOT NULL)),
  -- 职责分离：发起人（ME 签字人）不能同时是客户签字人。
  CONSTRAINT rollout_advance_sender_is_not_confirmer CHECK (
    lower(trim(created_by_email)) <> lower(trim(confirmer_email))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_knowledge_rollout_advance_requests_token
  ON public.client_knowledge_rollout_advance_requests (token_hash);
CREATE INDEX IF NOT EXISTS idx_client_knowledge_rollout_advance_requests_client
  ON public.client_knowledge_rollout_advance_requests (client_id, status, created_at DESC);

ALTER TABLE public.client_knowledge_rollout_advance_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写。
  CREATE POLICY "service_role_full" ON public.client_knowledge_rollout_advance_requests
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 单次使用兜底（照抄 client_knowledge_confirmation_requests_no_terminal_reopen
-- 的写法）：终态一旦写下，任何把它改回 pending 或改动令牌/批次内容的尝试
-- 一律拒绝。
CREATE OR REPLACE FUNCTION public.client_knowledge_rollout_advance_requests_no_terminal_reopen()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'client_knowledge_rollout_advance_requests: request % is already % and cannot change state again',
      OLD.id, OLD.status;
  END IF;
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.confirmer_email IS DISTINCT FROM OLD.confirmer_email
     OR NEW.from_stage IS DISTINCT FROM OLD.from_stage
     OR NEW.to_stage IS DISTINCT FROM OLD.to_stage THEN
    RAISE EXCEPTION
      'client_knowledge_rollout_advance_requests: token/stage/recipient are immutable after the link is issued (id=%)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_knowledge_rollout_advance_requests_no_terminal_reopen_trigger
  ON public.client_knowledge_rollout_advance_requests;
CREATE TRIGGER client_knowledge_rollout_advance_requests_no_terminal_reopen_trigger
  BEFORE UPDATE ON public.client_knowledge_rollout_advance_requests
  FOR EACH ROW EXECUTE FUNCTION public.client_knowledge_rollout_advance_requests_no_terminal_reopen();


-- ────────────────────────────────────────────────────────────────────────────
-- consume_knowledge_rollout_advance_request —— claim 链接 + 写阶段事件，一次事务
--
-- 跟 consume_knowledge_confirmation_request（issue #1646 复审修复）同一个理由：
-- "claim 请求" 和 "写事件" 分成两条 JS 语句，中间任何一次网络抖动都会留下
-- "链接已经用过，但事件没写"的半失败态——而 client_knowledge_events 是
-- append-only 的唯一真相源，一旦这条阶段事件没写上，`getCurrentRolloutStage`
-- 会照旧读到旧阶段，客户以为已经签字生效、系统却还按老阶段走。折进一个
-- Postgres 函数，一次调用 = 一个事务，任何一步失败整体回滚。
--
-- 🔴 子牙 + 魏征联合复审（2026-09-15，均对真实本机 Postgres 复现）：这个函数
-- 原来只检查 `status = 'pending'`，从不重新核对客户"实际当前阶段"是否还等于
-- 这条请求创建时冻死的 `from_stage`。攻击场景：客户在阶段 1 → ME 建一条
-- 1→2 的前进请求 A（此时 from_stage 冻成 '1'）→ 在客户点 A 之前，ME 发现价格
-- 错了，用 `rollbackKnowledgeRolloutStage` 退回阶段 0（那条函数只管
-- `client_knowledge_events`，完全不知道也不查这张表）→ 客户之后才点开 A 这条
-- 仍然"有效、未过期、pending"的链接 → 这个函数照旧把它 claim 掉，写一条
-- value='2' 的阶段事件——回退被一条"过期语义"的链接原样抹掉，客户和 ME 都不
-- 知道。修法：在同一个事务里，claim 之前先用跟 `getCurrentRolloutStage`（TS
-- 侧）完全同一种查法（按 client_knowledge_events.dimension='phase' 取最新一行
-- 的 value，没有行 = '0'）重新算一次"现在真的是第几阶段"，跟这条请求的
-- from_stage 对不上就整体拒绝、不写任何事件——但也不把请求标记成终态，留着
-- pending：如果客户后来真的又被（重新）带回 from_stage（比如先退回、又重新
-- 走一次前进流程回到同一阶段），这条链接语义上仍然对应"从这个阶段前进一
-- 段"，应该允许它继续生效，而不是被这一次的 race 永久烧掉。
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.consume_knowledge_rollout_advance_request(UUID, TIMESTAMPTZ);
CREATE FUNCTION public.consume_knowledge_rollout_advance_request(
  p_request_id      UUID,
  p_confirmed_at    TIMESTAMPTZ
)
RETURNS TABLE (claimed BOOLEAN, event_id UUID, stale BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row           public.client_knowledge_rollout_advance_requests;
  v_actual_stage  TEXT;
  v_event_id      UUID;
BEGIN
  -- 先锁行（不限定 status），这样"读实际阶段 → 判断 → claim"这整段逻辑对
  -- 同一条请求是串行的：另一个并发提交必须等这个事务提交/回滚才能拿到锁，
  -- 不会看到中间态。
  SELECT * INTO v_row
    FROM client_knowledge_rollout_advance_requests
   WHERE id = p_request_id
     FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, FALSE;
    RETURN;
  END IF;

  IF v_row.status <> 'pending' THEN
    -- 已经被别人（或另一个浏览器标签）抢先提交过——跟"阶段被回退"是两种
    -- 不同的拒绝原因，调用方（rollout.ts）要能分辨，所以 stale=FALSE。
    RETURN QUERY SELECT FALSE, NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- 同一事务内重新推导"实际当前阶段"——跟 getCurrentRolloutStage() 完全
  -- 同一种查法：按 created_at 取最新一条 dimension='phase' 的 value，没有
  -- 行就是最低阶段 '0'。
  SELECT value INTO v_actual_stage
    FROM client_knowledge_events
   WHERE client_id = v_row.client_id
     AND dimension = 'phase'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_actual_stage IS NULL THEN
    v_actual_stage := '0';
  END IF;

  IF v_actual_stage <> v_row.from_stage THEN
    -- 客户的实际阶段已经不是这条请求创建时冻死的 from_stage 了（最典型：
    -- 中途被一键回退）。这条链接对现在的状态而言是"过期语义"，拒绝、不
    -- 写任何事件，也不把请求标记成终态——留 pending，让它在阶段真的又回
    -- 到 from_stage 时仍然可能生效。
    RETURN QUERY SELECT FALSE, NULL::UUID, TRUE;
    RETURN;
  END IF;

  UPDATE client_knowledge_rollout_advance_requests
     SET status       = 'confirmed',
         confirmed_at = p_confirmed_at
   WHERE id = p_request_id;

  INSERT INTO client_knowledge_events (client_id, dimension, value, reason, actor_email, payload)
  VALUES (
    v_row.client_id,
    'phase',
    v_row.to_stage,
    'knowledge.rollout.stage_advanced',
    v_row.created_by_email,
    jsonb_build_object(
      'clientId', v_row.client_id,
      'fromStage', v_row.from_stage,
      'toStage', v_row.to_stage,
      'meSignerEmail', v_row.created_by_email,
      'customerSignerEmail', v_row.confirmer_email,
      'sampleCheck', v_row.sample_check,
      'confirmedAt', p_confirmed_at,
      'requestId', v_row.id
    )
  )
  RETURNING id INTO v_event_id;

  RETURN QUERY SELECT TRUE, v_event_id, FALSE;
END;
$$;

COMMENT ON FUNCTION public.consume_knowledge_rollout_advance_request(UUID, TIMESTAMPTZ) IS
  'Issue #1648 — 原子化"claim 阶段前进链接 + 写 client_knowledge_events 阶段事件"。
   两个信号（ME 发起人 created_by_email + 客户签字人 confirmer_email）都已经在
   请求行创建时就必须不同（rollout_advance_sender_is_not_confirmer），这个函数
   只在链接被客户真正点击确认时才会被调用——缺任何一个签名，这条函数永远不会
   跑到 INSERT 那一行。同一事务内还会重新核对客户实际当前阶段是否仍等于这条
   请求冻死的 from_stage——不等（典型原因：中途被一键回退）一律拒绝并
   stale=TRUE，不写事件（2026-09-15 子牙+魏征联合复审修复）。';

-- 🔴 REVOKE 必须显式带 anon/authenticated——Supabase 建库时给 public schema
-- 下的新函数默认授予 anon/authenticated EXECUTE（ALTER DEFAULT PRIVILEGES），
-- 只写 `FROM PUBLIC` 收不掉这两条独立授权（2026-09-03 #1325 的教训）。
REVOKE EXECUTE ON FUNCTION public.consume_knowledge_rollout_advance_request(UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_knowledge_rollout_advance_request(UUID, TIMESTAMPTZ)
  TO service_role;
