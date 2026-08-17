"""K-WP01A 变异探针 · recovery / cost —— 恢复权原子领取、执行卡片归属、死信前落库、删除侧引用、租约接管、预算与金额合法性

🔴 **只放探针定义，不放 runner。** 判定与执行在 `scripts/kernel-mutation-check.py`。
   拆分是因为原文件到了 2501 行 > 仓库铁律的 800 —— 拆的是**文件位置，
   不是探针**：名字、目标文件、替换内容、目标测试、以及**顺序**全部原样保留。

🔴 新增探针请加到对应主题模块里，并同步 `scripts/kernel_mutations/__init__.py`
   的 `EXPECTED_MODULES` —— 漏加载一个模块会让那一批**静静地不跑**而全绿。
"""

MUTATIONS = [
    # ── S2：executionItem 跨客户 ─────────────────────────────────────────
    dict(
        name="S2 应用层去掉执行卡片归属检查",
        file="src/lib/kernel/runner.ts",
        old="""    if (item.client_id !== input.clientId) {""",
        new="""    if (false) {""",
        test="src/lib/kernel/__tests__/execution-item-ownership.test.ts",
        expect_fail_contains="应用层拒绝",
    ),
    dict(
        name="S2 假件去掉执行卡片复合外键复刻",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""          if (table === 'action_runs' && row.execution_item_id) {""",
        new="""          if (false) {""",
        test="src/lib/kernel/__tests__/execution-item-ownership.test.ts",
        expect_fail_contains="数据库层拒绝",
    ),
    # ── S3：死信前先落 cost / verification ───────────────────────────────
    dict(
        name="S3 判定之前不先落库（钱和失败的验证都丢了）",
        file="src/lib/kernel/gateway.ts",
        old="""        stepCostSoFar += cost
        const observedAt = deps.now().toISOString()
        await writeStep(step.id, {
          attempt,
          output: result.output,
          verification: result.verification ?? null,
          cost_actual_usd: stepCostSoFar,
          heartbeat_at: observedAt,
        })
        spent += cost""",
        new="""        stepCostSoFar += cost
        spent += cost""",
        test="src/lib/kernel/__tests__/cost-persistence.test.ts",
        expect_fail_contains="先落库",
    ),
    dict(
        name="S3 成本改回覆盖语义（重跑让历史已花的钱变小）",
        file="src/lib/kernel/gateway.ts",
        old="""          cost_actual_usd: stepCostSoFar,""",
        new="""          cost_actual_usd: cost,""",
        test="src/lib/kernel/__tests__/cost-persistence.test.ts",
        expect_fail_contains="累加",
    ),
    dict(
        name="S3 spent 不再含历史（每次重跑预算从零起算）",
        file="src/lib/kernel/gateway.ts",
        old="""  let spent = steps.reduce((sum, s) => sum + Number(s.cost_actual_usd ?? 0), 0)""",
        new="""  let spent = 0""",
        test="src/lib/kernel/__tests__/cost-persistence.test.ts",
        expect_fail_contains="预算从历史真实花费起算",
    ),
    dict(
        name="S3/T2 整个拆掉开跑前那道预算闸（超了还再花一次才发现）",
        file="src/lib/kernel/gateway.ts",
        old="""      const budgetBlock = nextStepBlockedByBudget(
        definition, args.run, ctx.costCapUsd, spent, stepKey, stepCostSoFar,
      )
      if (budgetBlock) {""",
        new="""      const budgetBlock = nextStepBlockedByBudget(
        definition, args.run, ctx.costCapUsd, spent, stepKey, stepCostSoFar,
      )
      if (false) {""",
        test="src/lib/kernel/__tests__/cost-persistence.test.ts",
        expect_fail_contains="装不下就永远不调 handler",
    ),
    # ── 删除侧的引用动作 ─────────────────────────────────────────────────
    dict(
        name="删卡片改成连执行台账一起删（SET NULL 没了）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""            if (r.execution_item_id && ids.has(r.execution_item_id)) r.execution_item_id = null""",
        new="""            void ids""",
        test="src/lib/kernel/__tests__/execution-item-ownership.test.ts",
        expect_fail_contains="只把指针置空",
    ),
    dict(
        name="有台账的目标也能直接删掉（NO ACTION 没了）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""        if (table === 'goals' && removed.length > 0) {""",
        new="""        if (false) {""",
        test="src/lib/kernel/__tests__/execution-item-ownership.test.ts",
        expect_fail_contains="删不掉",
    ),
    dict(
        name="SQL 里把卡片外键的 SET NULL 去掉（跟内存复刻分家）",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""    ON DELETE SET NULL (execution_item_id),""",
        new="""    ,""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="删除语义",
    ),
    dict(
        name="SQL 里给目标外键加上 SET NULL（会撞 goal_matches_purpose）",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""    FOREIGN KEY (client_id, goal_id) REFERENCES public.goals (client_id, id),""",
        new="""    FOREIGN KEY (client_id, goal_id) REFERENCES public.goals (client_id, id) ON DELETE SET NULL,""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="删除语义",
    ),
    dict(
        name="恢复 RPC 把两条 UPDATE 调个个儿，顺手抹掉历史成本",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        # 这条专打「按下一条语句切片」的写法：调换顺序后那种切法会切出空串，
        # 而 expect('').not.toContain(...) 恒真 —— 断言静默失效，抹钱就混过去了。
        old="""  UPDATE public.action_run_steps
     SET status          = CASE WHEN status <> 'succeeded' THEN 'pending' ELSE status END,
         last_error      = CASE WHEN status <> 'succeeded' THEN NULL ELSE last_error END,
         next_attempt_at = CASE WHEN status <> 'succeeded' THEN NULL ELSE next_attempt_at END,
         finished_at     = CASE WHEN status <> 'succeeded' THEN NULL ELSE finished_at END,
         claim_generation = v_run.claim_generation + 1,
         updated_at      = now()
   WHERE run_id = v_run.id;

  UPDATE public.action_runs
     SET status = 'queued',""",
        new="""  UPDATE public.action_runs
     SET status = 'queued',""",
        old2="""         updated_at = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'claimed';""",
        new2="""         updated_at = now()
   WHERE id = v_run.id;

  UPDATE public.action_run_steps
     SET status          = 'pending',
         last_error      = NULL,
         next_attempt_at = NULL,
         finished_at     = NULL,
         cost_actual_usd = 0,
         updated_at      = now()
   WHERE run_id = v_run.id;

  RETURN QUERY SELECT true, 'claimed';""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="步骤重置在同一个函数里",
    ),
    # ── T1：中间态 run 的租约 / 接管 ──────────────────────────────────────
    dict(
        name="T1 已存在的 run 一律 in_progress（退回没有接管这一步）",
        file="src/lib/kernel/runner.ts",
        old="""  return driveIntermediateRun(deps, submitted.run.id)""",
        new="""  return {
    kind: 'in_progress',
    run: submitted.run,
    decision: null,
    execution: null,
    humanReason: '这件事已经有人在做了，这次不重复做',
  }""",
        test="src/lib/kernel/__tests__/lease-takeover.test.ts",
        expect_fail_contains="被接走",
    ),
    dict(
        name="T1 假件去掉租约到期判据（永远抢不走 / 随便抢）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      String(run.lease_expires_at) > nowIso""",
        new="""      true""",
        test="src/lib/kernel/__tests__/lease-takeover.test.ts",
        expect_fail_contains="租约",
    ),
    dict(
        name="T1 假件去掉 owner CAS（谁来都能把 owner 写成自己）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (leaseAlive && run.claimed_by !== ownerId) {""",
        new="""    if (false) {""",
        test="src/lib/kernel/__tests__/lease-takeover.test.ts",
        expect_fail_contains="偷不走",
    ),
    dict(
        name="T1 假件去掉状态白名单（终态也能被接管）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (!['queued', 'authorizing', 'authorized', 'running'].includes(String(run.status))) {""",
        new="""    if (false) {""",
        test="src/lib/kernel/__tests__/lease-takeover.test.ts",
        expect_fail_contains="终态拿不走",
    ),
    dict(
        name="T1 接管 authorized 时重新签一份授权（审计表出现两个「谁批的」）",
        file="src/lib/kernel/runner.ts",
        old="""    const reused = await reuseLiveAuthorization(deps, owned)
    if (reused?.ctx) return executeAndWrap(deps, reused.decision, reused.ctx, fence)""",
        new="""    const reused = null
    if (reused) return executeAndWrap(deps, reused, reused, fence)""",
        test="src/lib/kernel/__tests__/lease-takeover.test.ts",
        expect_fail_contains="复用",
    ),
    dict(
        name="T1 交接时不清租约（批准之后被僵尸租约挡住）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    run.claimed_by = null
    run.claimed_at = null
    run.heartbeat_at = null
    run.lease_expires_at = null
    run.updated_at = nowIso
    return { ok: true, reason: 'approved', decision_id: String(decision.id) }""",
        new="""    run.updated_at = nowIso
    return { ok: true, reason: 'approved', decision_id: String(decision.id) }""",
        test="src/lib/kernel/__tests__/lease-takeover.test.ts",
        expect_fail_contains="僵尸租约",
    ),
    dict(
        name="T1 恢复时不清租约（恢复完崩掉就再也没人接得走）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    run.finished_at = null
    // 🔴 跟 SQL 一致：放回 queued 的同时把租约清干净，否则恢复之后崩掉
    //    这条 run 会留着一个死 owner，再也没人接得走。
    run.claimed_by = null
    run.claimed_at = null
    run.heartbeat_at = null
    run.lease_expires_at = null""",
        new="""    run.finished_at = null""",
        test="src/lib/kernel/__tests__/lease-takeover.test.ts",
        expect_fail_contains="仍然能被接走",
    ),
    dict(
        name="T1 挂起等审批时不清租约（这条 run 看起来一直「有人在做」）",
        file="src/lib/kernel/authorize.ts",
        old="""      claimed_by: null,
      claimed_at: null,
      heartbeat_at: null,
      lease_expires_at: null,
    })""",
        new="""    })""",
        test="src/lib/kernel/__tests__/lease-takeover.test.ts",
        expect_fail_contains="租约被清空",
    ),
    dict(
        name="T1 租约身份退回用进程 workerId（同进程并发互相当成自己续租）",
        file="src/lib/kernel/runner.ts",
        old="""function nextOwnerId(deps: KernelDeps): string {
  claimSeq += 1
  return `${deps.ownerId}#${claimSeq}`
}""",
        new="""function nextOwnerId(deps: KernelDeps): string {
  claimSeq += 1
  return deps.workerId
}""",
        test="src/lib/kernel/__tests__/concurrency.test.ts",
        expect_fail_contains="四个调用同时提交也一样",
    ),
    dict(
        name="T1 SQL 里去掉接管 RPC 的 FOR UPDATE",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::text, NULL::uuid, false, 0, NULL::bigint, false; RETURN;
  END IF;

  -- ② 状态白名单。""",
        new="""  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::text, NULL::uuid, false, 0, NULL::bigint, false; RETURN;
  END IF;

  -- ② 状态白名单。""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="锁",
    ),
    # ── T2：开跑前的预算闸要结合下一步成本 ────────────────────────────────
    dict(
        name="T2 预检退回 strict spent > cap（等号边界照花钱）",
        file="src/lib/kernel/gateway.ts",
        old="""      const budgetBlock = nextStepBlockedByBudget(
        definition, args.run, ctx.costCapUsd, spent, stepKey, stepCostSoFar,
      )""",
        new="""    const budgetBlock =
      ctx.costCapUsd !== null && spent > ctx.costCapUsd
        ? { humanReason: '超预算，这一步不开跑', detail: {} }
        : null""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="handler 一次都不调",
    ),
    dict(
        name="T2 预检改成 spent >= cap（把零成本能力全部拦死）",
        file="src/lib/kernel/gateway.ts",
        old="""      const budgetBlock = nextStepBlockedByBudget(
        definition, args.run, ctx.costCapUsd, spent, stepKey, stepCostSoFar,
      )""",
        new="""    const budgetBlock =
      ctx.costCapUsd !== null && spent >= ctx.costCapUsd
        ? { humanReason: '超预算，这一步不开跑', detail: {} }
        : null""",
        test="src/lib/kernel/__tests__/safe-capability.test.ts",
        expect_fail_contains="Goal → 授权 → 执行 → 验证 → 成功",
    ),
    dict(
        name="T2 每步上界不看契约声明（只剩「整个动作免费」那条兜底）",
        file="src/lib/kernel/gateway.ts",
        old="""  const declared = definition.costModel.stepCeilingUsd?.[stepKey]""",
        new="""  const declared = undefined as number | undefined""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="声明零成本",
    ),
    # ── T3：花费必须是真实金额 ───────────────────────────────────────────
    dict(
        name="T3 拆掉应用层的金额校验（NaN / 负数直接进账本）",
        file="src/lib/kernel/gateway.ts",
        old="""        if (!isRealCostAmount(reported)) {""",
        new="""        if (false) {""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="不进账本",
    ),
    dict(
        name="T3 应用层只挡 NaN、不挡负数（负数能把已花金额减回来）",
        file="src/lib/kernel/gateway.ts",
        old="""  return typeof value === 'number' && Number.isFinite(value) && value >= 0""",
        new="""  return typeof value === 'number' && !Number.isNaN(value)""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="减回来",
    ),
    dict(
        name="T3 拆掉数据库那层的 CHECK 复刻（绕开应用直接写库就能污染账本）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (Number.isFinite(n) && n >= 0) return""",
        new="""    return""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="数据库拒绝",
    ),
    dict(
        name="T3 SQL 的 CHECK 只写 >= 0（numeric 里 NaN >= 0 是 true，拦不住）",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""      cost_actual_usd >= 0
      AND cost_actual_usd <> 'NaN'::numeric
      AND cost_actual_usd <  'Infinity'::numeric""",
        new="""      cost_actual_usd >= 0""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="NaN",
    ),
    # ── F1：stale-worker fencing（代际） ──────────────────────────────────
    dict(
        name="F1 步骤写入去掉代际守卫（过期执行者照样覆盖结果）",
        file="src/lib/kernel/store.ts",
        old="""    .eq('id', stepId)
    .eq('claim_generation', expectedGeneration)""",
        new="""    .eq('id', stepId)""",
        test="src/lib/kernel/__tests__/stale-worker-fencing.test.ts",
        expect_fail_contains="影响 0 行",
    ),
    dict(
        name="F1 run 写入去掉代际守卫（过期执行者能把 run 写成终态）",
        file="src/lib/kernel/store.ts",
        old="""    .eq('id', runId)
    .eq('claim_generation', expectedGeneration)""",
        new="""    .eq('id', runId)""",
        test="src/lib/kernel/__tests__/stale-worker-fencing.test.ts",
        expect_fail_contains="run 终态",
    ),
    dict(
        name="F1 兑换授权不再出示代际（过期执行者能把授权用掉）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (expectedGeneration !== null && Number(run.claim_generation ?? 0) !== expectedGeneration) {
      return no(`stale_generation:${String(run.claim_generation ?? 0)}`)
    }""",
        new="""    // mutated: 不再检查代际""",
        test="src/lib/kernel/__tests__/stale-worker-fencing.test.ts",
        expect_fail_contains="授权一个字没动",
    ),
    dict(
        name="F1 接管不换代（旧执行者醒来照样能写）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    const nextGen = Number(run.claim_generation ?? 0) + (changedHands ? 1 : 0)""",
        new="""    const nextGen = Number(run.claim_generation ?? 0)""",
        test="src/lib/kernel/__tests__/stale-worker-fencing.test.ts",
        expect_fail_contains="晚到写 step",
    ),
    dict(
        name="F1 接管不把新代际推到步骤上（旧 step 行还认旧代）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (changedHands) {
      for (const st of tableOf('action_run_steps')) {
        if (st.run_id !== run.id) continue
        st.claim_generation = nextGen
        st.updated_at = nowIso
      }
    }""",
        new="""    // mutated: 不推代际到步骤""",
        test="src/lib/kernel/__tests__/stale-worker-fencing.test.ts",
        expect_fail_contains="影响 0 行",
    ),
    dict(
        name="F1 接管 RPC 去掉代际 CAS（旧调用复活后能续租）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (expectedGeneration !== null && Number(run.claim_generation ?? 0) !== expectedGeneration) {
      return no(`stale_generation:${String(run.claim_generation ?? 0)}`, run)
    }""",
        new="""    // mutated: 不再检查代际""",
        test="src/lib/kernel/__tests__/stale-worker-fencing.test.ts",
        expect_fail_contains="续租",
    ),
    dict(
        name="F1 running 一律不可接管（崩在执行中就永远卡死）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (!['queued', 'authorizing', 'authorized', 'running'].includes(String(run.status))) {""",
        new="""    if (!['queued', 'authorizing', 'authorized'].includes(String(run.status))) {""",
        test="src/lib/kernel/__tests__/stale-worker-fencing.test.ts",
        expect_fail_contains="running 崩溃也能被接管",
    ),
    dict(
        name="F1 SQL 里 running 不在可接管白名单",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""  IF v_run.status NOT IN ('queued','authorizing','authorized','running') THEN""",
        new="""  IF v_run.status NOT IN ('queued','authorizing','authorized') THEN""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="白名单",
    ),
    dict(
        name="F1 幂等键带上 attempt（每次重试换一张收据）",
        file="src/lib/kernel/gateway.ts",
        old="""  return `${run.client_id}:${run.idempotency_key}:${stepKey}`""",
        new="""  return `${run.client_id}:${run.idempotency_key}:${stepKey}:${String(Math.random())}`""",
        test="src/lib/kernel/__tests__/stale-worker-fencing.test.ts",
        expect_fail_contains="同一把键",
    ),
    # ── T2b：成本硬上限 ──────────────────────────────────────────────────
    dict(
        name="T2b 预检不看每步声明的上限（退回只比累计值）",
        file="src/lib/kernel/gateway.ts",
        old="""  if (ceiling === null) {
    return {
      humanReason:
        `「${stepKey}」没有声明它最多会花多少钱，而这个动作声明了会花钱 —— ` +""",
        new="""  if (false) {
    return {
      humanReason:
        `「${stepKey}」没有声明它最多会花多少钱，而这个动作声明了会花钱 —— ` +""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="说不出上界",
    ),
    dict(
        name="T2b actual 超过声明上限也放行（声明退化成许愿）",
        file="src/lib/kernel/gateway.ts",
        old="""        if (declaredMax !== null && stepCostSoFar - declaredMax > COST_EPSILON) {""",
        new="""        if (false) {""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="契约违约",
    ),
    dict(
        name="T2b 上限按「每次尝试」算而不是「这一步总共」（重试 N 次能花 N 倍）",
        file="src/lib/kernel/gateway.ts",
        old="""        if (declaredMax !== null && stepCostSoFar - declaredMax > COST_EPSILON) {""",
        new="""        if (declaredMax !== null && cost - declaredMax > COST_EPSILON) {""",
        test="src/lib/kernel/__tests__/cost-persistence.test.ts",
        expect_fail_contains="顶破声明上限",
    ),
    dict(
        name="T2b 预检不扣掉这一步已经花掉的（断点续跑被误拦）",
        file="src/lib/kernel/gateway.ts",
        old="""  const ceiling = declaredMax === null ? null : Math.max(0, declaredMax - stepSpentSoFar)""",
        new="""  const ceiling = declaredMax""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="扣掉这一步已经花掉的",
    ),
    dict(
        name="T2b 声明值不校验合法性（NaN 上限能绕过整道闸）",
        file="src/lib/kernel/gateway.ts",
        old="""  const declared = definition.costModel.stepCeilingUsd?.[stepKey]
  if (isRealCostAmount(declared)) return declared""",
        new="""  const declared = definition.costModel.stepCeilingUsd?.[stepKey]
  if (typeof declared === 'number') return declared""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="声明的上限是 NaN",
    ),
    # ── T2c：上限本身的合法性 ────────────────────────────────────────────
    dict(
        name="T2c 应用层不校验上限本身（NaN 上限让三道闸同时失效）",
        file="src/lib/kernel/authorize.ts",
        old="""  if (!Number.isFinite(costCap) || costCap < 0) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="政策里的上限是 NaN",
    ),
    dict(
        name="T2c 应用层只挡负数不挡 NaN（`x > NaN` 恒假）",
        file="src/lib/kernel/authorize.ts",
        old="""  if (!Number.isFinite(costCap) || costCap < 0) {""",
        new="""  if (Number(costCap) < 0) {""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="NaN",
    ),
    dict(
        name="T2c 拆掉数据库那层的上限 CHECK 复刻",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      if (Number.isFinite(n) && n >= 0) continue""",
        new="""      continue""",
        test="src/lib/kernel/__tests__/budget-and-cost-validity.test.ts",
        expect_fail_contains="数据库拒绝",
    ),
    dict(
        name="T2c SQL 的上限 CHECK 只写 >= 0（numeric 里 NaN >= 0 是 true）",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""      spend_cap_per_run_usd >= 0
      AND spend_cap_per_run_usd <> 'NaN'::numeric
      AND spend_cap_per_run_usd <  'Infinity'::numeric))""",
        new="""      spend_cap_per_run_usd >= 0))""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="NaN",
    ),
]
