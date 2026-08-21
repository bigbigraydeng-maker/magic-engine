-- Fix a production PL/pgSQL ambiguity in kernel_claim_or_takeover_run.
--
-- The function returns an output column named reclaim_count. Inside its UPDATE,
-- an unqualified RHS reference to reclaim_count is therefore ambiguous between
-- that output variable and action_runs.reclaim_count. PostgreSQL aborts the
-- transaction before assigning the run lease, leaving new runs stuck queued.
-- Use the already locked v_run row as the unambiguous source of the old count.

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

