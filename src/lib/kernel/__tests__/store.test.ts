/**
 * 数据访问层的两条硬性质，外加对**假件本身**的自检。
 *
 * 这个文件是变异验证逼出来的：第一轮变异把 `consumeDecision` 的
 * `.is('consumed_at', null)` 拆掉之后，13 个测试**全绿** ——
 * 因为重放在更早的一道闸（`assertDecisionMatches` 看 consumed_at）就被拦了，
 * 原子兑换那一句其实没有任何测试盯着。它防的是**并发**：
 * 两个 worker 同时读到「还没被兑换」，必须只有一个能兑换成功。
 *
 * 同一轮还发现：假件里「没建模的表就抛错」那道保险自己没有测试。
 * 那道保险是整套测试可信度的地基 —— 它一松，「查错了表名」就会
 * 长得跟「这张表是空的」一模一样，正是生产上让一个 bug 活了两个月的形状。
 */

import { describe, it, expect } from 'vitest'
import {
  beginAuthorizedRun,
  claimRunRecovery,
  getActivePolicy,
  insertDecision,
  listSteps,
  resolvePendingApproval,
} from '../store'
import { createFakeSupabase, type Row } from './fake-supabase'
import { CLIENT_A } from './fixtures'

const RUN_ID = 'run-1'
/** 冻结时钟 —— 跟 fixtures 同一原则：时间只能有一个来源，不然测试是定时炸弹。 */
const FROZEN = new Date('2026-08-08T02:00:00.000Z')

function seed(overrides: { policy?: Row | null; run?: Partial<Row> } = {}) {
  const tables = {
    action_runs: [
      {
        id: RUN_ID,
        client_id: CLIENT_A,
        action_key: 'seo.build_publish_package',
        action_version: 1,
        idempotency_key: 'k',
        status: 'authorized',
        authorization_decision_id: null,
        started_at: null,
        last_error: null,
        ...(overrides.run ?? {}),
      } as Row,
    ],
    authorization_decisions: [] as Row[],
    action_run_steps: [] as Row[],
    client_automation_policies:
      overrides.policy === null
        ? []
        : [
            {
              id: 'policy-1',
              client_id: CLIENT_A,
              action_key: 'seo.build_publish_package',
              mode: 'auto_approve',
              policy_version: 1,
              spend_cap_per_run_usd: 0,
              spend_cap_per_period_usd: null,
              spend_cap_period: null,
              decision_ttl_seconds: 900,
              effective_from: '2020-01-01T00:00:00.000Z',
              effective_to: null,
              updated_by: 'test',
              ...(overrides.policy ?? {}),
            } as Row,
          ],
  }
  return { tables, sb: createFakeSupabase(tables, { now: () => FROZEN }) }
}

async function seedDecision(
  sb: ReturnType<typeof createFakeSupabase>,
  tables: { action_runs: Row[] },
  over: Partial<Row> = {},
) {
  const d = await insertDecision(sb, {
    action_run_id: RUN_ID,
    client_id: CLIENT_A,
    action_key: 'seo.build_publish_package',
    action_version: 1,
    verdict: 'allow',
    deny_code: null,
    reason: '测试',
    policy_snapshot: {},
    policy_id: 'policy-1',
    policy_version: 1,
    decided_by: 'policy',
    decided_by_user: null,
    cost_cap_usd: 0,
    cost_estimate_usd: 0,
    idempotency_key: 'k',
    expires_at: null,
    ...(over as Record<string, never>),
  })
  tables.action_runs[0].authorization_decision_id = d.id
  return d
}

describe('原子领取执行权（P1-2）', () => {
  it('第一次领到，第二次拿到 already_consumed —— 而不是抛数据库错误', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)

    const first = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'worker-1')
    expect(first).toEqual({ ok: true, reason: 'ok' })
    expect(tables.action_runs[0].status).toBe('running')
    expect(tables.authorization_decisions[0].consumed_by).toBe('worker-1')

    const second = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'worker-2')
    expect(second.ok).toBe(false)
    // run 已经不在 authorized 了 —— 这才是「执行权只有一个」的真正判据
    expect(second.reason).toMatch(/run_not_authorized/)
  })

  it('🔴 两个 worker 同时领取 → 只有一个赢', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)

    const results = await Promise.all([
      beginAuthorizedRun(sb, RUN_ID, decision.id, 'worker-1'),
      beginAuthorizedRun(sb, RUN_ID, decision.id, 'worker-2'),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('🔴 同一个 run 的第二份 allow 决策领不到执行权（兑换的是执行权，不是决策）', async () => {
    const { sb, tables } = seed()
    const first = await seedDecision(sb, tables)
    // 又签了一份（模拟两个调用方各签一条）。run 现在指着第二份。
    const second = await seedDecision(sb, tables)
    expect(second.id).not.toBe(first.id)

    // 旧那份哪怕 verdict='allow' 且没被消费过，也领不到
    const stale = await beginAuthorizedRun(sb, RUN_ID, first.id, 'worker-1')
    expect(stale).toEqual({ ok: false, reason: 'decision_not_current' })
    expect(tables.action_runs[0].status).toBe('authorized')

    const current = await beginAuthorizedRun(sb, RUN_ID, second.id, 'worker-2')
    expect(current.ok).toBe(true)
  })

  it('🔴 政策被删掉 → 领不到（不是「没版本号所以随便过」）', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)
    tables.client_automation_policies.length = 0

    const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
    expect(r).toEqual({ ok: false, reason: 'no_active_policy' })
    expect(tables.action_runs[0].status).toBe('authorized')
  })

  it('政策版本变了 → 领不到', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)
    tables.client_automation_policies[0].policy_version = 2

    const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
    expect(r).toEqual({ ok: false, reason: 'stale_policy_version' })
  })

  it('🔴 政策删掉又重建（新行、同版本号）→ 领不到：policy_identity_changed（C2）', async () => {
    // 「auto v1 → 删掉 → 重建一条 v1」：版本号完全一样，只有行身份分得开。
    // 只查版本号的话这条路整个是敞开的。
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)
    tables.client_automation_policies[0] = {
      ...tables.client_automation_policies[0],
      id: 'policy-2-rebuilt', // 新行
      policy_version: 1, // 版本号跟旧行一样
    }

    const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
    expect(r).toEqual({ ok: false, reason: 'policy_identity_changed' })
    expect(tables.action_runs[0].status).toBe('authorized')
  })

  it('🔴 模式变了但行和版本都没变（触发器失灵的形状）→ 领不到：policy_mode_changed（C2）', async () => {
    // 直接改内存行、绕过 .update()（也就绕过了版本触发器的复刻）——
    // 模拟「版本触发器失灵」。模式复核是它失灵时的最后防线，必须自己能咬人。
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)
    tables.client_automation_policies[0].mode = 'deny'

    const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
    expect(r).toEqual({ ok: false, reason: 'policy_mode_changed' })
  })

  it('人签的授权，政策模式后来改成「自动」→ 也领不到（human allow 只在仍要人审时有效）', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables, {
      decided_by: 'human',
      decided_by_user: 'ray@magiclab',
    })
    tables.client_automation_policies[0].mode = 'auto_approve'
    // 机器路径的前提：政策此刻是 auto —— 但这条授权是人按「要审批」签的
    const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
    expect(r).toEqual({ ok: false, reason: 'policy_mode_changed' })
  })

  it('带结束时间但还没到期的政策一样生效 → 正常领到（C5）', async () => {
    // 夹具时钟冻结在 2026-08-08T02:00 —— 结束时间设在两小时后
    const { sb, tables } = seed({
      policy: { effective_to: '2026-08-08T04:00:00.000Z' },
    })
    const decision = await seedDecision(sb, tables)

    const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
    expect(r).toEqual({ ok: true, reason: 'ok' })
  })

  it('结束时间已过 → 当成没有政策：no_active_policy（C5）', async () => {
    const { sb, tables } = seed({
      policy: { effective_to: '2026-08-08T01:00:00.000Z' },
    })
    const decision = await seedDecision(sb, tables)

    const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
    expect(r).toEqual({ ok: false, reason: 'no_active_policy' })
  })

  it('跨客户 / 版本不符 / 幂等键不符 都领不到', async () => {
    for (const [over, reason] of [
      [{ client_id: 'client-other' }, 'cross_client'],
      [{ action_version: 2 }, 'action_version_mismatch'],
      [{ idempotency_key: 'other' }, 'idempotency_mismatch'],
    ] as Array<[Partial<Row>, string]>) {
      const { sb, tables } = seed()
      const decision = await seedDecision(sb, tables, over)
      const r = await beginAuthorizedRun(sb, RUN_ID, decision.id, 'w')
      expect(r).toEqual({ ok: false, reason })
    }
  })
})

describe('resolve RPC 的两道 CAS 各自能咬人（R1）', () => {
  // 🔴 在「两人赛跑」里这两道闸互为影子：A 赢了之后 status 和指针**都**变了，
  //    拆掉任意一道另一道照样拦住 —— 端到端测试测不出单独哪道在。
  //    所以这里直接对 RPC 造「只有那一道能拦」的库状态。

  async function seedPending(sb: ReturnType<typeof createFakeSupabase>, tables: { action_runs: Row[] }) {
    const pending = await insertDecision(sb, {
      action_run_id: RUN_ID,
      client_id: CLIENT_A,
      action_key: 'seo.build_publish_package',
      action_version: 1,
      verdict: 'require_approval',
      deny_code: null,
      reason: '要你点头',
      policy_snapshot: {},
      policy_id: 'policy-1',
      policy_version: 1,
      decided_by: 'policy',
      decided_by_user: null,
      cost_cap_usd: 0,
      cost_estimate_usd: 0,
      idempotency_key: 'k',
      expires_at: null,
    })
    tables.action_runs[0].status = 'pending_approval'
    tables.action_runs[0].authorization_decision_id = pending.id
    return pending
  }

  it('🔴 status CAS：指针没动、只有状态被推进（running）→ not_pending', async () => {
    const { sb, tables } = seed({ policy: { mode: 'require_approval' } })
    const pending = await seedPending(sb, tables)
    // 只动状态、不动指针 —— 只有 status CAS 能拦
    tables.action_runs[0].status = 'running'

    const r = await resolvePendingApproval(sb, {
      runId: RUN_ID,
      pendingDecisionId: String(pending.id),
      resolution: 'approve',
      resolvedBy: 'ray@magiclab',
      reason: '同意',
      policySnapshot: {},
      costEstimateUsd: 0,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not_pending:running')
    // 状态没被覆盖
    expect(tables.action_runs[0].status).toBe('running')
  })

  it('🔴 status CAS：succeeded 也一样拦（reject 同理）', async () => {
    const { sb, tables } = seed({ policy: { mode: 'require_approval' } })
    const pending = await seedPending(sb, tables)
    tables.action_runs[0].status = 'succeeded'

    const r = await resolvePendingApproval(sb, {
      runId: RUN_ID,
      pendingDecisionId: String(pending.id),
      resolution: 'reject',
      resolvedBy: 'ray@magiclab',
      reason: '不做',
      policySnapshot: {},
      costEstimateUsd: 0,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not_pending:succeeded')
    expect(tables.action_runs[0].status).toBe('succeeded')
  })

  it('🔴 decision CAS：状态还在 pending、但 run 已指向另一份审批请求 → decision_not_current', async () => {
    const { sb, tables } = seed({ policy: { mode: 'require_approval' } })
    const stale = await seedPending(sb, tables)
    // 又签了一份新的审批请求，run 改指新那份 —— 状态仍是 pending_approval。
    // 拿旧页面上的过期请求来批，只有 decision CAS 能拦。
    const fresh = await seedPending(sb, tables)
    expect(tables.action_runs[0].authorization_decision_id).toBe(fresh.id)
    expect(tables.action_runs[0].status).toBe('pending_approval')

    const r = await resolvePendingApproval(sb, {
      runId: RUN_ID,
      pendingDecisionId: String(stale.id),
      resolution: 'approve',
      resolvedBy: 'ray@magiclab',
      reason: '同意',
      policySnapshot: {},
      costEstimateUsd: 0,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('decision_not_current')
    // 新那份照常能批
    const ok = await resolvePendingApproval(sb, {
      runId: RUN_ID,
      pendingDecisionId: String(fresh.id),
      resolution: 'approve',
      resolvedBy: 'ray@magiclab',
      reason: '同意',
      policySnapshot: {},
      costEstimateUsd: 0,
    })
    expect(ok.ok).toBe(true)
  })
})

describe('恢复权 RPC 的两道 CAS 各自能咬人（S1）', () => {
  // 🔴 跟 resolve 那两道一样：在真实赛跑里，赢家把 status 和指针**都**改了
  //    （status→queued、指针→null），拆掉任一道另一道照样拦 ——
  //    端到端并发测试测不出单独哪道在。所以这里直接造「只有那一道能拦」的库状态。

  async function seedDenied(sb: ReturnType<typeof createFakeSupabase>, tables: { action_runs: Row[] }) {
    const deny = await insertDecision(sb, {
      action_run_id: RUN_ID,
      client_id: CLIENT_A,
      action_key: 'seo.build_publish_package',
      action_version: 1,
      verdict: 'deny',
      deny_code: 'no_policy',
      reason: '这个客户还没配规则',
      policy_snapshot: {},
      policy_id: null,
      policy_version: null,
      decided_by: 'policy',
      decided_by_user: null,
      cost_cap_usd: null,
      cost_estimate_usd: null,
      idempotency_key: 'k',
      expires_at: null,
    })
    tables.action_runs[0].status = 'denied'
    tables.action_runs[0].authorization_decision_id = deny.id
    return deny
  }

  const claim = (sb: ReturnType<typeof createFakeSupabase>, expected: string | null, kind: 'denied' | 'dead_letter' = 'denied') =>
    claimRunRecovery(sb, {
      runId: RUN_ID,
      expectedDecisionId: expected,
      kind,
      actor: 'ray@magiclab',
      reason: '恢复',
    })

  it('✅ 状态和指针都对 → 领到恢复权，run 回到 queued、指针清空', async () => {
    const { sb, tables } = seed()
    const deny = await seedDenied(sb, tables)

    const r = await claim(sb, String(deny.id))
    expect(r).toEqual({ ok: true, reason: 'claimed' })
    expect(tables.action_runs[0].status).toBe('queued')
    expect(tables.action_runs[0].authorization_decision_id).toBeNull()
  })

  it('🔴 状态 CAS：指针没动、只有状态被推进（running）→ not_recoverable', async () => {
    const { sb, tables } = seed()
    const deny = await seedDenied(sb, tables)
    tables.action_runs[0].status = 'running' // 只动状态

    const r = await claim(sb, String(deny.id))
    expect(r).toEqual({ ok: false, reason: 'not_recoverable:running' })
    expect(tables.action_runs[0].status).toBe('running')
  })

  it('🔴 状态 CAS：succeeded 也一样拦', async () => {
    const { sb, tables } = seed()
    const deny = await seedDenied(sb, tables)
    tables.action_runs[0].status = 'succeeded'

    const r = await claim(sb, String(deny.id))
    expect(r).toEqual({ ok: false, reason: 'not_recoverable:succeeded' })
  })

  it('🔴 指针 CAS：状态还是 denied、但指针已换成另一条决策 → decision_not_current', async () => {
    const { sb, tables } = seed()
    const stale = await seedDenied(sb, tables)
    const fresh = await seedDenied(sb, tables) // 指针改指新那条，状态仍是 denied
    expect(tables.action_runs[0].authorization_decision_id).toBe(fresh.id)
    expect(tables.action_runs[0].status).toBe('denied')

    const r = await claim(sb, String(stale.id))
    expect(r).toEqual({ ok: false, reason: 'decision_not_current' })
    expect(tables.action_runs[0].status).toBe('denied')
  })

  it('🔴 白名单在 RPC 里也强制：不可恢复的拒绝码领不到', async () => {
    const { sb, tables } = seed()
    const deny = await insertDecision(sb, {
      action_run_id: RUN_ID,
      client_id: CLIENT_A,
      action_key: 'seo.build_publish_package',
      action_version: 1,
      verdict: 'deny',
      deny_code: 'invalid_input',
      reason: '参数不对',
      policy_snapshot: {},
      policy_id: null,
      policy_version: null,
      decided_by: 'policy',
      decided_by_user: null,
      cost_cap_usd: null,
      cost_estimate_usd: null,
      idempotency_key: 'k',
      expires_at: null,
    })
    tables.action_runs[0].status = 'denied'
    tables.action_runs[0].authorization_decision_id = deny.id

    const r = await claim(sb, String(deny.id))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('deny_code_not_recoverable:invalid_input')
  })

  it('🔴 人明确拒过的，RPC 层也不许恢复（不只靠应用层那句话）', async () => {
    const { sb, tables } = seed()
    const deny = await insertDecision(sb, {
      action_run_id: RUN_ID,
      client_id: CLIENT_A,
      action_key: 'seo.build_publish_package',
      action_version: 1,
      verdict: 'deny',
      // 白名单里的码，唯一的区别是这条是人点的
      deny_code: 'policy_deny',
      reason: 'ray 点了不做',
      policy_snapshot: {},
      policy_id: null,
      policy_version: null,
      decided_by: 'human',
      decided_by_user: 'ray@magiclab',
      cost_cap_usd: null,
      cost_estimate_usd: null,
      idempotency_key: 'k',
      expires_at: null,
    })
    tables.action_runs[0].status = 'denied'
    tables.action_runs[0].authorization_decision_id = deny.id

    const r = await claim(sb, String(deny.id))
    expect(r).toEqual({ ok: false, reason: 'human_reject_not_recoverable' })
  })

  it('🔴 步骤重置跟状态转换在同一个函数里，且**不碰已花的钱**', async () => {
    const { sb, tables } = seed()
    const deny = await seedDenied(sb, tables)
    tables.action_runs[0].status = 'dead_letter'
    tables.action_run_steps.push(
      { id: 'st-1', run_id: RUN_ID, client_id: CLIENT_A, step_key: 'a', step_index: 0,
        status: 'succeeded', attempt: 1, cost_actual_usd: 1.5, output: { a: 1 }, verification: null,
        last_error: null, next_attempt_at: null, finished_at: 'x' },
      { id: 'st-2', run_id: RUN_ID, client_id: CLIENT_A, step_key: 'b', step_index: 1,
        status: 'dead_letter', attempt: 2, cost_actual_usd: 0.75, output: {}, verification: null,
        last_error: '炸了', next_attempt_at: null, finished_at: 'y' },
    )

    const r = await claimRunRecovery(sb, {
      runId: RUN_ID,
      expectedDecisionId: String(deny.id),
      kind: 'dead_letter',
      actor: 'ray@magiclab',
      reason: '修好了',
    })
    expect(r.ok).toBe(true)

    const a = tables.action_run_steps.find((s) => s.id === 'st-1')!
    const b = tables.action_run_steps.find((s) => s.id === 'st-2')!
    // 成功的那步原样保留
    expect(a.status).toBe('succeeded')
    expect(a.cost_actual_usd).toBe(1.5)
    // 没跑成的那步放回待跑，但**已经花掉的钱不许被抹掉**
    expect(b.status).toBe('pending')
    expect(b.last_error).toBeNull()
    expect(b.cost_actual_usd).toBe(0.75)
    // 状态转换也在同一次调用里完成 —— 不留「步骤放回了但 run 还是死信」的半恢复态
    expect(tables.action_runs[0].status).toBe('queued')
  })
})

describe('读失败一律抛错，绝不 return []', () => {
  it('读政策炸了 → 抛错，不当成「这个客户没配政策」', async () => {
    const tables = { client_automation_policies: [] }
    const sb = createFakeSupabase(tables, {
      failOn: [{ table: 'client_automation_policies', op: 'select', message: 'connection reset' }],
    })
    // 「没配政策」和「读不到政策」都会导致不放行，但只有前者该说
    // 「去给这个客户设一条规则」，后者该说「库出问题了」。合并成一条
    // return null，就等于把一次数据库抖动伪装成一个业务结论。
    await expect(getActivePolicy(sb, CLIENT_A, 'x', new Date())).rejects.toThrow(/connection reset/)
  })

  it('读步骤炸了 → 抛错，不当成「这个 run 没有步骤」', async () => {
    const tables = { action_run_steps: [] }
    const sb = createFakeSupabase(tables, {
      failOn: [{ table: 'action_run_steps', op: 'select', message: 'timeout' }],
    })
    await expect(listSteps(sb, 'run-1')).rejects.toThrow(/timeout/)
  })
})

describe('假件本身的保险：没建模的表必须炸', () => {
  it('查一张测试没建模的表 → 抛错，不返回空数组', async () => {
    const sb = createFakeSupabase({ action_runs: [] })
    // 🔴 如果这里返回 []，那么「写错表名」「表还没建」「表是空的」
    //    在测试里就是同一个现象 —— 这套测试的结论也就一文不值了。
    await expect(sb.from('table_that_does_not_exist').select('*')).rejects.toThrow(/没有为表/)
  })

  it('调一个没建模的 RPC → 抛错', async () => {
    const sb = createFakeSupabase({ action_runs: [] })
    await expect(sb.rpc('some_other_rpc', {})).rejects.toThrow(/没有建模的 RPC/)
  })

  it('唯一约束是真的：同客户同幂等键插两次 → 第二次报冲突', async () => {
    const tables = { action_runs: [] as Array<Record<string, unknown>> }
    const sb = createFakeSupabase(tables)
    const row = { client_id: CLIENT_A, idempotency_key: 'same', action_key: 'x', purpose: 'growth' }

    const first = await sb.from('action_runs').insert(row).select('id')
    expect(first.error).toBeNull()

    const second = await sb.from('action_runs').insert(row).select('id')
    expect(second.error?.message).toMatch(/duplicate key/)
    expect(tables.action_runs).toHaveLength(1)
  })

  it('append-only 是真的：改授权记录的正文会被拒绝', async () => {
    const { sb, tables } = seed()
    const decision = await seedDecision(sb, tables)

    const bad = await sb
      .from('authorization_decisions')
      .update({ verdict: 'allow', reason: '偷偷改成放行' })
      .eq('id', decision.id)
      .select('id')

    expect(bad.error?.message).toMatch(/append-only/)
    expect(tables.authorization_decisions[0].reason).toBe('测试')
  })
})
