#!/usr/bin/env python3
"""变异验证：逐个破坏一道闸，跑指定测试，确认它**真的红**，然后还原。

绿的测试和有效的测试是两回事。这个脚本产出的是后者的证据。
"""
import subprocess, sys, shutil, os, json

ROOT = os.getcwd()

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
        name="P1-1 人工批准不再重跑授权闸",
        file="src/lib/kernel/authorize.ts",
        old="""  const pf = await preflight(deps, run, now)
  if (!pf.ok) {
    return recordDeny(deps, {
      run,
      definition: pf.definition,
      policy: pf.policy,
      code: pf.code,
      reason: `${approvedByUser} 点了同意，但这条现在已经不能做了：${pf.reason}`,
      costEstimate: pf.costEstimate,
      onlyIfStatus: 'pending_approval',
    })
  }""",
        new="""  const pf = await preflight(deps, run, now)
  if (false) {
    return recordDeny(deps, {
      run,
      definition: pf.definition,
      policy: (pf as { policy?: unknown }).policy as never,
      code: 'no_policy',
      reason: `${approvedByUser}`,
      costEstimate: null,
      onlyIfStatus: 'pending_approval',
    })
  }""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="挂起期间政策被删掉",
    ),
    dict(
        name="P1-1 人工批准不再要求政策仍是 require_approval",
        file="src/lib/kernel/authorize.ts",
        old="""  if (policy.mode !== 'require_approval') {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="只有模式检查挡得住",
    ),
    dict(
        name="P1-1 人工批准不再比对政策版本",
        file="src/lib/kernel/authorize.ts",
        old="""  if (policy.policy_version !== pending.policy_version) {""",
        new="""  if (false) {""",
        test="src/lib/kernel/__tests__/human-approval.test.ts",
        expect_fail_contains="政策版本变了",
    ),
    dict(
        name="P1-1 找不到原审批请求也照签",
        file="src/lib/kernel/authorize.ts",
        old="""  if (!pending || pending.verdict !== 'require_approval') {""",
        new="""  if (false) {""",
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
        name="C3 把可恢复白名单清空（配好政策也永远救不回来）",
        file="src/lib/kernel/runner.ts",
        old="""export const RECOVERABLE_DENY_CODES: ReadonlySet<string> = new Set([
  'no_policy',
  'policy_expired',
  'policy_changed_since_request',
  'over_cost_cap',
])""",
        new="""export const RECOVERABLE_DENY_CODES: ReadonlySet<string> = new Set([])""",
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
        file="src/lib/kernel/authorize.ts",
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
        old="""      if (!code || !RECOVERABLE.includes(code)) {
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
        name="R8-4c 把 not_applicable 也当成「保证幂等」（契约自相矛盾时最乐观）",
        file="src/lib/kernel/gateway.ts",
        old="""  return definition.providerIdempotency !== 'supported'""",
        new="""  return definition.providerIdempotency === 'unsupported' ? false : false""",
        test="src/lib/kernel/__tests__/charged-then-threw.test.ts",
        expect_fail_contains="不自动重试",
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


def run_test(path):
    r = subprocess.run(
        ["npx", "vitest", "run", path, "--reporter=basic"],
        capture_output=True, text=True, cwd=ROOT,
    )
    return r.returncode, r.stdout + r.stderr


def judge(m, code, out):
    """判定一次变异到底有没有被**想验的那道闸**抓住。

    🔴 早先这里只看 `code != 0` —— 「CAUGHT」的真实含义只是
    「那个测试文件里有东西红了」，不是「我想验的那道闸红了」。
    测试文件一大（十几二十个用例），随便哪条附带地红一下就算过，
    等于把变异验证降级成了「跑一下试试」。

    现在 `expect_fail_contains` 是**强制**的：写了就必须有一条红掉的用例名
    包含它；红了但不是那一条 → WRONG_TEST，跟 MISSED 一样算没通过。
    留空表示「这条变异会牵连一大片，不指定具体用例」——那是刻意的例外，
    要在探针里写清楚为什么。
    """
    names = [l.strip() for l in out.splitlines() if l.strip().startswith("×")]
    if code == 0:
        return (m["name"], "MISSED", "测试全绿 —— 这道闸没有被任何测试盯着")
    want = m.get("expect_fail_contains", "")
    if want and not any(want in n for n in names):
        return (
            m["name"],
            "WRONG_TEST",
            f"红了，但红的不是想验的那条（期望名字里含「{want}」）：" + "; ".join(names[:4]),
        )
    return (m["name"], "CAUGHT", "; ".join(names[:4]))


def main():
    results = []
    for m in MUTATIONS:
        # 改名型变异：P1-4 防的是文件名撞车，破坏点不在代码里
        if "rename" in m:
            src, dst = m["rename"]
            os.rename(src, dst)
            try:
                results.append(judge(m, *run_test(m["test"])))
            finally:
                os.rename(dst, src)
            continue

        f = m["file"]
        original = open(f, encoding="utf-8").read()
        if m["old"] not in original:
            results.append((m["name"], "SKIP", "锚点没匹配上（代码改过了，变异脚本要跟着更新）"))
            continue
        mutated = original.replace(m["old"], m["new"], 1)
        # 有些变异要同时动两处（比如「把两条语句调个个儿」= 从这儿删、到那儿加）
        if "old2" in m:
            if m["old2"] not in mutated:
                results.append((m["name"], "SKIP", "第二个锚点没匹配上（变异脚本要跟着更新）"))
                continue
            mutated = mutated.replace(m["old2"], m["new2"], 1)
        open(f, "w", encoding="utf-8").write(mutated)
        try:
            results.append(judge(m, *run_test(m["test"])))
        finally:
            open(f, "w", encoding="utf-8").write(original)

    print(json.dumps(results, ensure_ascii=False, indent=2))
    missed = [r for r in results if r[1] != "CAUGHT"]
    print(f"\n总计 {len(results)} 个变异，抓住 {len(results)-len(missed)} 个，漏掉 {len(missed)} 个")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())
