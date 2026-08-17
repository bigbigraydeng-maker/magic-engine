"""K-WP01A 变异探针 · execution / fencing —— running 入口、deny 围栏、代际 fencing、转人工落库、续租、migration 版本撞车

🔴 **只放探针定义，不放 runner。** 判定与执行在 `scripts/kernel-mutation-check.py`。
   拆分是因为原文件到了 2501 行 > 仓库铁律的 800 —— 拆的是**文件位置，
   不是探针**：名字、目标文件、替换内容、目标测试、以及**顺序**全部原样保留。

🔴 新增探针请加到对应主题模块里，并同步 `scripts/kernel_mutations/__init__.py`
   的 `EXPECTED_MODULES` —— 漏加载一个模块会让那一批**静静地不跑**而全绿。
"""

MUTATIONS = [
    # ── 第八轮：running 入口 / deny 围栏 / 建步骤围栏 / 收费后抛错 / 复用复核 / 真终态 ──
    dict(
        name="R8-1 running 在进 takeover 之前就答 in_progress（接管入口形同虚设）",
        file="src/lib/kernel/runner.ts",
        old="""  // 🔴 `running` **不在这里早退**。""",
        new="""  if (run.status === 'running') {
    return { kind: 'in_progress', run, decision: null, execution: null, humanReason: '正在做' }
  }
  // 🔴 `running` **不在这里早退**。""",
        test="src/lib/kernel/__tests__/lease-takeover.test.ts",
        expect_fail_contains="必须**能被接走",
    ),
    dict(
        name="R8-2 落拒绝不带围栏（过期执行者能把 succeeded 改成 denied）",
        file="src/lib/kernel/authorize.ts",
        old="""    expectedGeneration: args.fence?.generation ?? null,""",
        new="""    expectedGeneration: null,""",
        test="src/lib/kernel/__tests__/fencing-gaps.test.ts",
        expect_fail_contains="只有 recordDeny 那道围栏能拦住它",
    ),
    dict(
        name="R8-2b 假件的 deny RPC 不验代际",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (expectedGen !== null && Number(run.claim_generation ?? 0) !== expectedGen) {
      return no(`stale_generation:${String(run.claim_generation ?? 0)}`)
    }
    // 跨客户：决策必须属于这条 run 的客户（跟 SQL 同一道闸）""",
        new="""    // 跨客户：决策必须属于这条 run 的客户（跟 SQL 同一道闸）""",
        test="src/lib/kernel/__tests__/fencing-gaps.test.ts",
        expect_fail_contains="落不了 deny",
    ),
    dict(
        name="R8-3 建步骤不验代际（旧执行者能插一批旧代际的行）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (run.client_id !== clientId) return no('cross_client')
    if (expectedGen !== null && Number(run.claim_generation ?? 0) !== expectedGen) {""",
        new="""    if (run.client_id !== clientId) return no('cross_client')
    if (false) {""",
        test="src/lib/kernel/__tests__/fencing-gaps.test.ts",
        expect_fail_contains="建步骤",
    ),
    dict(
        name="R8-3b 建步骤被 fence 时当成「没什么好建的」继续跑",
        file="src/lib/kernel/store.ts",
        old="""    if (String(row.reason).startsWith('stale_generation')) return null""",
        new="""    if (String(row.reason).startsWith('stale_generation')) return listSteps(sb, runId)""",
        test="src/lib/kernel/__tests__/fencing-gaps.test.ts",
        expect_fail_contains="拿到 null",
    ),
    dict(
        name="R8-4 抛错时不记 provider 已扣的钱（记 0 元然后重试）",
        file="src/lib/kernel/gateway.ts",
        old="""        const reportedOnError = reportedCostOf(err)""",
        new="""        const reportedOnError = undefined as unknown""",
        test="src/lib/kernel/__tests__/charged-then-threw.test.ts",
        expect_fail_contains="不是记 0 元",
    ),
    dict(
        name="R8-4b 收费步骤结果未知也照样自动重试（可能被重复收费）",
        file="src/lib/kernel/gateway.ts",
        old="""        const unsafeToRetry = paidStepWithoutIdempotency(definition, args.run, stepKey)""",
        new="""        const unsafeToRetry = false""",
        test="src/lib/kernel/__tests__/charged-then-threw.test.ts",
        expect_fail_contains="不自动重试",
    ),
    dict(
        name="R8-4c 幂等判据形同虚设（不管 provider 认不认幂等键都当成安全）",
        file="src/lib/kernel/gateway.ts",
        old="""  if (definition.providerIdempotency === 'supported') return false""",
        new="""  if (true) return false""",
        test="src/lib/kernel/__tests__/charged-then-threw.test.ts",
        expect_fail_contains="不自动重试",
    ),
    dict(
        # Codex P2（PR #898）：零成本的对外动作曾经靠 mightCost===false 绕开这道闸，
        # 跟内部动作一样被当成「安全」—— 但对外动作的重放风险是外部写入被再做一遍，
        # 不是钱，零成本救不了它。
        name="R8-4e 零成本的对外步骤不再受幂等闸保护（重放风险被当成钱来判）",
        file="src/lib/kernel/gateway.ts",
        old="""  if (definition.sideEffect === 'outward') return true""",
        new="""  if (false) return true""",
        test="src/lib/kernel/__tests__/outward-authorization.test.ts",
        expect_fail_contains="重放风险跟钱无关",
    ),
    dict(
        name="R8-4d 这一步自己的预算花完了还能再跑一次",
        file="src/lib/kernel/gateway.ts",
        old="""  if (declaredMax! > COST_EPSILON && ceiling <= COST_EPSILON) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/charged-then-threw.test.ts",
        expect_fail_contains="重跑不许再突破",
    ),
    dict(
        name="R8-5 复用旧授权前不复核政策（卡到 TTL 到期）",
        file="src/lib/kernel/authorize.ts",
        old="""  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, deps.now())
  if (!policy) return null
  if (policy.id !== decision.policy_id) return null
  if (policy.policy_version !== decision.policy_version) return null""",
        new="""  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, deps.now())
  void policy""",
        test="src/lib/kernel/__tests__/fencing-gaps.test.ts",
        expect_fail_contains="不复用旧授权",
    ),
    dict(
        name="R8-5b 复用时不复核模式（auto→require_approval 也照跑）",
        file="src/lib/kernel/authorize.ts",
        old="""  if (!modeStillMatches) return null""",
        new="""  void modeStillMatches""",
        test="src/lib/kernel/__tests__/fencing-gaps.test.ts",
        expect_fail_contains="等人点头",
    ),
    dict(
        name="R8-6 领不到租约一律答 in_progress（终态也说成「正在做」）",
        file="src/lib/kernel/runner.ts",
        old="""  if (reason.startsWith('already_owned')) {""",
        new="""  if (true) {""",
        test="src/lib/kernel/__tests__/fencing-gaps.test.ts",
        expect_fail_contains="返回死信原因",
    ),
    # ── 第八轮复审补的四道闸 ──────────────────────────────────────────────
    dict(
        name="R9-1 预检退回「每个步骤只判一次」（重试循环绕过硬上限）",
        file="src/lib/kernel/gateway.ts",
        old="""      const budgetBlock = nextStepBlockedByBudget(
        definition, args.run, ctx.costCapUsd, spent, stepKey, stepCostSoFar,
      )""",
        new="""      const budgetBlock = attempt === firstAttemptNumber
        ? nextStepBlockedByBudget(definition, args.run, ctx.costCapUsd, spent, stepKey, stepCostSoFar)
        : null""",
        test="src/lib/kernel/__tests__/charged-then-threw.test.ts",
        expect_fail_contains="重试循环里也守硬上限",
    ),
    dict(
        name="R9-2 建步骤被 fence 掉时不抛（gateway 那三行没了）",
        file="src/lib/kernel/gateway.ts",
        old="""  if (!steps) {
    throw new KernelError(
      'STALE_CLAIM',""",
        new="""  if (false) {
    throw new KernelError(
      'STALE_CLAIM',""",
        test="src/lib/kernel/__tests__/fencing-gaps.test.ts",
        expect_fail_contains="挡住它的必须是 ensureSteps 那道闸",
    ),
    dict(
        name="R9-3 接管 running 直接重跑（跟 UNSAFE_RETRY 自相矛盾）",
        file="src/lib/kernel/runner.ts",
        old="""  if (claim.resetSteps) {
    const blocked = await parkTakeoverForHuman(deps, owned, claim.claimGeneration)
    if (blocked) return blocked
  }""",
        new="""  if (false) {
    void parkTakeoverForHuman
  }""",
        test="src/lib/kernel/__tests__/charged-then-threw.test.ts",
        expect_fail_contains="不自动重跑",
    ),
    dict(
        # Codex P2（PR #898）：接管保护跟 gateway 那道重试闸用的是同一个成本判据，
        # 零成本的对外动作曾经一样能绕开它（`!mightCost` 直接放行接管重跑）。
        name="R9-3b 接管保护对零成本的对外动作失效（跟成本闸同一个洞）",
        file="src/lib/kernel/runner.ts",
        old="""  if (!isOutward && !mightCost) return null""",
        new="""  void isOutward
  if (!mightCost) return null""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="「零成本」豁免",
    ),
    dict(
        name="R9-4 落拒绝不挡跨客户（审计表里能写串台的决策）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (d.client_id !== run.client_id) return no('cross_client')""",
        new="""    // mutated: 不挡跨客户""",
        test="src/lib/kernel/__tests__/fencing-gaps.test.ts",
        expect_fail_contains="跨客户",
    ),
    # ── R10：转人工要落库 / 续租 / 参数转发 / 待办不许假装可操作 ──────────
    dict(
        name="R10-1 转人工只返回不落库（安全假象：租约一过期又能自动跑）",
        file="src/lib/kernel/runner.ts",
        old="""  const parked = await parkRunForHuman(deps.supabase, {""",
        new="""  const parked = { ok: true, reason: 'skipped' }
  await Promise.resolve({""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="真的是 dead_letter",
    ),
    dict(
        name="R10-1b 落人工终态时不验代际（旧执行者能把新 owner 的 run 钉死）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (expectedGen !== null && Number(run.claim_generation ?? 0) !== expectedGen) {
      return { ok: false, reason: `stale_generation:${String(run.claim_generation ?? 0)}` }
    }

    const nowIso = (options.now?.() ?? new Date()).toISOString()
    const previousStatus = String(run.status)""",
        new="""    const nowIso = (options.now?.() ?? new Date()).toISOString()
    const previousStatus = String(run.status)""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="用过期的代际去落人工终态",
    ),
    dict(
        name="R10-1c 转人工时不清租约（留下一个还能被自动推进的 owner）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    run.finished_at = nowIso
    run.claimed_by = null
    run.claimed_at = null
    run.heartbeat_at = null
    run.lease_expires_at = null
    run.evidence = {
      ...((run.evidence ?? {}) as Row),
      [key]: {""",
        new="""    run.finished_at = nowIso
    run.evidence = {
      ...((run.evidence ?? {}) as Row),
      [key]: {""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="真的是 dead_letter",
    ),
    dict(
        name="R10-2 handler 跑着的时候不续租（第二代会把它再调一遍）",
        file="src/lib/kernel/gateway.ts",
        old="""        heartbeat = startLeaseHeartbeat(deps, args.run.id, fence)""",
        new="""        heartbeat = { stop: () => {}, lostReason: () => null }""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="心跳把租约续上",
    ),
    dict(
        name="R10-2b 续租不验 owner（别人的 run 也能被我续）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (run.claimed_by !== ownerId) {
      return { ok: false, reason: `not_owner:${String(run.claimed_by ?? '<none>')}` }
    }""",
        new="""    // mutated: 不验 owner""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="四项 CAS 各自单独可咬",
    ),
    dict(
        name="R10-2c 业务副作用的唯一兜底没了（两代各插一条包）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""  production_packages: [['source_payload->>kernel_run_id']],""",
        new="""""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="同一条 run 只可能落一个包",
    ),
    dict(
        name="R10-2d SQL 里的部分唯一索引没了",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""CREATE UNIQUE INDEX IF NOT EXISTS uq_production_packages_kernel_run""",
        new="""CREATE INDEX IF NOT EXISTS uq_production_packages_kernel_run""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="业务副作用",
    ),
    dict(
        name="R10-3 createKernel 又把租约参数吞掉",
        file="src/lib/kernel/index.ts",
        old="""    leaseSeconds: overrides.leaseSeconds,
    ownerId: overrides.ownerId,""",
        new="""""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="真的改变行为",
    ),
    dict(
        name="R10-4 待办又开始指向不存在的审批入口",
        file="src/lib/kernel/handoff.ts",
        old="""      href: '',
    }
  }""",
        new="""      href,
    }
  }""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="没有假链接",
    ),
    dict(
        name="R10-4b 待办渲染器又无条件画出「去做这件事」按钮",
        file="src/app/dashboard/today/page.tsx",
        old="""                    {m.href ? (""",
        new="""                    {true ? (""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="不许画出一个点了没反应的按钮",
    ),
    dict(
        name="R10-5 handler 返回后不复核所有权（人工终态会被覆盖成 succeeded）",
        file="src/lib/kernel/gateway.ts",
        old="""        await assertStillOwner(deps, args.run.id, fence, heartbeat.lostReason())""",
        new="""        void heartbeat""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="被转人工",
    ),
    dict(
        name="R10-5b 只比代际、不比 owner（转人工/恢复清 owner 时拦不住）",
        file="src/lib/kernel/gateway.ts",
        old="""  if (Number(run.claim_generation) !== fence.generation || run.claimed_by !== fence.ownerId) {""",
        new="""  if (Number(run.claim_generation) !== fence.generation) {""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="被转人工",
    ),
    dict(
        name="R10-6 空 href 又被当成「链接坏了」丢掉（发现死在 console.warn 里）",
        file="src/lib/pm-todo/manual-items.ts",
        old="""      it.href.trim() === ''
        ? Promise.resolve({ kind: 'unverifiable' as const })
        : verifyActionLink(it.href, fetchImpl).catch(() => ({ kind: 'unverifiable' as const })),""",
        new="""      verifyActionLink(it.href, fetchImpl).catch(() => ({ kind: 'unverifiable' as const })),""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="这条待办还在",
    ),
    dict(
        name="R10-7 park 的 SQL 不清租约",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""         claimed_by       = NULL,
         claimed_at       = NULL,
         heartbeat_at     = NULL,
         lease_expires_at = NULL,
         evidence         = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
           p_evidence_key, jsonb_build_object(""",
        new="""         evidence         = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
           p_evidence_key, jsonb_build_object(""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="业务副作用",
    ),
    dict(
        name="R10-7b park 的 SQL 不验代际",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""  IF p_expected_generation IS NOT NULL
     AND v_run.claim_generation IS DISTINCT FROM p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text; RETURN;
  END IF;

  UPDATE public.action_runs
     SET status           = 'dead_letter',""",
        new="""  UPDATE public.action_runs
     SET status           = 'dead_letter',""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="业务副作用",
    ),
    # ── P1-4：migration 版本撞车 ─────────────────────────────────────────
    dict(
        name="P1-4 新起一个跟别人同号的 migration",
        rename=(
            "supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
            # 20260806000001 已经被 execution_auto_run_tracking 占了
            "supabase/migrations/20260806000001_me2_execution_kernel_v1.sql",
        ),
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="没有两个文件用同一个版本号",
    ),
    # ── R11-1：失去执行权之后连「落死信」都不许写 ────────────────────────
    dict(
        # 只删这一句，其它闸原样保留：写入围栏只比代际，而 park 清 owner 不换代际，
        # 所以旧执行者的 writeStep / failRun 照写不误，会把人工处置的原话冲掉。
        name="R11-1 handler 正常返回这条路不复核所有权（把结果当成自己的提交）",
        file="src/lib/kernel/gateway.ts",
        old="""        await assertStillOwner(deps, args.run.id, fence, heartbeat.lostReason())
        const reported = result.costActualUsd ?? 0""",
        new="""        const reported = result.costActualUsd ?? 0""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="handler 跑着的时候这条 run 被转人工",
    ),
    dict(
        # 同一个覆盖的另一条分支：handler 抛错时绕过「返回之后那句复核」。
        # 只补正常返回那条路 = 没补 —— 这个探针就是盯着别再只补一半。
        name="R11-2 handler 抛错这条路不复核所有权（覆盖人工处置的原话）",
        file="src/lib/kernel/gateway.ts",
        old="""        await assertStillOwner(deps, args.run.id, fence, heartbeat?.lostReason() ?? null)

        lastError = err""",
        new="""        lastError = err""",
        test="src/lib/kernel/__tests__/park-and-heartbeat.test.ts",
        expect_fail_contains="转人工之后 handler 抛错",
    ),
]
