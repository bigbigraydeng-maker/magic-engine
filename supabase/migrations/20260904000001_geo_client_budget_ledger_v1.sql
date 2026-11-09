-- ============================================================================
-- Magic Engine 2.0 · GEO 每客户预算账本 + 逐笔原子预留（Issue #1347 · 自动重测预算闸）
--
-- ⚠️ **本文件只提交代码与测试，尚未 apply。** apply 是单独授权的运维动作，
--    绝不夹带进任何 PR（WP00 §9.2 / CLAUDE.md 铁律 2 的不可逆操作例外）。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 为什么必须有这张表 + 这些函数（三审共识）
-- ────────────────────────────────────────────────────────────────────────────
--
-- WP04 的 preflightBudget 只在单次进程内存账工作，两入口并发会双花（魏征上轮复审 #1）。
-- 本层给 GEO 一个**跨进程、原子**的额度来源，是 preflightBudget **之前**那一层
-- （子牙本轮确认：非重复造闸，是互补分层）。
--
-- 两张表：
--   geo_client_budgets      —— 每客户每窗口的聚合账（cap/reserved/spent），用于快速额度判断。
--   geo_budget_reservations —— **逐笔预留身份**。这是本轮三审的必改核心：
--       · 幂等：reserve/settle 带 reservation_id，重复调用是 no-op（Inngest 会重试，魏征实测
--         双 settle 把 spent 灌两遍 0.63→1.26；本设计下第二次 settle 认出已结算，不重复扣）。
--       · 泄漏可回收：预留有逐笔行 + reserved_at + status，进程在 settle 前崩溃留下的孤儿预留
--         可被 geo_expire_stale_reservations 识别并释放（魏征 #2）。
--
-- fail-closed：没有预算行 = 拒绝，不自动建默认额度（PM 没批就不许自动花钱）。
-- 刻意 INVOKER（不写 SECURITY DEFINER），SET search_path 钉死，REVOKE FROM PUBLIC 后单授
-- service_role —— 与同胞 geo_persist_batch_v1 完全一致（house style）。
-- ============================================================================

-- ── 聚合账 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_client_budgets (
  client_id     uuid          NOT NULL,
  period_key    text          NOT NULL,   -- 预算窗口键，形如 '2026-09'（见 geoBudgetPeriodKey，UTC 月）
  cap_usd       numeric(12,4) NOT NULL,   -- PM 授权上限；改额度走单独授权运维动作
  reserved_usd  numeric(12,4) NOT NULL DEFAULT 0,
  spent_usd     numeric(12,4) NOT NULL DEFAULT 0,
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT geo_client_budgets_pk PRIMARY KEY (client_id, period_key),
  -- 🔴 金额列显式挡 NaN/Infinity（同胞 geo_batches 20260811:280-283 的模式；`>=0` 拦不住 NaN，
  --    因 `NaN >= 0` 为 TRUE）。管钱的列必须钉死。
  CONSTRAINT geo_budget_cap_finite      CHECK (cap_usd      >= 0 AND cap_usd      <> 'NaN'::numeric AND cap_usd      < 'Infinity'::numeric),
  CONSTRAINT geo_budget_reserved_finite CHECK (reserved_usd >= 0 AND reserved_usd <> 'NaN'::numeric AND reserved_usd < 'Infinity'::numeric),
  CONSTRAINT geo_budget_spent_finite    CHECK (spent_usd    >= 0 AND spent_usd    <> 'NaN'::numeric AND spent_usd    < 'Infinity'::numeric),
  -- 🔴 reserved + spent 永不超过 cap（数据库层硬约束，防任何路径把账写穿）。
  CONSTRAINT geo_budget_within_cap CHECK (reserved_usd + spent_usd <= cap_usd)
);

ALTER TABLE public.geo_client_budgets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
  CREATE POLICY "service_role_full" ON public.geo_client_budgets
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 逐笔预留 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_budget_reservations (
  reservation_id  text          NOT NULL,   -- 调用方提供（如批次请求 id），幂等键
  client_id       uuid          NOT NULL,
  period_key      text          NOT NULL,
  worst_case_usd  numeric(12,4) NOT NULL,
  status          text          NOT NULL DEFAULT 'reserved',
  charged_usd     numeric(12,4),
  reserved_at     timestamptz   NOT NULL DEFAULT now(),
  settled_at      timestamptz,
  CONSTRAINT geo_budget_reservations_pk PRIMARY KEY (reservation_id),
  CONSTRAINT geo_budget_res_worst_finite CHECK (worst_case_usd > 0 AND worst_case_usd <> 'NaN'::numeric AND worst_case_usd < 'Infinity'::numeric),
  CONSTRAINT geo_budget_res_status CHECK (status IN ('reserved', 'settled', 'expired'))
);
-- 泄漏扫描 / 释放用：按 (client, window, status) 找孤儿预留。
CREATE INDEX IF NOT EXISTS geo_budget_res_scan
  ON public.geo_budget_reservations (client_id, period_key, status, reserved_at);

ALTER TABLE public.geo_budget_reservations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.geo_budget_reservations
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 原子预留（幂等）。返回 jsonb：
--   { reserved: true,  remaining_usd, idempotent?: true }
--   { reserved: false, reason: 'no_budget_row' | 'insufficient' | 'invalid_worst_case', remaining_usd? }
-- 🔴 幂等：同一 reservation_id 再调 = 返回既有状态，不重复累加 reserved。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.geo_reserve_budget_v1(
  p_reservation_id text,
  p_client_id      uuid,
  p_period_key     text,
  p_worst_case_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
-- 🔴 刻意 INVOKER（不写 SECURITY DEFINER）。search_path 钉死。
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.geo_budget_reservations%ROWTYPE;
  v_bud public.geo_client_budgets%ROWTYPE;
  v_remaining numeric;
  v_inserted int;
BEGIN
  IF p_reservation_id IS NULL OR length(p_reservation_id) = 0 THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'invalid_reservation_id');
  END IF;
  -- 🔴 挡 NaN/Infinity/≤0。numeric 的 NaN 排序**最大**，故 `>= 'Infinity'` 同时挡住 NaN 与 Inf
  --    （注意：numeric 里 `NaN <> NaN` 为 FALSE，不能用自不等判 NaN —— 与 IEEE 浮点相反）。
  IF p_worst_case_usd IS NULL OR NOT (p_worst_case_usd > 0)
     OR p_worst_case_usd >= 'Infinity'::numeric THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'invalid_worst_case');
  END IF;

  -- 幂等快路径：顺序重试时，既有预留直接回既有状态，不重复累加。
  SELECT * INTO v_res FROM public.geo_budget_reservations
    WHERE reservation_id = p_reservation_id FOR UPDATE;
  IF FOUND THEN
    -- 🔴 幂等只对**同一身份**成立。同一 reservation_id 换客户/窗口/金额 = 冲突，fail-closed 拒，
    --    绝不把新请求当成既有预留的幂等回放（否则会授权一笔从没预留过的钱，击穿额度 —— Codex P1）。
    IF v_res.client_id <> p_client_id OR v_res.period_key <> p_period_key
       OR v_res.worst_case_usd <> p_worst_case_usd THEN
      RETURN jsonb_build_object('reserved', false, 'reason', 'reservation_mismatch');
    END IF;
    -- 🔴 已结算/已回收的预留**不是**执行授权：再放行下游会重跑付费任务、真钱花两遍而账本只
    --    记一次（Codex P2）。已 settled → already_settled；已 expired → 预留额度早已释放。
    IF v_res.status = 'settled' THEN
      RETURN jsonb_build_object('reserved', false, 'reason', 'already_settled',
                                'charged_usd', v_res.charged_usd);
    END IF;
    IF v_res.status = 'expired' THEN
      RETURN jsonb_build_object('reserved', false, 'reason', 'reservation_expired');
    END IF;
    -- 到这里 status='reserved'：真幂等成功（顺序重试同一次未结算的预留）。
    RETURN jsonb_build_object('reserved', true, 'idempotent', true, 'status', v_res.status);
  END IF;

  -- 锁聚合账，判额度。budget 行锁把同 (client, period) 的并发预留串行化。
  SELECT * INTO v_bud FROM public.geo_client_budgets
    WHERE client_id = p_client_id AND period_key = p_period_key FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'no_budget_row');
  END IF;

  v_remaining := v_bud.cap_usd - v_bud.reserved_usd - v_bud.spent_usd;
  IF v_remaining < p_worst_case_usd THEN
    RETURN jsonb_build_object('reserved', false, 'reason', 'insufficient', 'remaining_usd', v_remaining);
  END IF;

  -- 🔴 用 ON CONFLICT 抢预留身份。并发同 reservation_id 时，快路径可能都没命中（互不可见），
  --    此处只有一个能真正插入；抢不到的**不动预算**、回幂等，绝不 INSERT 撞 PK 抛错（魏征复验必改）。
  INSERT INTO public.geo_budget_reservations (reservation_id, client_id, period_key, worst_case_usd, status)
    VALUES (p_reservation_id, p_client_id, p_period_key, p_worst_case_usd, 'reserved')
    ON CONFLICT (reservation_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    SELECT * INTO v_res FROM public.geo_budget_reservations WHERE reservation_id = p_reservation_id;
    -- 🔴 同上：并发抢不到的这一支也要核身份，冲突 fail-closed（Codex P1）。
    IF v_res.client_id <> p_client_id OR v_res.period_key <> p_period_key
       OR v_res.worst_case_usd <> p_worst_case_usd THEN
      RETURN jsonb_build_object('reserved', false, 'reason', 'reservation_mismatch');
    END IF;
    -- 🔴 已结算/已回收的预留不是执行授权（Codex P2）—— 与快路径一致处理。
    IF v_res.status = 'settled' THEN
      RETURN jsonb_build_object('reserved', false, 'reason', 'already_settled',
                                'charged_usd', v_res.charged_usd);
    END IF;
    IF v_res.status = 'expired' THEN
      RETURN jsonb_build_object('reserved', false, 'reason', 'reservation_expired');
    END IF;
    RETURN jsonb_build_object('reserved', true, 'idempotent', true, 'status', v_res.status);
  END IF;

  -- 只有抢到预留身份的这一支才动预算。
  UPDATE public.geo_client_budgets
    SET reserved_usd = reserved_usd + p_worst_case_usd, updated_at = now()
    WHERE client_id = p_client_id AND period_key = p_period_key;

  RETURN jsonb_build_object('reserved', true, 'remaining_usd', v_remaining - p_worst_case_usd);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 结算（幂等）。把某笔预留从 reserved 挪成 spent。actual 未知传 worst_case（保守）。
--   { settled: true, charged_usd, idempotent?: true }
--   { settled: false, reason: 'no_reservation' | 'invalid_actual' }
-- 🔴 幂等：已 settled 的预留再调 = 返回既有 charged，不重复扣（魏征实测的双灌 bug 根治）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.geo_settle_budget_v1(
  p_reservation_id text,
  p_actual_usd     numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.geo_budget_reservations%ROWTYPE;
  v_charge numeric;
BEGIN
  -- numeric 的 NaN 排序最大，`>= 'Infinity'` 同时挡 NaN 与 Inf；`< 0` 挡负数（NaN<0 为 FALSE，
  -- 故不能只靠 `< 0` 挡 NaN —— 魏征复验实测这道闸原本是死代码，靠 LEAST 侥幸兜住）。
  IF p_actual_usd IS NULL OR p_actual_usd < 0 OR p_actual_usd >= 'Infinity'::numeric THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'invalid_actual');
  END IF;

  SELECT * INTO v_res FROM public.geo_budget_reservations
    WHERE reservation_id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'no_reservation');
  END IF;
  IF v_res.status = 'settled' THEN
    RETURN jsonb_build_object('settled', true, 'idempotent', true, 'charged_usd', v_res.charged_usd);
  END IF;
  IF v_res.status = 'expired' THEN
    -- 已被回收：预留额度早已释放，此时结算无处可扣，如实回不可结算。
    RETURN jsonb_build_object('settled', false, 'reason', 'expired');
  END IF;

  -- 实际花费不采信超过预留上界（provider 成本是输入不是事实）；下界 0。
  v_charge := LEAST(p_actual_usd, v_res.worst_case_usd);

  UPDATE public.geo_client_budgets
    SET reserved_usd = reserved_usd - v_res.worst_case_usd,
        spent_usd    = spent_usd + v_charge,
        updated_at   = now()
    WHERE client_id = v_res.client_id AND period_key = v_res.period_key;
  UPDATE public.geo_budget_reservations
    SET status = 'settled', charged_usd = v_charge, settled_at = now()
    WHERE reservation_id = p_reservation_id;

  RETURN jsonb_build_object('settled', true, 'charged_usd', v_charge);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 回收孤儿预留：把 reserved_at 早于 p_before 的 'reserved' 笔释放（status→expired，
-- 从聚合账 reserved 里减掉）。防进程在 settle 前崩溃导致的额度泄漏（魏征 #2）。
-- 由外部（Inngest 定时/对账）调；本函数只做释放，不猜业务。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.geo_expire_stale_reservations(p_before timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  r public.geo_budget_reservations%ROWTYPE;
  v_count int := 0;
  v_released numeric := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.geo_budget_reservations
      WHERE status = 'reserved' AND reserved_at < p_before FOR UPDATE
  LOOP
    UPDATE public.geo_client_budgets
      SET reserved_usd = reserved_usd - r.worst_case_usd, updated_at = now()
      WHERE client_id = r.client_id AND period_key = r.period_key;
    UPDATE public.geo_budget_reservations
      SET status = 'expired', settled_at = now()
      WHERE reservation_id = r.reservation_id;
    v_count := v_count + 1;
    v_released := v_released + r.worst_case_usd;
  END LOOP;
  RETURN jsonb_build_object('expired_count', v_count, 'released_usd', v_released);
END;
$$;

-- 🔴 EXECUTE 先全撤再单授 —— 不留 PUBLIC 默认可执行（house style + memory
--    feedback-revoke-from-public-not-enough-supabase：anon 是独立授权，必须显式撤）。
REVOKE EXECUTE ON FUNCTION public.geo_reserve_budget_v1(text, uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.geo_settle_budget_v1(text, numeric)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.geo_expire_stale_reservations(timestamptz)       FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.geo_reserve_budget_v1(text, uuid, text, numeric) TO service_role;
GRANT  EXECUTE ON FUNCTION public.geo_settle_budget_v1(text, numeric)              TO service_role;
GRANT  EXECUTE ON FUNCTION public.geo_expire_stale_reservations(timestamptz)       TO service_role;

-- 🔴 不发这一句，PostgREST 的 schema 缓存里没有这些函数，第一次 .rpc() 会拿到
--    「function does not exist」—— 那个报错看起来像「migration 没 apply」，能把人带偏很久。
NOTIFY pgrst, 'reload schema';
