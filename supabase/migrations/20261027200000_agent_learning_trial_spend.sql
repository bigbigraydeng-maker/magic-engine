-- 经验对照试验的每日花费账本（issue #3088 PR-3，A 级）。
--
-- 一张新表 + 两个函数；不改任何已有表，不回填，不碰 global_learned_lessons.is_active。
-- 一天一行（UTC 自然日）：reserved_usd = 已预留未结算，spent_usd = 已结算，comparisons = 对照次数。
-- 预留是单条条件 UPDATE，行锁保证并发 / 多实例下不会超过上限；上限由调用方代码传入（当前 1.00 美元）。
-- RLS：service-role 模板（TO service_role），匿名 / 登录用户读写不了。

CREATE TABLE IF NOT EXISTS agent_learning_trial_spend (
  day          date PRIMARY KEY,
  reserved_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  spent_usd    numeric(12,6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  comparisons  integer       NOT NULL DEFAULT 0 CHECK (comparisons >= 0),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE agent_learning_trial_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full" ON agent_learning_trial_spend;
CREATE POLICY "service_role_full" ON agent_learning_trial_spend
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 预留：已预留 + 已花 + 本次 <= 上限 才放行；放行时 comparisons +1。
-- 返回 {ok:true,claimed:true} 或 {ok:false,reason:'cap_exceeded'}。
CREATE OR REPLACE FUNCTION agent_learning_trial_reserve(p_day date, p_amount numeric, p_cap numeric)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  hit integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_cap IS NULL OR p_cap <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  INSERT INTO agent_learning_trial_spend (day) VALUES (p_day) ON CONFLICT (day) DO NOTHING;

  UPDATE agent_learning_trial_spend
     SET reserved_usd = reserved_usd + p_amount,
         comparisons  = comparisons + 1,
         updated_at   = now()
   WHERE day = p_day
     AND reserved_usd + spent_usd + p_amount <= p_cap;
  GET DIAGNOSTICS hit = ROW_COUNT;

  IF hit = 1 THEN
    RETURN jsonb_build_object('ok', true, 'claimed', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'cap_exceeded');
END;
$$;

-- 结算：释放预留，按实际花费记入 spent_usd。
CREATE OR REPLACE FUNCTION agent_learning_trial_settle(p_day date, p_reserved numeric, p_actual numeric)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  hit integer;
BEGIN
  IF p_reserved IS NULL OR p_reserved < 0 OR p_actual IS NULL OR p_actual < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;

  UPDATE agent_learning_trial_spend
     SET reserved_usd = GREATEST(reserved_usd - p_reserved, 0),
         spent_usd    = spent_usd + p_actual,
         updated_at   = now()
   WHERE day = p_day;
  GET DIAGNOSTICS hit = ROW_COUNT;

  IF hit = 1 THEN
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'unknown_day');
END;
$$;

-- Supabase 的默认授权不经过 PUBLIC，必须 PUBLIC / anon / authenticated 三个一起收。
REVOKE EXECUTE ON FUNCTION agent_learning_trial_reserve(date, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION agent_learning_trial_settle(date, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION agent_learning_trial_reserve(date, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION agent_learning_trial_settle(date, numeric, numeric) TO service_role;
