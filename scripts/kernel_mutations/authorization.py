"""K-WP01A 变异探针 · authorization / policy —— 授权闸、默认 deny、政策身份/版本/时间窗、人工批准重校验、装配与幂等重建

🔴 **只放探针定义，不放 runner。** 判定与执行在 `scripts/kernel-mutation-check.py`。
   拆分是因为原文件到了 2501 行 > 仓库铁律的 800 —— 拆的是**文件位置，
   不是探针**：名字、目标文件、替换内容、目标测试、以及**顺序**全部原样保留。

🔴 新增探针请加到对应主题模块里，并同步 `scripts/kernel_mutations/__init__.py`
   的 `EXPECTED_MODULES` —— 漏加载一个模块会让那一批**静静地不跑**而全绿。
"""

MUTATIONS = [
    dict(
        name="拆掉跨客户校验",
        file="src/lib/kernel/gateway.ts",
        old="""  if (decision.client_id !== ctx.clientId || decision.client_id !== run.client_id) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="在去领执行权之前**就被拒了",
    ),
    # ── P1-2：原子领取执行权 ─────────────────────────────────────────────
    dict(
        name="P1-2 执行权不再锁 run（退回「谁的决策谁兑换」）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (run.authorization_decision_id !== decisionId) return no('decision_not_current')""",
        new="""    // mutated: 不再检查这条决策是不是 run 当前那一份""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="第二份 allow 决策领不到执行权",
    ),
    dict(
        name="P1-2 run 状态不再是领取的前提（去掉 authorized 检查）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (run.status !== 'authorized') return no(`run_not_authorized:${String(run.status)}`)""",
        new="""    // mutated: 不再要求 run 停在 authorized""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="第二次拿到 already_consumed",
    ),
    dict(
        name="P1-2 提交撞唯一约束时不回读赢家（把正常竞争当故障抛出去）",
        file="src/lib/kernel/runner.ts",
        old="""    if (!(err instanceof UniqueViolationError)) throw err
    const winner = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)""",
        new="""    if (err instanceof UniqueViolationError) throw err
    const winner = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)""",
        test="src/lib/kernel/__tests__/concurrency.test.ts",
        expect_fail_contains="并发提交",
    ),
    dict(
        # 旧写法是「已存在的 run 一律 in_progress」；T1 之后改成「领不到租约才 in_progress」。
        # 要拆的闸变成了「领不到就别往下推进」。
        name="P1-2/T1 领不到租约也照样往下推进（两个执行者各签一份授权）",
        file="src/lib/kernel/runner.ts",
        old="""  if (!claim.ok) return outcomeForFailedClaim(deps, runId, claim.reason)""",
        new="""  if (false) return outcomeForFailedClaim(deps, runId, claim.reason)""",
        test="src/lib/kernel/__tests__/concurrency.test.ts",
        expect_fail_contains="四个调用同时提交也一样",
    ),
    # ── P1-1：人工批准重新校验 ───────────────────────────────────────────
    dict(
        # 🔴 判据已随 approveRun 迁到 human-approval.ts（模块拆分），锚点跟着搬。
        #    留在 authorize.ts 的话脚本会静默 SKIP —— 那道闸就等于没验过。
        name="P1-1 人工批准不再重跑授权闸",
        file="src/lib/kernel/human-approval.ts",
        old="""  const pf = await preflight(deps, run, now)
  if (!pf.ok) {""",
        new="""  const pf = await preflight(deps, run, now)
  if (false) {""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="挂起期间政策被删掉",
    ),
    dict(
        name="P1-1 人工批准不再要求政策仍是 require_approval",
        file="src/lib/kernel/human-approval.ts",
        old="""  if (policy.mode !== 'require_approval') {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="只有模式检查挡得住",
    ),
    dict(
        name="P1-1 人工批准不再比对政策版本",
        file="src/lib/kernel/human-approval.ts",
        old="""  if (policy.policy_version !== pending.policy_version) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="政策版本变了",
    ),
    dict(
        name="P1-1 找不到原审批请求也照签",
        file="src/lib/kernel/human-approval.ts",
        old="""  if (pending && pending.verdict === 'require_approval') return { ok: true, pending }""",
        new="""  if (true) return { ok: true, pending: pending as AuthorizationDecision }""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="当初那份审批请求找不到了",
    ),
    # ── P1-3：政策版本自动演进 ───────────────────────────────────────────
    dict(
        name="P1-3 政策改了不再自动 bump 版本",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""            r.policy_version = Number(before.policy_version ?? 1) + (changed ? 1 : 0)""",
        new="""            r.policy_version = Number(before.policy_version ?? 1)""",
        test="src/lib/kernel/__tests__/policy-version.test.ts",
        expect_fail_contains="政策版本自动演进",
    ),
    dict(
        name="P1-3 调用方自己传的 policy_version 说了算",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""            const changed = authFields.some((f) => before[f] !== r[f])""",
        new="""            const changed = false""",
        test="src/lib/kernel/__tests__/policy-version.test.ts",
        expect_fail_contains="版本归数据库管",
    ),
    dict(
        name="不再检查政策版本是否变过",
        file="src/lib/kernel/gateway.ts",
        old="""  if (decision.policy_version !== currentPolicy.policy_version) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="改了规则",
    ),
    dict(
        name="声明了验证却没验也算成功",
        file="src/lib/kernel/gateway.ts",
        old="""  if (definition.verification) {
    const v = verificationOf(steps)""",
        new="""  if (false) {
    const v = verificationOf(steps)""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="验证",
    ),
    dict(
        name="Gateway 直接信任传进来的 ctx，不回库重读",
        file="src/lib/kernel/gateway.ts",
        old="""  assertDecisionMatches({""",
        new="""  if (false) assertDecisionMatches({""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="伪造",
    ),
    dict(
        name="查不到政策时默认放行（把默认 deny 改成默认 allow）",
        file="src/lib/kernel/authorize.ts",
        old="""  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, now)
  const costEstimate = definition.costModel.estimate(run.input)
  if (!policy) {""",
        new="""  const policy = (await getActivePolicy(deps.supabase, run.client_id, run.action_key, now))
    ?? ({ id: 'mutant', client_id: run.client_id, action_key: run.action_key, mode: 'auto_approve',
          policy_version: 1, spend_cap_per_run_usd: 999, spend_cap_per_period_usd: null,
          spend_cap_period: null, decision_ttl_seconds: 900,
          effective_from: '2000-01-01T00:00:00.000Z', effective_to: null,
          updated_by: 'mutant' } as ClientAutomationPolicy)
  const costEstimate = definition.costModel.estimate(run.input)
  if (!policy) {""",
        test="src/lib/kernel/__tests__/authorization.test.ts",
        expect_fail_contains="默认 deny",
    ),
    dict(
        # 提交时那句 SELECT 现在只是优化 —— 真正的闸是数据库的唯一约束
        # 加上「撞了就回读赢家」。所以探针要拆的是约束本身。
        name="幂等的唯一约束没了（提交时的 SELECT 只是优化，不是闸）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""  action_runs: [['client_id', 'idempotency_key']],""",
        new="""  action_runs: [],""",
        test="src/lib/kernel/__tests__/concurrency.test.ts",
        expect_fail_contains="四个调用同时提交也一样",
    ),
    dict(
        name="读稿子时不再按客户过滤（4 轴身份少一轴）",
        file="src/lib/capabilities/seo/build-publish-package.ts",
        old="""    .eq('id', blogPostId)
    .eq('client_id', clientId)
    .limit(1)""",
        new="""    .eq('id', blogPostId)
    .limit(1)""",
        test="src/lib/kernel/__tests__/safe-capability.test.ts",
        expect_fail_contains="别的客户",
    ),
    dict(
        name="验证失败改成可重试",
        file="src/lib/kernel/gateway.ts",
        old="""            `这一步写完之后回头验，没验过：${result.verification.failure_reason ?? '未说明原因'}`,
            { detail: { stepKey, checks: result.verification.checks } },""",
        new="""            `这一步写完之后回头验，没验过：${result.verification.failure_reason ?? '未说明原因'}`,
            { retryable: true, detail: { stepKey, checks: result.verification.checks } },""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="验证",
    ),
    dict(
        name="未知动作不再落 deny 记录，静默跳过",
        file="src/lib/kernel/authorize.ts",
        old="""  const definition = deps.registry.get(run.action_key)
  if (!definition) {
    return bad(""",
        new="""  const definition = deps.registry.get(run.action_key)
  if (false) {
    return bad(""",
        test="src/lib/kernel/__tests__/authorization.test.ts",
        expect_fail_contains="未知动作",
    ),
    dict(
        name="步骤已成功也重跑（拆掉断点续跑）",
        file="src/lib/kernel/gateway.ts",
        old="""    if (step.status === 'succeeded') continue""",
        new="""    if (false) continue""",
        test="src/lib/kernel/__tests__/gateway.test.ts",
        expect_fail_contains="断点续跑",
    ),
    dict(
        # 🔴 注意这条**不是**打那句事后的 `spent > cap` 断言 —— 硬上限做完之后
        #    （remaining >= max 且 actual <= max ⇒ spent + actual <= cap），
        #    那句断言在正常路径上**不可达**，因此拿不到变异覆盖。这一点在
        #    PR 描述和 spec 里都明说了，不拿一条永远绿的探针冒充覆盖。
        #    真正该盯的是 spent 的累加：它喂的是**下一步的预检**。
        name="run 层不再累计已花金额（下一步的预检就瞎了）",
        file="src/lib/kernel/gateway.ts",
        old="""        spent += cost""",
        new="""        // mutated: 不再累计""",
        test="src/lib/kernel/__tests__/cost-persistence.test.ts",
        expect_fail_contains="装不进剩下的",
    ),
    dict(
        name="没建模的表返回空数组而不是抛错（假件退回旧毛病）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      throw new Error(
        `[fake-supabase] 测试没有为表「${name}」建模。要么它不该被查，要么这个测试少准备了数据。`,
      )""",
        new="""      tables[name] = []
      known.add(name)""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="假件本身",
    ),
    # ── C1：lineage 视图权限 ─────────────────────────────────────────────
    dict(
        name="C1 视图去掉 security_invoker（按 owner 权限读底表）",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""CREATE OR REPLACE VIEW public.kernel_action_lineage
WITH (security_invoker = true) AS""",
        new="""CREATE OR REPLACE VIEW public.kernel_action_lineage AS""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="security_invoker",
    ),
    dict(
        name="C1 视图去掉 REVOKE（anon 可经 Data API 读跨客户数据）",
        file="supabase/migrations/20260808000003_me2_execution_kernel_v1.sql",
        old="""REVOKE ALL ON public.kernel_action_lineage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.kernel_action_lineage TO service_role;""",
        new="""GRANT SELECT ON public.kernel_action_lineage TO service_role;""",
        test="src/lib/kernel/__tests__/architecture.test.ts",
        expect_fail_contains="REVOKE",
    ),
    # ── C2：政策身份 + 模式复核 ──────────────────────────────────────────
    dict(
        name="C2 Gateway 去掉政策行身份检查（删掉重建同版本号就放行）",
        file="src/lib/kernel/gateway.ts",
        old="""  if (decision.policy_id !== currentPolicy.id) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/policy-identity.test.ts",
        expect_fail_contains="删掉重建",
    ),
    dict(
        name="C2 Gateway 去掉模式复核（版本触发器失灵时没有最后防线）",
        file="src/lib/kernel/gateway.ts",
        old="""  if (decision.decided_by === 'policy' && currentPolicy.mode !== 'auto_approve') {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/policy-identity.test.ts",
        expect_fail_contains="模式复核",
    ),
    dict(
        name="C2 RPC 复刻去掉行身份检查",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (policy.id !== decision.policy_id) return no('policy_identity_changed')""",
        new="""    // mutated: 不再比对行身份""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="policy_identity_changed",
    ),
    dict(
        name="C2 RPC 复刻去掉模式复核",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (decision.decided_by === 'policy' && policy.mode !== 'auto_approve') return no('policy_mode_changed')""",
        new="""    // mutated: 机器签的授权不再复核当前模式""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="policy_mode_changed",
    ),
    # ── C3：可恢复 deny ─────────────────────────────────────────────────
    dict(
        name="C3 把 no_policy 从可恢复白名单里拿掉（配好政策也永远救不回来）",
        file="src/lib/kernel/runner.ts",
        # 🔴 锚点只取头两行 —— 清单会随新拒绝码增长，整段字面量当锚点必然失配，
        #    而失配是 SKIP：脚本不报错，那道闸却其实一次都没被验证过。
        old="""export const RECOVERABLE_DENY_CODES: ReadonlySet<string> = new Set([
  'no_policy',""",
        new="""export const RECOVERABLE_DENY_CODES: ReadonlySet<string> = new Set([
  'never_recoverable_placeholder',""",
        test="src/lib/kernel/__tests__/deny-recovery.test.ts",
        expect_fail_contains="恢复闭环",
    ),
    dict(
        name="C3 恢复不再区分「人明确拒过」（系统替人改主意）",
        file="src/lib/kernel/runner.ts",
        old="""  if (denyDecision.decided_by === 'human') {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/deny-recovery.test.ts",
        expect_fail_contains="不替人改主意",
    ),
    # ── C4：Goal 跨客户 ─────────────────────────────────────────────────
    dict(
        name="C4 应用层去掉 goal 归属检查（只剩数据库那层，错误形状变了）",
        file="src/lib/kernel/runner.ts",
        old="""    if (goal.client_id !== input.clientId) {""",
        new="""    if (false) {""",
        test="src/lib/kernel/__tests__/goal-ownership.test.ts",
        expect_fail_contains="应用层",
    ),
    dict(
        name="C4 假件去掉复合外键复刻（绕过应用直接 INSERT 畅通无阻）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""          if (table === 'action_runs' && row.goal_id) {""",
        new="""          if (false) {""",
        test="src/lib/kernel/__tests__/goal-ownership.test.ts",
        expect_fail_contains="数据库层",
    ),
    # ── C5：时间窗 ──────────────────────────────────────────────────────
    dict(
        name="C5 应用层退回 IS NULL-only（有限期政策被当成没配）",
        file="src/lib/kernel/store.ts",
        old="""export function isPolicyActive(policy: ClientAutomationPolicy, now: Date): boolean {
  if (Date.parse(policy.effective_from) > now.getTime()) return false
  if (policy.effective_to && Date.parse(policy.effective_to) <= now.getTime()) return false
  return true
}""",
        new="""export function isPolicyActive(policy: ClientAutomationPolicy, now: Date): boolean {
  if (Date.parse(policy.effective_from) > now.getTime()) return false
  if (policy.effective_to !== null && policy.effective_to !== undefined) return false
  return true
}""",
        test="src/lib/kernel/__tests__/policy-window.test.ts",
        expect_fail_contains="有结束时间且还没到期",
    ),
    dict(
        name="C5 RPC 复刻退回 IS NULL-only",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""          (p.effective_to === null || p.effective_to === undefined || String(p.effective_to) > nowStr),""",
        new="""          (p.effective_to === null || p.effective_to === undefined),""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="带结束时间",
    ),
    # ── R1(P1)：人工批准/拒绝的原子性 ────────────────────────────────────
    dict(
        name="R1 resolve 复刻去掉 status CAS（running 也能被批/拒覆盖）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (run.status !== 'pending_approval') return no(`not_pending:${String(run.status)}`)
    if (run.authorization_decision_id !== pendingId) return no('decision_not_current')""",
        new="""    if (run.authorization_decision_id !== pendingId) return no('decision_not_current')""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="status CAS",
    ),
    dict(
        name="R1 resolve 复刻去掉 current-decision CAS",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (run.authorization_decision_id !== pendingId) return no('decision_not_current')

    const pending = tableOf('authorization_decisions').find((d) => d.id === pendingId)""",
        new="""    const pending = tableOf('authorization_decisions').find((d) => d.id === pendingId)""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="run 已指向另一份审批请求",
    ),
    dict(
        name="R1 approveRun 的失败落地不再带状态守卫（迟到的批不了会覆盖赢家）",
        file="src/lib/kernel/authorize.ts",
        old="""    expectedStatus: args.onlyIfStatus ?? null,""",
        new="""    expectedStatus: null,""",
        test="src/lib/kernel/__tests__/approval-concurrency.test.ts",
        expect_fail_contains="失败落地守卫",
    ),
    # ── P2-1：reject 的应用层状态闸（跟 RPC 那道可区分） ─────────────────
    dict(
        name="P2-1 rejectRun 去掉应用层状态闸（只剩 RPC 那道，错误话术变了）",
        file="src/lib/kernel/human-approval.ts",
        old="""  if (run.status !== 'pending_approval') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在的状态是「${run.status}」，不是在等审批，不能拒绝（它可能已经被批准执行了）`,
    )
  }""",
        new="""  if (false) {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在的状态是「${run.status}」，不是在等审批，不能拒绝（它可能已经被批准执行了）`,
    )
  }""",
        test="src/lib/kernel/__tests__/approval-concurrency.test.ts",
        expect_fail_contains="第二次被明确拒掉",
    ),
    # ── P2-2：装配校验 ───────────────────────────────────────────────────
    dict(
        name="P2-2 去掉装配校验（v2 授权悄悄跑 v1 实现）",
        file="src/lib/kernel/gateway.ts",
        old="""  if (assembled) {
    if (assembled.actionKey !== definition.actionKey || assembled.version !== definition.version) {""",
        new="""  if (false) {
    if (assembled!.actionKey !== definition.actionKey || assembled!.version !== definition.version) {""",
        test="src/lib/kernel/__tests__/assembly-and-rehydration.test.ts",
        expect_fail_contains="装配校验",
    ),
    # ── P2-3：幂等重建 ───────────────────────────────────────────────────
    dict(
        name="P2-3 幂等命中退回返回 null 空壳",
        file="src/lib/kernel/runner.ts",
        old="""      execution: await rehydrateSucceededRun(deps, run),""",
        new="""      execution: {
        status: 'succeeded' as const,
        run,
        steps: await listSteps(deps.supabase, run.id),
        output: null,
        idempotentHit: true,
        verification: null,
      },""",
        test="src/lib/kernel/__tests__/assembly-and-rehydration.test.ts",
        expect_fail_contains="deepEqual result1",
    ),
    dict(
        name="P2-3 重建不再 fail closed（缺验证也当成功）",
        file="src/lib/kernel/gateway.ts",
        old="""  if (definition.verification && (!verification || !verification.passed)) {
    throw new KernelError(
      'INVALID_STATE',
      '这条执行标着成功，但存下来的验证记录缺失或未通过 —— 历史数据不一致',
      { detail: { runId: run.id } },
    )
  }""",
        new="""  if (false) {
    throw new KernelError(
      'INVALID_STATE',
      '这条执行标着成功，但存下来的验证记录缺失或未通过 —— 历史数据不一致',
      { detail: { runId: run.id } },
    )
  }""",
        test="src/lib/kernel/__tests__/assembly-and-rehydration.test.ts",
        expect_fail_contains="fail closed",
    ),
    # ── P2-4：时间窗过滤在截断之前 ───────────────────────────────────────
    dict(
        name="P2-4 getActivePolicy 退回「先 limit(20) 再内存过滤」",
        file="src/lib/kernel/store.ts",
        old="""  const nowIso = now.toISOString()
  const { data, error } = await sb
    .from(TABLE_POLICIES)
    .select(POLICY_COLUMNS)
    .eq('client_id', clientId)
    .eq('action_key', actionKey)
    .lte('effective_from', nowIso)
    .or(`effective_to.is.null,effective_to.gt.${nowIso}`)
    .order('effective_from', { ascending: false })
    .limit(1)
  if (error) fail('读取客户自动化政策', error)

  return ((data ?? [])[0] as unknown as ClientAutomationPolicy | undefined) ?? null""",
        new="""  const { data, error } = await sb
    .from(TABLE_POLICIES)
    .select(POLICY_COLUMNS)
    .eq('client_id', clientId)
    .eq('action_key', actionKey)
    .order('effective_from', { ascending: false })
    .limit(20)
  if (error) fail('读取客户自动化政策', error)

  const rows = (data ?? []) as unknown as ClientAutomationPolicy[]
  return rows.find((p) => isPolicyActive(p, now)) ?? null""",
        test="src/lib/kernel/__tests__/policy-window.test.ts",
        expect_fail_contains="25 条未来政策",
    ),
    dict(
        name="P2-4 假件的 .or 解析变成永真（过滤器变漏勺）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      case 'or':
        return orMatches(row, String(f.value))""",
        new="""      case 'or':
        return true""",
        test="src/lib/kernel/__tests__/policy-window.test.ts",
        expect_fail_contains="已到期的政策",
    ),
    # ── S1：恢复权原子领取 ───────────────────────────────────────────────
    dict(
        name="S1 恢复 RPC 去掉状态 CAS（running/succeeded 也能被拽回 queued）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (run.status !== kind) return no(`not_recoverable:${String(run.status)}`)""",
        new="""    // mutated: 不再要求 run 仍停在那个可恢复的终态""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="状态 CAS",
    ),
    dict(
        name="S1 恢复 RPC 去掉指针 CAS（拿过期决策也能恢复）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if ((run.authorization_decision_id ?? null) !== expected) return no('decision_not_current')""",
        new="""    // mutated: 不再比对 run 当前指着的是不是这条决策""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="指针 CAS",
    ),
    dict(
        name="S1 恢复 RPC 不再查可恢复白名单",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      if (!code || !RECOVERABLE_DENY_CODES.has(code)) {
        return no(`deny_code_not_recoverable:${code ?? 'null'}`)
      }""",
        new="""      if (false) {
        return no(`deny_code_not_recoverable:${code ?? 'null'}`)
      }""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="白名单在 RPC 里也强制",
    ),
    dict(
        name="S1 恢复 RPC 不再拦「人明确拒过的」",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      if (decision!.decided_by === 'human') return no('human_reject_not_recoverable')""",
        new="""      // mutated: 人拒过的也能被系统翻案""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="人明确拒过",
    ),
    dict(
        name="S1 恢复时把已花的钱一起抹掉（步骤重置顺手清 cost）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      st.status = 'pending'
      st.last_error = null""",
        new="""      st.status = 'pending'
      st.cost_actual_usd = 0
      st.last_error = null""",
        test="src/lib/kernel/__tests__/store.test.ts",
        expect_fail_contains="不碰已花的钱",
    ),
    dict(
        name="S1 恢复不走原子 RPC（退回 read → update）",
        file="src/lib/kernel/runner.ts",
        old="""  const claimed = await claimRunRecovery(deps.supabase, {
    runId,
    expectedDecisionId: run.authorization_decision_id,
    kind: 'denied',
    actor: recoveredByUser,
    reason,
  })
  if (!claimed.ok) throw recoveryFailureToError(claimed.reason, 'denied')""",
        new="""  await updateRun(deps.supabase, runId, {
    status: 'queued',
    needs_human: false,
    last_error: null,
    finished_at: null,
    authorization_decision_id: null,
    evidence: {
      ...(run.evidence ?? {}),
      last_recovered_by: recoveredByUser,
      last_recovered_at: deps.now().toISOString(),
      recovery_reason: reason,
      recovery_kind: 'denied',
      recovered_from_deny_code: denyDecision.deny_code,
    },
  })""",
        test="src/lib/kernel/__tests__/recovery-concurrency.test.ts",
        expect_fail_contains="并发恢复 denied",
    ),
    dict(
        name="S1 死信重跑不走原子 RPC（退回 read → update）",
        file="src/lib/kernel/runner.ts",
        old="""  const claimed = await claimRunRecovery(deps.supabase, {
    runId,
    expectedDecisionId: run.authorization_decision_id,
    kind: 'dead_letter',
    actor: resumedByUser,
    reason,
  })
  if (!claimed.ok) throw recoveryFailureToError(claimed.reason, 'dead_letter')""",
        new="""  const stepsToReset = await listSteps(deps.supabase, runId)
  for (const st of stepsToReset) {
    if (st.status === 'succeeded') continue
    await updateStep(deps.supabase, st.id, {
      status: 'pending', last_error: null, next_attempt_at: null, finished_at: null,
    })
  }
  await updateRun(deps.supabase, runId, {
    status: 'queued',
    needs_human: false,
    last_error: null,
    finished_at: null,
    authorization_decision_id: null,
    evidence: { ...(run.evidence ?? {}), last_recovered_by: resumedByUser, recovery_kind: 'dead_letter', recovery_reason: reason },
  })""",
        test="src/lib/kernel/__tests__/recovery-concurrency.test.ts",
        expect_fail_contains="并发恢复 dead_letter",
    ),
]
