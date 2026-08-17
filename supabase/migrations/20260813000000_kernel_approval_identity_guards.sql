-- ============================================================================
-- Magic Engine 2.0 · 人工批准失败落地的决策指针 CAS（K-WP01A · PR #962 复审整改）
--
-- 🔴 已合并进 main 的历史迁移一律不可变 —— 直接改写
--    `20260808000003_me2_execution_kernel_v1.sql` 只对「从未 apply 过」的环境生效，
--    已 apply 过的环境仍然停在旧函数上，永远拿不到新行为。所以走前向迁移。
--
-- 改的是什么
--   `kernel_record_fenced_deny` 原来只有两道闸：代际（fencing）和状态
--   （`p_expected_status`，人工批准失败落地传 'pending_approval'）。
--   两道都挡不住这一种：**审批人点同意之后、preflight 还在读政策的那段时间里，
--   这条 run 被重新排了一次，挂上了另一份待审批请求**。状态仍是 pending_approval，
--   于是那次迟到的「批不了」会把新请求直接盖成 denied —— 而正在看新请求的人
--   什么都不知道。
--
--   新增第六个参数 `p_expected_decision_id`（DEFAULT NULL）+ 锁内 CAS，
--   判据跟 `kernel_resolve_pending_approval` 第 ③ 步逐字一致。
--   传 NULL = 跳过（自动授权路径没有「审批人看到的那份」这个概念）。
--
-- 🔴 **为什么是新名字 `_v2`，而不是给老函数加一个带默认值的第六参。**（Build Control Room blocker ①）
--
--    加默认参数那条路有两个都会咬人的问题：
--      · 加了之后旧的五参版本**不会**被替换掉，两个重载并存，五参形式的调用
--        从此有歧义（PostgREST 报 "Could not choose the best candidate function"）；
--      · 为了消歧义去 DROP 五参版本，就把**部署顺序**变成了单向不可逆：
--        migration 一 apply，还没重新部署的旧代码立刻全部报「函数不存在」。
--        代码和数据库必须能各自独立上线，这是硬要求。
--
--    所以拆成两个**名字不同**的函数：
--      · `kernel_record_fenced_deny`      —— 历史五参入口，签名一字不动，永远可调用；
--      · `kernel_record_fenced_deny_v2`   —— 新的六参入口，带决策指针闸。
--    没有重载 = 没有歧义。老代码继续打老入口，新代码在需要 fence 时打 v2。
--
-- 🔴 **调用方的分流规则（src/lib/kernel/store.ts 强制）**：
--      expectedDecisionId == null（自动授权路径）→ 历史五参入口
--      expectedDecisionId != null（人工审批路径）→ **只能**走 v2；
--      v2 还没部署 → **fail closed 抛错**，绝不退回没有 fence 的五参调用。
--      退回去的话，那次迟到的「批不了」会把审批人正在看的**另一份**请求盖成 denied。
--
-- 逻辑只写一份：v2 是实现，五参入口是传 NULL 的转发壳。两份逐字抄会漂移。
-- 见 src/lib/kernel/store.ts 的 recordFencedDeny 与 authorize.ts 的 recordDeny。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kernel_record_fenced_deny_v2(
  p_run_id              uuid,
  p_expected_generation bigint,
  p_expected_status     text,
  p_decision            jsonb,
  p_reason              text,
  p_expected_decision_id uuid
)
RETURNS TABLE (ok boolean, reason text, decision_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run     public.action_runs%ROWTYPE;
  v_pending public.authorization_decisions%ROWTYPE;
  v_new_id  uuid;
BEGIN
  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::uuid; RETURN;
  END IF;

  -- 🔴 代际闸：过期的执行者不许把别人已经推进的 run 写成 denied。
  IF p_expected_generation IS NOT NULL
     AND v_run.claim_generation <> p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text, NULL::uuid;
    RETURN;
  END IF;

  -- 🔴 跨客户：决策必须属于这条 run 的客户，否则会往审计表里写一条串台的记录。
  --    kernel_ensure_run_steps 有这道闸，这里以前没有 —— 同一类漏洞要一起堵。
  IF (p_decision->>'client_id')::uuid IS DISTINCT FROM v_run.client_id THEN
    RETURN QUERY SELECT false, 'cross_client', NULL::uuid; RETURN;
  END IF;

  -- 状态闸（人工批准失败落地用）：只在仍停在那个状态时才写。
  IF p_expected_status IS NOT NULL AND v_run.status <> p_expected_status THEN
    RETURN QUERY SELECT false, 'not_' || p_expected_status || ':' || v_run.status, NULL::uuid;
    RETURN;
  END IF;

  -- 🔴 指针闸（人工批准失败落地用）：run 当前指着的必须还是**审批人看到的那一份**。
  --
  --    只有状态闸是不够的。`pending_approval` 期间这条 run 可能已经被重新排过一次：
  --    状态照样是 pending_approval，但挂着的已经是**另一份**待审批请求了。
  --    这时一次迟到的「批不了」会把那份**新的、还没人看过的**请求直接盖成 denied，
  --    而正在看它的人什么都不知道 —— 等于系统替他把那件事否了。
  --
  --    判据跟 kernel_resolve_pending_approval 第 ③ 步逐字一致，在同一把行锁里。
  --    p_expected_decision_id 为 NULL = 调用方没有「审批人看到的那份」这个概念
  --    （自动授权路径），跳过这道闸。
  IF p_expected_decision_id IS NOT NULL THEN
    IF v_run.authorization_decision_id IS DISTINCT FROM p_expected_decision_id THEN
      RETURN QUERY SELECT false, 'decision_not_current', NULL::uuid; RETURN;
    END IF;

    -- 🔴 **锚的完整身份核对 —— 跟 kernel_resolve_pending_approval 同一套判据。**
    --
    --    「指针指着它」还不够。`authorization_decision_id` 是外键，数据库只保证
    --    这个 id **存在**，不保证它指着的那条决策属于这条 run、这个客户。
    --    库里一次错挂（并发写歪、恢复路径写歪、手工改数据）之后，
    --    preflight 失败 / 政策漂移的失败落地会一路走到底 —— 而新签的 deny 记录里
    --    `policy_id` / `policy_version` 是**从那份别人的决策里抄过来的**：
    --    跨客户的数据被写进这个客户的 append-only 审计记录。
    --
    --    resolve 那边（第 ④ / ④b 步）早就在锁内做这组核对了。写入的两条路
    --    不许一条严一条松 —— 松的那条就是被绕过去的那条。
    SELECT * INTO v_pending FROM public.authorization_decisions
     WHERE id = p_expected_decision_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'pending_not_found', NULL::uuid; RETURN;
    END IF;
    IF v_pending.action_run_id <> v_run.id THEN
      RETURN QUERY SELECT false, 'pending_run_mismatch', NULL::uuid; RETURN;
    END IF;
    IF v_pending.verdict <> 'require_approval' THEN
      RETURN QUERY SELECT false, 'not_require_approval', NULL::uuid; RETURN;
    END IF;
    IF v_pending.client_id <> v_run.client_id
       OR v_pending.action_key <> v_run.action_key
       OR v_pending.action_version <> v_run.action_version
       OR v_pending.idempotency_key <> v_run.idempotency_key THEN
      RETURN QUERY SELECT false, 'pending_identity_mismatch', NULL::uuid; RETURN;
    END IF;

    -- 🔴 **这里刻意不镜像 resolve 的「政策三连」（行身份 / 版本 / 模式）。**
    --    那三条问的是「政策自挂起以来变没变」—— 而这条路**正是为了记下
    --    「它变了、所以做不了」**。把它镜像过来，政策一漂移这条 deny 就永远
    --    落不了地：run 卡在 pending_approval，谁都不知道为什么。
    --    resolve 自己的 reject 分支同样跳过政策三连，理由一样。
    --    身份判据（这份请求是不是这条 run 的）跟批不批准无关，两条路都过；
    --    政策判据（现在还准不准做）只属于放行那条路。
  END IF;

  INSERT INTO public.authorization_decisions
    (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
     policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
     cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
  VALUES
    (v_run.id,
     (p_decision->>'client_id')::uuid,
     p_decision->>'action_key',
     (p_decision->>'action_version')::integer,
     'deny',
     p_decision->>'deny_code',
     p_reason,
     COALESCE(p_decision->'policy_snapshot', '{}'::jsonb),
     NULLIF(p_decision->>'policy_id','')::uuid,
     NULLIF(p_decision->>'policy_version','')::integer,
     COALESCE(p_decision->>'decided_by','policy'),
     NULLIF(p_decision->>'decided_by_user',''),
     NULLIF(p_decision->>'cost_cap_usd','')::numeric,
     NULLIF(p_decision->>'cost_estimate_usd','')::numeric,
     p_decision->>'idempotency_key',
     NULL)
  RETURNING id INTO v_new_id;

  UPDATE public.action_runs
     SET status = 'denied',
         authorization_decision_id = v_new_id,
         needs_human = true,
         last_error  = p_reason,
         finished_at = now(),
         updated_at  = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'denied', v_new_id;
END;
$$;

-- 🔴 新函数必须自己收一次口。新建的函数对 PUBLIC 默认就是可执行的 ——
--    漏掉 REVOKE 的话 anon / authenticated 都能调，而 anon key 是印在浏览器
--    bundle 里的。（历史五参入口的授权是它自己那次 migration 给的，这里不动。）
REVOKE EXECUTE ON FUNCTION public.kernel_record_fenced_deny_v2(uuid, bigint, text, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_record_fenced_deny_v2(uuid, bigint, text, jsonb, text, uuid)
  TO service_role;


-- ============================================================================
-- 历史五参入口 —— **签名一字不动**，转发到 v2 并把决策指针闸关掉。
--
-- 🔴 为什么是 CREATE OR REPLACE 而不是原样留着不管：
--    v2 里那条跨客户闸（决策的 client_id 必须等于 run 的 client_id）是这次新加的，
--    自动授权路径同样需要它 —— 不然同一类漏洞堵了一半。转发让两条路共用一份逻辑，
--    也就不会出现「新入口严、老入口松」这种被绕过去的形状。
--
--    签名没变 ⇒ 没有重载歧义、ACL 原样保留、旧代码调用行为不变
--    （v2 传 NULL = 跳过指针闸 = 与历史语义逐字一致）。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kernel_record_fenced_deny(
  p_run_id              uuid,
  p_expected_generation bigint,
  p_expected_status     text,
  p_decision            jsonb,
  p_reason              text
)
RETURNS TABLE (ok boolean, reason text, decision_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.kernel_record_fenced_deny_v2(
    p_run_id, p_expected_generation, p_expected_status, p_decision, p_reason, NULL::uuid);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text)
  TO service_role;


-- ============================================================================
-- 人工批准/拒绝：身份核对提到 approve / reject 的**公共**分支
--
-- 🔴 原来 `kernel_resolve_pending_approval` 只在 approve 分支核对
--    「这份审批请求是不是这条 run 的」（client_id / action_key / 版本 / 幂等键）。
--    reject 分支在那之前就返回了 —— 于是库里一次错挂（decision 的
--    action_run_id 对得上，但 client_id 属于**另一个客户**）时，
--    当前客户可以把它拒掉，而新签的 deny 记录会把**那个客户的**
--    policy_id / policy_version 抄进自己的 append-only 审计记录。
--
--    拒绝不需要查政策（政策删了、变了，人依然有权说「不做」）——
--    但「这份请求是不是这条 run 的」跟批不批准无关，两条路都得过。
--
-- 函数体其余部分与历史迁移里的版本逐字相同；签名没变，
-- 所以这里是真正的 CREATE OR REPLACE（不需要 DROP，也不动 REVOKE/GRANT）。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kernel_resolve_pending_approval_v2(
  p_run_id              uuid,
  p_pending_decision_id uuid,
  p_resolution          text,     -- 'approve' | 'reject'
  p_resolved_by         text,
  p_reason              text,
  p_policy_snapshot     jsonb DEFAULT '{}',
  p_cost_estimate_usd   numeric DEFAULT NULL
)
RETURNS TABLE (ok boolean, reason text, decision_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      public.action_runs%ROWTYPE;
  v_pending  public.authorization_decisions%ROWTYPE;
  v_policy   public.client_automation_policies%ROWTYPE;
  v_new_id   uuid;
  v_cost_cap numeric;
  -- 🔴 **真实签发时刻**（挂钟），不是事务开始时间。见下面 ⑤ 那一段。
  v_signing_at timestamptz;
BEGIN
  IF p_resolution NOT IN ('approve','reject') THEN
    RETURN QUERY SELECT false, 'bad_resolution', NULL::uuid; RETURN;
  END IF;

  -- ① 锁 run —— 批准、拒绝、以及并发的另一次批准，全在这把锁上排队
  SELECT * INTO v_run FROM public.action_runs
   WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::uuid; RETURN;
  END IF;

  -- ② 必须**仍然**停在等审批。running / succeeded / denied 一律不许覆盖。
  IF v_run.status <> 'pending_approval' THEN
    RETURN QUERY SELECT false, 'not_pending:' || v_run.status, NULL::uuid; RETURN;
  END IF;

  -- ③ run 当前指着的必须还是这份审批请求（防拿旧页面上的过期请求来批）
  IF v_run.authorization_decision_id IS DISTINCT FROM p_pending_decision_id THEN
    RETURN QUERY SELECT false, 'decision_not_current', NULL::uuid; RETURN;
  END IF;

  -- ④ 锁住这份审批请求本身，并核对它的身份
  SELECT * INTO v_pending FROM public.authorization_decisions
   WHERE id = p_pending_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'pending_not_found', NULL::uuid; RETURN;
  END IF;
  IF v_pending.action_run_id <> v_run.id THEN
    RETURN QUERY SELECT false, 'pending_run_mismatch', NULL::uuid; RETURN;
  END IF;
  IF v_pending.verdict <> 'require_approval' THEN
    RETURN QUERY SELECT false, 'not_require_approval', NULL::uuid; RETURN;
  END IF;

  -- 🔴 ④b 身份核对 —— **approve 和 reject 共用**。（Codex P2）
  --
  --    这一段原来只在 approve 分支里（原第 ⑥ 步）。于是库里一次错挂
  --    （decision 的 action_run_id 对得上这条 run，但 client_id 是**另一个客户**）
  --    时，reject 这条路会一路走到底：新签的 deny 记录 client_id 是对的，
  --    但 policy_id / policy_version 是**从那份别人的决策里抄过来的** ——
  --    跨客户的数据被写进了这个客户的 append-only 审计记录里。
  --
  --    拒绝确实不需要查政策（政策删了、变了，人依然有权说「不做」），
  --    但「这份请求到底是不是这条 run 的」跟批不批准无关，两条路都得过。
  IF v_pending.client_id <> v_run.client_id
     OR v_pending.action_key <> v_run.action_key
     OR v_pending.action_version <> v_run.action_version
     OR v_pending.idempotency_key <> v_run.idempotency_key THEN
    RETURN QUERY SELECT false, 'pending_identity_mismatch', NULL::uuid; RETURN;
  END IF;

  IF p_resolution = 'reject' THEN
    -- 拒绝不查政策：政策被删了、变了，人依然有权说「不做」。
    INSERT INTO public.authorization_decisions
      (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
       policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
       cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
    VALUES
      (v_run.id, v_run.client_id, v_run.action_key, v_run.action_version, 'deny',
       'policy_deny', p_reason, p_policy_snapshot, v_pending.policy_id,
       v_pending.policy_version, 'human', p_resolved_by,
       v_run.cost_cap_usd, v_run.cost_estimate_usd, v_run.idempotency_key, NULL)
    RETURNING id INTO v_new_id;

    UPDATE public.action_runs
       SET status = 'denied',
           authorization_decision_id = v_new_id,
           needs_human = false,
           -- 🔴 T1：这是一次**交接**，不是继续推进 —— 把租约清干净。
           --    挂起等审批期间那份租约的 owner 早就走了；不清的话，
           --    真正要来推进的人会被这份僵尸租约挡成「已经有人在做了」。
           claimed_by       = NULL,
           claimed_at       = NULL,
           heartbeat_at     = NULL,
           lease_expires_at = NULL,
           last_error  = p_reason,
           finished_at = now(),
           updated_at  = now()
     WHERE id = v_run.id;

    RETURN QUERY SELECT true, 'rejected', v_new_id; RETURN;
  END IF;

  -- ── approve ────────────────────────────────────────────────────────────
  -- ⑤ 政策三连（跟执行前同一套）：当前生效的那一行必须还是挂起时那一行、
  --    同一版、且模式仍是「要人审」。时间窗口径与 kernel_begin_authorized_run 一致。
  --
  -- 🔴 **`FOR UPDATE` —— 政策行必须被锁住，一路锁到事务提交。**（Codex P2）
  --
  --    不锁的话有一个真实窗口：Settings 在这句 `SELECT` 读到旧版
  --    `require_approval` 之后、下面那条 allow 写进去之前提交了一次改动
  --    （比如把模式改成 `deny`）。这个函数拿着旧快照照签 allow、把 run 改成
  --    `authorized`、并向审批人回「成功」—— 而客户的规则此刻已经是「禁止」。
  --    Gateway 开跑前会重读政策再拦一次，所以**不会**真的执行；但
  --    append-only 的审计表里已经留下一条**签发当时就已失效**的放行，
  --    而那条 run 还得再走一次重新授权才能恢复。审计记录说的必须是当时的事实。
  --
  --    🔴 **锁顺序固定：run → pending decision → active policy。**
  --       三把锁在这个函数里永远按这个顺序拿；`kernel_record_fenced_deny`
  --       只拿前两把（它不读政策）。顺序一致 = 不会互相成环 = 不会死锁。
  --
  --    🔴 **这把锁单独用是不够的 —— 它必须跟本文件末尾那条 EXCLUDE 约束一起看。**
  --       锁 SELECT 拦不住 INSERT：没有那条约束的话，并发事务可以插进一条
  --       `effective_from` 更晚、此刻已经生效的新政策，直接越过这把行锁当家。
  --       约束保证同一时刻最多一行有效 ⇒ `LIMIT 1` 选出来的就是唯一那行
  --       ⇒ 这把 FOR UPDATE 才真的锁住了「当家的那个」。
  --
  --    🔴 `ORDER BY … LIMIT 1 FOR UPDATE` 的语义要说清：并发事务把选中那行
  --       改成不再满足 WHERE 时，Postgres 会重新求值（EvalPlanQual）并返回 0 行 ——
  --       于是这里走 `no_active_policy`，那是**正确**的答案（此刻确实没有生效的规则）。
  --
  --    ⚠️ 代价要写明：锁住当前活动行会挡住并发的 UPDATE / DELETE，也会挡住
  --       「先关掉旧行、再插一条新活动行」那种切换流程 —— 它得等这次审批提交。
  --       这是刻意的取舍：审批只占一个很短的事务，而拿旧快照签放行是错的。
  --
  -- 🔴 **时刻一律用挂钟 `clock_timestamp()`，不用 `now()`。**（Build Control Room blocker ②）
  --
  --    `now()` = `transaction_timestamp()`，在**事务开始那一刻**就定死了。
  --    这个函数会在 run 锁、待审批决策锁、政策锁上排队 —— 排队多久，
  --    `now()` 就比真实时间旧多久。于是一条**有结束时间**的政策完全可能：
  --    事务开始时还生效，等锁等完已经过期，而 `now()` 照样说它生效。
  --    结果是拿一份**签发当时就已经失效**的政策签出 allow、把 run 推到
  --    `authorized`、并向审批人回「成功」。Gateway 开跑前会再拦一次，
  --    所以不会真的执行；但 append-only 的审计表里已经留下一条假记录 ——
  --    审计说的必须是当时的事实。
  --
  --    「既有代码也用 now()」不构成豁免：签一张已经过期的授权就是错的。
  v_signing_at := clock_timestamp();
  SELECT * INTO v_policy
    FROM public.client_automation_policies p
   WHERE p.client_id = v_run.client_id
     AND p.action_key = v_run.action_key
     AND p.effective_from <= v_signing_at
     AND (p.effective_to IS NULL OR p.effective_to > v_signing_at)
   ORDER BY p.effective_from DESC
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_active_policy', NULL::uuid; RETURN;
  END IF;

  -- 🔴 **拿到政策锁之后重新取一次挂钟，再复核一遍时间窗。**
  --    上面那次取值发生在**等政策锁之前**；`FOR UPDATE` 自己也会排队。
  --    所以真正的签发时刻只有这里才知道，窗口必须按它再验一次。
  --    下面 INSERT 的 `expires_at` 也从**同一个** v_signing_at 推导 ——
  --    两个时刻各算各的话，会签出一张有效期起点比自己还早的授权。
  v_signing_at := clock_timestamp();
  IF NOT (v_policy.effective_from <= v_signing_at
          AND (v_policy.effective_to IS NULL OR v_policy.effective_to > v_signing_at)) THEN
    RETURN QUERY SELECT false, 'policy_expired_before_signing', NULL::uuid; RETURN;
  END IF;

  -- 🔴 三连一律在**拿到锁之后**核对 —— 锁之前比等于比一份可能马上过期的快照。
  IF v_policy.id IS DISTINCT FROM v_pending.policy_id THEN
    RETURN QUERY SELECT false, 'policy_identity_changed', NULL::uuid; RETURN;
  END IF;
  IF v_policy.policy_version IS DISTINCT FROM v_pending.policy_version THEN
    RETURN QUERY SELECT false, 'stale_policy_version', NULL::uuid; RETURN;
  END IF;
  IF v_policy.mode <> 'require_approval' THEN
    RETURN QUERY SELECT false, 'policy_mode_changed', NULL::uuid; RETURN;
  END IF;

  v_cost_cap := COALESCE(v_policy.spend_cap_per_run_usd, 0);

  -- ⑦ 一次性：签人签的放行 + run → authorized + 指向新决策
  INSERT INTO public.authorization_decisions
    (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
     policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
     cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
  VALUES
    (v_run.id, v_run.client_id, v_run.action_key, v_run.action_version, 'allow',
     NULL, p_reason, p_policy_snapshot, v_policy.id, v_policy.policy_version,
     'human', p_resolved_by, v_cost_cap, p_cost_estimate_usd,
     v_run.idempotency_key,
     -- 🔴 有效期从**同一个**签发时刻推导（不是 now()）——
     --    用 now() 的话，锁上排了 30 秒，这张授权就凭空少活 30 秒。
     v_signing_at + (v_policy.decision_ttl_seconds * interval '1 second'))
  RETURNING id INTO v_new_id;

  UPDATE public.action_runs
     SET status = 'authorized',
         authorization_decision_id = v_new_id,
         cost_cap_usd = v_cost_cap,
         cost_estimate_usd = p_cost_estimate_usd,
         needs_human = false,
         -- 🔴 T1：批准是一次**交接**。挂起等审批期间留下的那份租约，
         --    它的 owner 早就走了 —— 不清掉的话，真正要来推进这条 run 的人
         --    会被这份僵尸租约挡成「已经有人在做了」，而实际没有任何人在做。
         claimed_by       = NULL,
         claimed_at       = NULL,
         heartbeat_at     = NULL,
         lease_expires_at = NULL,
         updated_at  = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'approved', v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_resolve_pending_approval_v2(uuid, uuid, text, text, text, jsonb, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_resolve_pending_approval_v2(uuid, uuid, text, text, text, jsonb, numeric)
  TO service_role;


-- ============================================================================
-- 历史 `kernel_resolve_pending_approval` —— **签名一字不动**，转发到 v2
--
-- 🔴 为什么必须版本化（Build Control Room blocker ①）：
--    上一版新代码仍然打**历史原名**。代码先部署、这条 migration 还没 apply 时，
--    那次调用会**成功**打在旧实现上 —— 于是本 PR 新加的锚身份闸、政策行锁、
--    挂钟复核**在整个上线窗口里全部不存在**，而调用方拿到的是「成功」。
--    静默降级比报错危险得多：报错会停下，降级会继续往下走。
--
--    所以：新代码只打 `_v2`，`_v2` 不存在就 fail closed（见 src/lib/kernel/store.ts）。
--
-- 🔴 反过来那半边也要接住：**migration 先 apply、代码还没换**的时候，
--    旧代码打的是历史原名 —— 这个壳把它转发到 v2，于是它**自动拿到新的安全实现**。
--    两个方向都不会退化成旧逻辑。
--
--    签名没变 ⇒ 没有重载歧义、ACL 原样保留；这里的 REVOKE/GRANT 是照着
--    历史那次 migration 原样重申一遍，不改变任何既有授权。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kernel_resolve_pending_approval(
  p_run_id              uuid,
  p_pending_decision_id uuid,
  p_resolution          text,     -- 'approve' | 'reject'
  p_resolved_by         text,
  p_reason              text,
  p_policy_snapshot     jsonb DEFAULT '{}',
  p_cost_estimate_usd   numeric DEFAULT NULL
)
RETURNS TABLE (ok boolean, reason text, decision_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.kernel_resolve_pending_approval_v2(
    p_run_id, p_pending_decision_id, p_resolution, p_resolved_by, p_reason,
    p_policy_snapshot, p_cost_estimate_usd);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_resolve_pending_approval(uuid, uuid, text, text, text, jsonb, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_resolve_pending_approval(uuid, uuid, text, text, text, jsonb, numeric)
  TO service_role;


-- ============================================================================
-- `kernel_begin_authorized_run` —— 同一种「锁等待 / 检查时刻」漏洞，一起堵
--
-- 🔴 它跟 resolve 是**同一个形状**：先 `FOR UPDATE` 锁 run、再锁 decision，
--    然后用 `now()` 判 `expires_at` 和政策时间窗。锁上排队多久，`now()` 就旧多久 ——
--    于是一张在等锁期间刚过期的授权、一条刚失效的政策，照样被判成「还有效」，
--    run 被放进 `running` 真的开跑。resolve 那边最坏是审计留假记录，
--    这边最坏是**真的执行了一次已经不被授权的动作**。
--
-- 🔴 **为什么这个不需要版本化**（跟 resolve / fenced_deny 不同）：
--    版本化是因为**新代码依赖新保证** —— 保证没上线就必须 fail closed。
--    这里没有任何新代码依赖它：签名不变、没有新参数、应用层一个字没改。
--    未 apply = 今天的行为（不退化），apply 后 = 正确的行为。
--    两边都不会崩，所以不需要 v2、不需要兼容壳、也没有上线顺序问题。
--
-- 🔴 **函数体是从历史迁移里程序化复制的**，只做了四处替换：
--    加 `v_now` 声明 · 两把锁之后取一次挂钟 · `expires_at` 比 v_now ·
--    政策时间窗比 v_now。写入用的时间戳（`consumed_at` / `started_at` /
--    `updated_at`）**一律保持 now()** —— 那些记的是「什么时候写的」，不是判据。
--    有一条守卫测试逐字比对这份副本与历史原文，只允许这四处不同：
--    手抄一个 132 行的执行闸，抄漏一条判据是不会有人发现的。
--
--    **没有修改历史迁移文件**，这是一次前向 CREATE OR REPLACE。
--    签名没变 ⇒ ACL 原样保留；下面的 REVOKE/GRANT 照历史原样重申一遍。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.kernel_begin_authorized_run(
  p_run_id              uuid,
  p_decision_id         uuid,
  p_worker_id           text,
  -- 🔴 F1：兑换授权也要出示自己那一代。过期的执行者不许把授权用掉 ——
  --    授权一旦被消费就再也签不回来，那是不可逆的。
  p_expected_generation bigint DEFAULT NULL
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      public.action_runs%ROWTYPE;
  v_decision public.authorization_decisions%ROWTYPE;
  v_policy_id      uuid;
  v_policy_version integer;
  v_policy_mode    text;
  v_policy_found   boolean;
  -- 🔴 真实时刻（挂钟）。见函数头那段说明。
  v_now            timestamptz;
BEGIN
  -- ① 先锁 run。谁拿到这把锁，谁才有资格谈执行权。
  SELECT * INTO v_run FROM public.action_runs
   WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found'; RETURN;
  END IF;

  -- ② 再锁决策（顺序固定 run → decision，避免与其他路径互相死锁）
  SELECT * INTO v_decision FROM public.authorization_decisions
   WHERE id = p_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'decision_not_found'; RETURN;
  END IF;

  -- 🔴 两把行锁都拿到了，**现在**才知道真实时刻。下面所有「还有效吗」
  --    一律按它判，不按事务开始时间。
  v_now := clock_timestamp();

  -- ③ run 必须正好停在「已授权、还没开跑」
  IF v_run.status <> 'authorized' THEN
    RETURN QUERY SELECT false, 'run_not_authorized:' || v_run.status; RETURN;
  END IF;

  -- ③b 🔴 F1 代际闸：只有**当前这一代**的执行者能把授权兑换掉。
  --     状态闸和指针闸都拦不住这一种：接管者把 run 重新推回 authorized、
  --     指针也指向新签的那条决策之后，上一代要是恰好拿着同一条决策的 id
  --     （比如接管发生在它读完之后），状态和指针都能对上 —— 只有代际能分开。
  IF p_expected_generation IS NOT NULL AND v_run.claim_generation <> p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text; RETURN;
  END IF;

  -- ④ 🔴 双向绑定：run 当前指着的必须就是这一条决策，且这条决策也必须属于这个 run。
  --    这一条是「同一个 run 的两份 allow 决策只有一份能兑换执行权」的实现。
  IF v_run.authorization_decision_id IS DISTINCT FROM p_decision_id THEN
    RETURN QUERY SELECT false, 'decision_not_current'; RETURN;
  END IF;
  IF v_decision.action_run_id <> v_run.id THEN
    RETURN QUERY SELECT false, 'decision_run_mismatch'; RETURN;
  END IF;

  -- ⑤ 身份与契约必须逐项对得上
  IF v_decision.client_id <> v_run.client_id THEN
    RETURN QUERY SELECT false, 'cross_client'; RETURN;
  END IF;
  IF v_decision.action_key <> v_run.action_key THEN
    RETURN QUERY SELECT false, 'action_key_mismatch'; RETURN;
  END IF;
  IF v_decision.action_version <> v_run.action_version THEN
    RETURN QUERY SELECT false, 'action_version_mismatch'; RETURN;
  END IF;
  IF v_decision.idempotency_key <> v_run.idempotency_key THEN
    RETURN QUERY SELECT false, 'idempotency_mismatch'; RETURN;
  END IF;

  -- ⑥ 授权本身必须有效
  IF v_decision.verdict <> 'allow' THEN
    RETURN QUERY SELECT false, 'not_allow:' || v_decision.verdict; RETURN;
  END IF;
  IF v_decision.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_consumed'; RETURN;
  END IF;
  IF v_decision.expires_at IS NOT NULL AND v_decision.expires_at <= v_now THEN
    RETURN QUERY SELECT false, 'expired'; RETURN;
  END IF;

  -- ⑦ 政策必须还是**签发时那一行、那一版、且模式仍允许这类授权**。
  --    时间窗（C5）：带结束时间但还没到期的政策一样是生效的，
  --    不能用 effective_to IS NULL 把它当成「没有政策」。
  SELECT p.id, p.policy_version, p.mode
    INTO v_policy_id, v_policy_version, v_policy_mode
    FROM public.client_automation_policies p
   WHERE p.client_id = v_run.client_id
     AND p.action_key = v_run.action_key
     AND p.effective_from <= v_now
     AND (p.effective_to IS NULL OR p.effective_to > v_now)
   ORDER BY p.effective_from DESC
   LIMIT 1;
  v_policy_found := FOUND;

  -- 🔴 政策被删掉 ≠ 「没有版本号所以随便过」。没有生效政策 = 不许执行。
  IF NOT v_policy_found THEN
    RETURN QUERY SELECT false, 'no_active_policy'; RETURN;
  END IF;
  -- 🔴 身份（C2）：版本号只在同一行政策内有意义。
  --    「auto v1 → 删掉 → 重建 deny v1」两条版本号一样，只有行 id 分得开。
  IF v_decision.policy_id IS DISTINCT FROM v_policy_id THEN
    RETURN QUERY SELECT false, 'policy_identity_changed'; RETURN;
  END IF;
  IF v_decision.policy_version IS DISTINCT FROM v_policy_version THEN
    RETURN QUERY SELECT false, 'stale_policy_version'; RETURN;
  END IF;
  -- 🔴 模式复核（C2）：机器签的放行只在「现在仍是自动」时有效，
  --    人签的放行只在「现在仍要人审」时有效 —— 模式一换，旧授权作废。
  IF v_decision.decided_by = 'policy' AND v_policy_mode <> 'auto_approve' THEN
    RETURN QUERY SELECT false, 'policy_mode_changed'; RETURN;
  END IF;
  IF v_decision.decided_by = 'human' AND v_policy_mode <> 'require_approval' THEN
    RETURN QUERY SELECT false, 'policy_mode_changed'; RETURN;
  END IF;

  -- ⑧ 一次性完成：兑换授权 + run 进入 running
  UPDATE public.authorization_decisions
     SET consumed_at = now(), consumed_by = p_worker_id
   WHERE id = p_decision_id;

  UPDATE public.action_runs
     SET status     = 'running',
         started_at = COALESCE(started_at, now()),
         last_error = NULL,
         updated_at = now()
   WHERE id = p_run_id;

  RETURN QUERY SELECT true, 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_begin_authorized_run(uuid, uuid, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_begin_authorized_run(uuid, uuid, text, bigint)
  TO service_role;


-- ============================================================================
-- 同一个 客户 + 动作 的生效时间窗不许重叠（Build Control Room blocker ②）
--
-- 🔴 **只锁住「当前活动的那一行」是不够的。**
--    上面那句 `ORDER BY effective_from DESC LIMIT 1 FOR UPDATE` 锁的是**已经存在**
--    的那一行。锁 SELECT 拦不住 INSERT —— 并发事务完全可以在同一个
--    (client_id, action_key) 上插进一条 `effective_from` 更晚、但**此刻已经生效**
--    的新政策。于是：
--      · 审批这边拿着被锁住的旧行做完三连、签出 allow、run → authorized；
--      · 而按 `ORDER BY effective_from DESC LIMIT 1` 的口径，现在当家的已经是新行了。
--    审计表里那条放行是**照着一份已经不当家的规则**签出来的，而 Gateway 开跑前
--    重读政策会读到新行 —— 于是这条 run 还得再走一次重新授权。
--    这不是锁没锁对，是**数据模型允许两行同时有效**。
--
--    根治办法是让「同时有效」这件事在库里根本表示不出来：EXCLUDE 约束把
--    (client_id, action_key) 相同、且时间窗相交的两行直接拒掉。有了它，
--    `ORDER BY … LIMIT 1` 选出来的那一行就是**唯一**可能生效的行，
--    上面那把 FOR UPDATE 才真的锁住了「当家的那个」。
--
--    切换政策的正确写法因此变成：先把旧行 `effective_to` 收到新行的
--    `effective_from`，再插新行 —— 两步在同一个事务里。旧写法「先插新行、
--    回头再关旧行」会被这条约束当场拒掉，**这是有意的**。
-- ============================================================================

-- btree_gist：EXCLUDE 里要拿 uuid / text 做 `=` 比较就得有它
-- （gist 原生只认范围类型那种可重叠的操作符）。
-- search_path 显式带上 extensions —— Supabase 把扩展装在那个 schema 里，
-- 不带的话下面 ALTER TABLE 找不到 uuid / text 的 gist 操作符类。
CREATE EXTENSION IF NOT EXISTS btree_gist;
SET search_path = public, extensions;

-- 🔴 **存量重叠一律让 migration 当场失败，绝不自动改客户数据。**
--
--    直接加约束的话，PostgreSQL 报的是一条只带内部行号的约束冲突 ——
--    看的人不知道是哪个客户、哪个动作、哪两行。更要命的是「顺手修一下」
--    的冲动：自动去截断某一行的 effective_to，就是在**替客户改他们的自动化规则**，
--    而哪一行才是他们真正想要的那条只有他们自己知道。
--    所以这里先自己查一遍、把冲突行原样报出来，然后停下等人处理。
DO $$
DECLARE
  v_conflicts text;
BEGIN
  SELECT string_agg(
           format('client_id=%s action_key=%s 行 %s 与行 %s 的生效时间窗相交',
                  a.client_id, a.action_key, a.id, b.id),
           E'\n')
    INTO v_conflicts
    FROM public.client_automation_policies a
    JOIN public.client_automation_policies b
      ON a.client_id  = b.client_id
     AND a.action_key = b.action_key
     AND a.id < b.id
     AND tstzrange(a.effective_from, a.effective_to, '[)')
      && tstzrange(b.effective_from, b.effective_to, '[)');

  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION
      E'存量数据里已经有「同一个客户+动作、同时生效的多条政策」，迁移中止。\n%\n'
      '不自动修：截断哪一行的 effective_to 等于替客户改他们的自动化规则，'
      '哪一条才是他们要的只有他们知道。请人工把每组冲突收敛成一条后重跑。',
      v_conflicts;
  END IF;
END $$;

ALTER TABLE public.client_automation_policies
  ADD CONSTRAINT client_automation_policies_no_window_overlap
  EXCLUDE USING gist (
    client_id  WITH =,
    action_key WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  );

COMMENT ON CONSTRAINT client_automation_policies_no_window_overlap
  ON public.client_automation_policies IS
  '同一个 客户+动作 任何时刻最多只有一条政策生效。'
  'kernel_resolve_pending_approval 的 ORDER BY effective_from DESC LIMIT 1 FOR UPDATE '
  '靠这条约束才成立 —— 没有它，并发插进来的更晚政策会越过那把行锁当家。';
