-- ────────────────────────────────────────────────────────────────────────────
-- 修复 Execution Kernel 两个函数里的裸列名歧义（column reference is ambiguous）
--
-- 🔴 根因：PL/pgSQL 里 `RETURNS TABLE (...)` 声明的每一列，在函数体内都会
--    变成一个同名变量。函数体里如果直接写 `SET some_col = some_col + 1`
--    而没有用表别名/行变量限定左边引用的那个 `some_col` 从哪张表来，
--    Postgres 分不清你说的是「表里那一列」还是「RETURNS TABLE 的那个输出变量」，
--    在默认设置（`plpgsql.variable_conflict = error`，本仓库没有任何 migration
--    改过这个全局设置）下会直接拒绝执行，报
--    `column reference "xxx" is ambiguous`。
--
--    这两处漏了限定符，跟同一个函数里其他地方（都写的是 `v_run.xxx` /
--    `v_step.xxx`）不一致：
--
--    1. kernel_claim_or_takeover_run（20260808000003 第 1192 行）：
--       `reclaim_count = reclaim_count + CASE WHEN v_reclaimed THEN 1 ELSE 0 END`
--       → 这个函数的 RETURNS TABLE 里有 `reclaim_count integer`，
--         跟 action_runs.reclaim_count 撞了名字。
--
--    2. kernel_claim_run_step（20260808000003 第 552 行）：
--       `attempt = attempt + 1`
--       → 这个函数的 RETURNS TABLE 里有 `attempt smallint`，
--         跟 action_run_steps.attempt 撞了名字。
--
--    两个函数只要被真的调用（不是单测里的内存假 Supabase，是真的 Postgres）
--    就必定报错——不是偶发、不是某种边界条件才触发。发现过程：给 PR #1899
--    做端到端验证时，本地起了一次性 Postgres 沙盘把全部 migration 真跑一遍，
--    再用真的 supabase-js 客户端调真实生产代码，第一次真的走到「提交动作 →
--    认领执行权」这一步，才撞见这个报错。
--
--    本 migration 只改这两处引用限定符，不改函数签名、不改任何业务逻辑。
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.kernel_claim_run_step(
  p_worker_id  text,
  p_client_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  ok         boolean,
  step_id    uuid,
  run_id     uuid,
  client_id  uuid,
  step_key   text,
  attempt    smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step RECORD;
BEGIN
  SELECT s.id, s.run_id, s.client_id, s.step_key, s.attempt
    INTO v_step
    FROM public.action_run_steps s
    JOIN public.action_runs r ON r.id = s.run_id
   WHERE s.status = 'pending'
     AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
     -- 🔴 只有已经拿到授权的 run 里的步骤才可被认领。
     --    这是「授权在数据库层也是执行的前置条件」，不只是应用层的一个 if。
     AND r.status IN ('authorized','running')
     AND r.authorization_decision_id IS NOT NULL
     AND (p_client_ids IS NULL OR s.client_id = ANY(p_client_ids))
   ORDER BY s.created_at ASC, s.step_index ASC
   FOR UPDATE OF s SKIP LOCKED
   LIMIT 1;

  IF v_step.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::smallint;
    RETURN;
  END IF;

  -- 🔴 修复：右边的 attempt 必须限定成 v_step.attempt（FOR UPDATE 锁住的那一行的旧值），
  --    否则跟 RETURNS TABLE 的输出变量 attempt 撞名，Postgres 直接报 ambiguous 拒绝执行。
  UPDATE public.action_run_steps
     SET status       = 'claimed',
         claimed_by   = p_worker_id,
         claimed_at   = now(),
         heartbeat_at = now(),
         attempt      = v_step.attempt + 1,
         updated_at   = now()
   WHERE id = v_step.id;

  RETURN QUERY SELECT true, v_step.id, v_step.run_id, v_step.client_id,
                      v_step.step_key, (v_step.attempt + 1)::smallint;
END;
$$;

-- 🔴 SECURITY DEFINER 函数默认把 EXECUTE 授予 anon/authenticated，而 anon key
--    在浏览器 bundle 里 —— 不收口 = 任何人可经 PostgREST 认领执行步骤。
REVOKE EXECUTE ON FUNCTION public.kernel_claim_run_step(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_claim_run_step(text, uuid[]) TO service_role;


CREATE OR REPLACE FUNCTION public.kernel_claim_or_takeover_run(
  p_run_id              uuid,
  p_owner_id            text,
  p_lease_seconds       integer,
  -- 续租 / 再进一次时带上自己那一代。带了就必须对得上（防「旧调用复活」）；
  -- 第一次领取时不知道代际，传 NULL。
  p_expected_generation bigint DEFAULT NULL
)
RETURNS TABLE (
  ok               boolean,
  reason           text,
  run_status       text,
  decision_id      uuid,
  reclaimed        boolean,
  reclaim_count    integer,
  claim_generation bigint,
  reset_steps      boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run        public.action_runs%ROWTYPE;
  v_reclaimed  boolean := false;
  v_prev_owner text;
  v_next_gen   bigint;
  v_was_running boolean := false;
  v_status_out text;
  v_decision_out uuid;
BEGIN
  IF p_owner_id IS NULL OR length(btrim(p_owner_id)) = 0 THEN
    RETURN QUERY SELECT false, 'owner_required', NULL::text, NULL::uuid, false, 0, NULL::bigint, false; RETURN;
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 THEN
    RETURN QUERY SELECT false, 'lease_seconds_required', NULL::text, NULL::uuid, false, 0, NULL::bigint, false; RETURN;
  END IF;

  -- ① 锁住这一行。后面每一句都在这把锁之内。
  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::text, NULL::uuid, false, 0, NULL::bigint, false; RETURN;
  END IF;

  -- ② 状态白名单。
  --    🔴 `running` **也在里面**，但只有租约过期时才轮得到（见 ③）。
  --    早先把 running 一律排除是个更糟的洞：执行者崩在半路，这条 run
  --    就永远停在 running，没有任何人能接手，调用方永远只拿到 in_progress ——
  --    正是租约要修的那个「幂等键把这件事永久锁死」，只是换了个状态待着。
  IF v_run.status NOT IN ('queued','authorizing','authorized','running') THEN
    RETURN QUERY SELECT false, 'not_claimable:' || v_run.status,
                        v_run.status, v_run.authorization_decision_id, false,
                        v_run.reclaim_count, v_run.claim_generation, false;
    RETURN;
  END IF;

  -- ②b 代际 CAS（可选）：带了 expected 就必须还是那一代。
  --     防的是「旧调用复活之后拿着过期的代际来续租」——
  --     它一旦成功就会把租约续到未来，把真正的 owner 挡在门外。
  IF p_expected_generation IS NOT NULL AND v_run.claim_generation <> p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text,
                        v_run.status, v_run.authorization_decision_id, false,
                        v_run.reclaim_count, v_run.claim_generation, false;
    RETURN;
  END IF;

  -- ③ 租约还活着，而且不是自己的 → 抢不走。
  --    这就是「in_progress」唯一有资格出现的场景。
  --    `running` 且租约还活着 → 同样抢不走（真的有人在跑）。
  IF v_run.claimed_by IS NOT NULL
     AND v_run.lease_expires_at IS NOT NULL
     AND v_run.lease_expires_at > now()
     AND v_run.claimed_by <> p_owner_id THEN
    RETURN QUERY SELECT false, 'already_owned:' || v_run.claimed_by,
                        v_run.status, v_run.authorization_decision_id, false,
                        v_run.reclaim_count, v_run.claim_generation, false;
    RETURN;
  END IF;

  -- ③b `running` 的租约必须**真的过期**才能接管。无主的 running（lease 为空）
  --     也算可接管 —— 那是老数据或异常写入，留着同样没人推得动。
  --     但同一个 owner 自己「再进一次」不算接管，直接续租即可。
  v_was_running := (v_run.status = 'running' AND v_run.claimed_by IS DISTINCT FROM p_owner_id);

  -- ④ 无主 / 租约过期 / 自己续租 → 原子写下新 owner。
  --    「从别人手里接走」才算 reclaim，自己续租不算 —— 两者是不同的故障信号。
  v_prev_owner := v_run.claimed_by;
  v_reclaimed  := (v_prev_owner IS NOT NULL AND v_prev_owner <> p_owner_id);

  -- 🔴 代际只在**换人**时 +1。自己续租保持原值 ——
  --    否则续租会把自己手里那一代作废，等于自己把自己 fence 掉。
  v_next_gen := v_run.claim_generation + CASE WHEN v_prev_owner IS DISTINCT FROM p_owner_id THEN 1 ELSE 0 END;

  -- ⑤ 接管一个 running 的 run = 把它放回可重新授权的状态。
  --    授权已经被上一代兑换掉了（append-only，改不了），所以必须重新签一份；
  --    没跑成的步骤放回待跑，**已成功的原样保留、cost_actual_usd 一概不碰**。
  --    这跟 kernel_claim_run_recovery 是同一套语义，只是触发方式不同。
  IF v_was_running THEN
    UPDATE public.action_run_steps
       SET status           = 'pending',
           last_error       = NULL,
           next_attempt_at  = NULL,
           finished_at      = NULL,
           claim_generation = v_next_gen,
           updated_at       = now()
     WHERE run_id = v_run.id
       AND status <> 'succeeded';
  END IF;

  -- 🔴 不管是不是 running，只要换了人就得把**所有**步骤的代际推上去 ——
  --    上一代握着的 step_id 从这一刻起写不进任何一行。
  --    （已成功的步骤也要推，否则旧执行者还能把它改回失败。）
  IF v_next_gen <> v_run.claim_generation THEN
    UPDATE public.action_run_steps
       SET claim_generation = v_next_gen,
           updated_at       = now()
     WHERE run_id = v_run.id;
  END IF;

  v_status_out   := CASE WHEN v_was_running THEN 'queued' ELSE v_run.status END;
  v_decision_out := CASE WHEN v_was_running THEN NULL ELSE v_run.authorization_decision_id END;

  -- 🔴 修复：右边的 reclaim_count 必须限定成 v_run.reclaim_count（① 锁住的那一行的旧值），
  --    否则跟 RETURNS TABLE 的输出变量 reclaim_count 撞名，Postgres 直接报 ambiguous 拒绝执行。
  UPDATE public.action_runs
     SET status              = v_status_out,
         authorization_decision_id = v_decision_out,
         claimed_by          = p_owner_id,
         claimed_at          = now(),
         heartbeat_at        = now(),
         lease_expires_at    = now() + make_interval(secs => p_lease_seconds),
         claim_generation    = v_next_gen,
         previous_claimed_by = CASE WHEN v_reclaimed THEN v_prev_owner ELSE previous_claimed_by END,
         reclaim_count       = v_run.reclaim_count + CASE WHEN v_reclaimed THEN 1 ELSE 0 END,
         last_reclaimed_at   = CASE WHEN v_reclaimed THEN now() ELSE last_reclaimed_at END,
         -- 接管一个 running 的 run 意味着上一次执行没跑完，得让人看得见
         needs_human         = CASE WHEN v_was_running THEN needs_human ELSE needs_human END,
         evidence            = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
           'last_claimed_by', p_owner_id,
           'last_claimed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'last_claim_generation', v_next_gen,
           'last_takeover_from', CASE WHEN v_reclaimed THEN to_jsonb(v_prev_owner) ELSE 'null'::jsonb END,
           'took_over_running', v_was_running
         ),
         updated_at          = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true,
                      CASE WHEN v_reclaimed THEN 'taken_over' ELSE 'claimed' END,
                      v_status_out,
                      v_decision_out,
                      v_reclaimed,
                      v_run.reclaim_count + CASE WHEN v_reclaimed THEN 1 ELSE 0 END,
                      v_next_gen,
                      v_was_running;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_claim_or_takeover_run(uuid, text, integer, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_claim_or_takeover_run(uuid, text, integer, bigint)
  TO service_role;
