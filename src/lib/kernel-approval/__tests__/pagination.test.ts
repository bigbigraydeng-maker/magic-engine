/**
 * K-WP01A 回归闸 · **列表的分页与读取**。
 *
 * 要防的是**饿死**和**静默截断**：
 *   · 等得最久的排最前 —— 按「最新优先」截断的话，产生快过处理时最老那几条
 *     永远挤在名额之外，而界面看起来完全正常；
 *   · `hasMore` / 游标 —— 截断绝不许是静默的；
 *   · 用 keyset 游标不用 offset —— 待审批是活队列，翻页期间前面的条目被处理掉，
 *     offset 会整体左移、跳掉紧接着的那几条。
 */

import { describe, it, expect } from 'vitest'
import { CLIENT_A, CLIENT_B } from '@/lib/kernel/__tests__/fixtures'
import { listPendingApprovals } from '../service'
import {
  clampPageSize,
  listPendingRunsForClient,
  PENDING_APPROVAL_MAX_PAGE_SIZE,
  PENDING_APPROVAL_PAGE_SIZE,
} from '../queries'
import { KEY, pendingFixture, seededRunId } from './_fixtures'


// ── P2-4 ─────────────────────────────────────────────────────────────────────

/** 直接往表里塞 N 条等审批的 run + 对应决策（不走 Kernel，快且可控时间戳）。 */
function seedPending(f: Awaited<ReturnType<typeof pendingFixture>>['f'], count: number) {
  f.tables.action_runs.length = 0
  f.tables.authorization_decisions.length = 0
  for (let i = 0; i < count; i++) {
    const runId = seededRunId(i)
    const decisionId = `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    f.tables.authorization_decisions.push({
      id: decisionId,
      action_run_id: runId,
      client_id: CLIENT_A,
      // 🔴 身份三件套必须跟 run 一致 —— 读路径判据要逐条比它们。
      //    种子数据缺一条，这一整批就会被正确地判成「错挂」而不进列表。
      action_key: KEY,
      action_version: 1,
      idempotency_key: `idem-${i}`,
      verdict: 'require_approval',
      reason: `第 ${i} 条`,
      policy_id: '901c0000-0000-4000-8000-000000000001',
      policy_version: 1,
      created_at: '2026-08-01T00:00:00.000Z',
    })
    f.tables.action_runs.push({
      id: runId,
      client_id: CLIENT_A,
      purpose: 'growth',
      goal_id: null,
      action_key: KEY,
      action_version: 1,
      idempotency_key: `idem-${i}`,
      input: {},
      rationale: null,
      evidence: {},
      status: 'pending_approval',
      authorization_decision_id: decisionId,
      cost_cap_usd: 0,
      cost_estimate_usd: 0,
      // 🔴 i 越小时间越早 = 等得越久
      updated_at: `2026-08-0${1 + Math.floor(i / 100)}T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
      created_at: '2026-08-01T00:00:00.000Z',
    })
  }
}

describe('🔴 Codex P2-4 · 列表截断不许静默，等得最久的排最前', () => {
  it('条数没超过一页 → hasMore 是 false', async () => {
    const { f } = await pendingFixture()
    seedPending(f, 3)
    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(page.items).toHaveLength(3)
    expect(page.hasMore).toBe(false)
  })

  it('🔴 超过一页 → hasMore 是 true（截断被说出来了，不是静静少给）', async () => {
    const { f } = await pendingFixture()
    seedPending(f, PENDING_APPROVAL_PAGE_SIZE + 7)
    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(page.items).toHaveLength(PENDING_APPROVAL_PAGE_SIZE)
    expect(page.hasMore, '截断了却说 hasMore=false，界面会当成「就这么多」').toBe(true)
    expect(page.limit).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(page.nextCursor, '还有后续就必须给游标').toBeTruthy()
  })

  it('🔴 等得最久的排最前 —— 新的挤不掉老的（防饿死）', async () => {
    const { f } = await pendingFixture()
    seedPending(f, PENDING_APPROVAL_PAGE_SIZE + 7)
    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(page.items[0].runId, '第一条必须是等得最久的那一条').toBe(seededRunId(0))
    expect(page.items[1].runId).toBe(seededRunId(1))
    // 🔴 被截掉的必须是**最新的**那几条，不是最老的
    expect(page.items.map((i) => i.runId)).not.toContain(seededRunId(56))
  })

  it('🔴 排序真的按「先时间、平手再 id」—— 主键不许被第二排序键顶掉', async () => {
    // 🔴 这条盯的是**假件的多列排序建模**，不是业务逻辑。
    //    `.order()` 如果只保留最后一次调用，`updated_at` 主键就会被 `id` 顶掉，
    //    于是上面那条「等得最久排最前」的用例在时间与 id 同向时**恰好也能过**，
    //    而排序判据其实整个失效了 —— 实测有一条变异探针因此完全抓不住。
    //    这里让时间与 id **反向**：只有主键真的生效才排得对。
    const { f } = await pendingFixture()
    f.tables.action_runs.length = 0
    f.tables.authorization_decisions.length = 0
    const order = [
      { id: '40000000-0000-4000-8000-0000000000zz'.replace('zz','ff'), updated_at: '2026-08-01T00:00:00.000Z' }, // 最老 → 应排第一
      { id: '40000000-0000-4000-8000-0000000000aa', updated_at: '2026-08-09T00:00:00.000Z' }, // 最新 → 应排最后
    ]
    for (const { id, updated_at } of order) {
      f.tables.authorization_decisions.push({
        id: `dec-${id}`,
        action_run_id: id,
        client_id: CLIENT_A,
        // 🔴 身份三件套必须跟 run 一致 —— 读路径判据要逐条比
        action_key: KEY,
        action_version: 1,
        idempotency_key: `idem-${id}`,
        verdict: 'require_approval',
        reason: '',
        policy_id: '901c0000-0000-4000-8000-000000000001',
        policy_version: 1,
        created_at: updated_at,
      })
      f.tables.action_runs.push({
        id,
        client_id: CLIENT_A,
        purpose: 'growth',
        idempotency_key: `idem-${id}`,
        goal_id: null,
        action_key: KEY,
        action_version: 1,
        input: {},
        rationale: null,
        evidence: {},
        status: 'pending_approval',
        authorization_decision_id: `dec-${id}`,
        cost_cap_usd: 0,
        cost_estimate_usd: 0,
        updated_at,
        created_at: updated_at,
      })
    }

    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(
      page.items.map((i) => i.runId),
      '排序必须由 updated_at 说了算 —— 按 id 排的话 …aa 会跑到前面',
    ).toEqual([
      '40000000-0000-4000-8000-0000000000ff',
      '40000000-0000-4000-8000-0000000000aa',
    ])
  })

  it('🔴 时间戳撞在一起时，id 作为第二排序键给出稳定总序（翻页不跳条的前提）', async () => {
    const { f } = await pendingFixture()
    f.tables.action_runs.length = 0
    f.tables.authorization_decisions.length = 0
    const SAME_TIME = '2026-08-05T00:00:00.000Z'
    for (const id of [
      '40000000-0000-4000-8000-0000000000c0',
      '40000000-0000-4000-8000-0000000000a0',
      '40000000-0000-4000-8000-0000000000b0',
    ]) {
      f.tables.authorization_decisions.push({
        id: `dec-${id}`,
        action_run_id: id,
        client_id: CLIENT_A,
        // 🔴 身份三件套必须跟 run 一致 —— 读路径判据要逐条比
        action_key: KEY,
        action_version: 1,
        idempotency_key: `idem-${id}`,
        verdict: 'require_approval',
        reason: '',
        policy_id: '901c0000-0000-4000-8000-000000000001',
        policy_version: 1,
        created_at: SAME_TIME,
      })
      f.tables.action_runs.push({
        id,
        client_id: CLIENT_A,
        purpose: 'growth',
        idempotency_key: `idem-${id}`,
        goal_id: null,
        action_key: KEY,
        action_version: 1,
        input: {},
        rationale: null,
        evidence: {},
        status: 'pending_approval',
        authorization_decision_id: `dec-${id}`,
        cost_cap_usd: 0,
        cost_estimate_usd: 0,
        updated_at: SAME_TIME,
        created_at: SAME_TIME,
      })
    }
    const page = await listPendingApprovals(f.supabase, CLIENT_A)
    expect(page.items.map((i) => i.runId)).toEqual([
      '40000000-0000-4000-8000-0000000000a0',
      '40000000-0000-4000-8000-0000000000b0',
      '40000000-0000-4000-8000-0000000000c0',
    ])
  })

  it('🔴 游标能真的翻到后面去，而且不跳条不重条', async () => {
    const { f } = await pendingFixture()
    const total = 25
    seedPending(f, total)
    const first = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 10 })
    const second = await listPendingApprovals(f.supabase, CLIENT_A, {
      limit: 10,
      cursor: first.nextCursor,
    })
    const third = await listPendingApprovals(f.supabase, CLIENT_A, {
      limit: 10,
      cursor: second.nextCursor,
    })

    expect(first.items).toHaveLength(10)
    expect(first.hasMore).toBe(true)
    expect(second.items).toHaveLength(10)
    expect(second.hasMore).toBe(true)
    expect(third.items).toHaveLength(5)
    expect(third.hasMore, '最后一页不许再说「后面还有」').toBe(false)
    expect(third.nextCursor, '没有下一页就不许给游标').toBeNull()

    const seen = [...first.items, ...second.items, ...third.items].map((i) => i.runId)
    expect(new Set(seen).size, '翻完三页不许有重复').toBe(total)
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => seededRunId(i)))
  })

  it('🔴 翻页期间第一页那些被处理掉 → 第二页仍然不跳条（offset 会跳，游标不会）', async () => {
    // 🔴 这条就是 offset 分页挂掉的那个形状：待审批是**活的**队列，
    //    第一页那 10 条被别人处理掉之后，结果集整体左移；
    //    `offset=10` 会从缩短后的集合再跳过 10 行 —— 紧接着的第 11~20 条
    //    一条都不会被返回，而调用方毫不知情。
    //    游标是按**值**定位的（「排在 (t,id) 之后的那些」），位移根本不存在。
    const { f } = await pendingFixture()
    const total = 25
    seedPending(f, total)

    const first = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 10 })
    expect(first.items.map((i) => i.runId)).toEqual(
      Array.from({ length: 10 }, (_, i) => seededRunId(i)),
    )

    // 第一页那 10 条全被处理掉了（退出 pending_approval 过滤集）
    const donePage = new Set(first.items.map((i) => i.runId))
    for (const run of f.tables.action_runs) {
      if (donePage.has(String(run.id))) run.status = 'authorized'
    }

    const second = await listPendingApprovals(f.supabase, CLIENT_A, {
      limit: 10,
      cursor: first.nextCursor,
    })
    expect(
      second.items.map((i) => i.runId),
      '第二页必须紧接着第一页 —— 一条都不许被跳过',
    ).toEqual(Array.from({ length: 10 }, (_, i) => seededRunId(i + 10)))
  })

  it('🔴 游标读不成就当没给（当成某个位置会跳条）', async () => {
    const { f } = await pendingFixture()
    seedPending(f, 5)
    for (const cursor of ['', 'garbage', '|', 'not-a-date|' + seededRunId(0), '2026-08-01T00:00:00.000Z|not-a-uuid', 42, null, {}]) {
      const page = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 3, cursor })
      expect(page.items[0]?.runId, `游标「${String(cursor)}」应当被忽略并从头给`).toBe(seededRunId(0))
    }
  })

  it('🔴 已经翻过去的行不许倒回来（游标的两段必须是「与」，不是各管各的）', async () => {
    // 🔴 这条专门区分一种**看起来等价**的写坏法：把
    //      `updated_at.gt.T , and(updated_at.eq.T , id.gt.I)`
    //    退化成两个各自独立的条件（例如假件把嵌套 and 按逗号劈开）。
    //    时间与 id 同向时两者结果一样 —— 所以光有前面那些用例抓不住。
    //    这里让**时间早的那一行 id 反而更大**：退化版的 `id > I` 会把
    //    一条**早就翻过去的**行重新捞回来，而正确的下一行永远出不来。
    const { f } = await pendingFixture()
    f.tables.action_runs.length = 0
    f.tables.authorization_decisions.length = 0
    const rows = [
      { id: '40000000-0000-4000-8000-0000000000ff', at: '2026-08-01T00:00:00.000Z' }, // 最老，id 最大
      { id: '40000000-0000-4000-8000-0000000000aa', at: '2026-08-02T00:00:00.000Z' },
      { id: '40000000-0000-4000-8000-0000000000bb', at: '2026-08-03T00:00:00.000Z' },
    ]
    rows.forEach(({ id, at }, i) => {
      const decisionId = `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      f.tables.authorization_decisions.push({
        id: decisionId,
        action_run_id: id,
        client_id: CLIENT_A,
        // 🔴 身份三件套必须跟 run 一致 —— 读路径判据要逐条比
        action_key: KEY,
        action_version: 1,
        idempotency_key: `idem-${id}`,
        verdict: 'require_approval',
        reason: '',
        policy_id: '901c0000-0000-4000-8000-000000000001',
        policy_version: 1,
        created_at: at,
      })
      f.tables.action_runs.push({
        id,
        client_id: CLIENT_A,
        purpose: 'growth',
        idempotency_key: `idem-${id}`,
        goal_id: null,
        action_key: KEY,
        action_version: 1,
        input: {},
        rationale: null,
        evidence: {},
        status: 'pending_approval',
        authorization_decision_id: decisionId,
        cost_cap_usd: 0,
        cost_estimate_usd: 0,
        updated_at: at,
        created_at: at,
      })
    })

    const p1 = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 1 })
    expect(p1.items.map((i) => i.runId)).toEqual([rows[0].id])

    const p2 = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 1, cursor: p1.nextCursor })
    expect(p2.items.map((i) => i.runId)).toEqual([rows[1].id])

    const p3 = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 1, cursor: p2.nextCursor })
    expect(
      p3.items.map((i) => i.runId),
      '第三页必须是第三行 —— 不许把已经翻过去的第一行倒回来',
    ).toEqual([rows[2].id])

    const seen = [...p1.items, ...p2.items, ...p3.items].map((i) => i.runId)
    expect(new Set(seen).size, '翻完不许有重复').toBe(3)
  })

  it('🔴 时间戳撞在一起时游标不整批跳过同伴（第二段 and(...) 不能省）', async () => {
    const { f } = await pendingFixture()
    f.tables.action_runs.length = 0
    f.tables.authorization_decisions.length = 0
    const SAME = '2026-08-05T00:00:00.000Z'
    for (let i = 0; i < 4; i++) {
      const id = seededRunId(i)
      f.tables.authorization_decisions.push({
        id: `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        action_run_id: id,
        client_id: CLIENT_A,
        // 🔴 身份三件套必须跟 run 一致 —— 读路径判据要逐条比
        action_key: KEY,
        action_version: 1,
        idempotency_key: `idem-${id}`,
        verdict: 'require_approval',
        reason: '',
        policy_id: '901c0000-0000-4000-8000-000000000001',
        policy_version: 1,
        created_at: SAME,
      })
      f.tables.action_runs.push({
        id,
        client_id: CLIENT_A,
        purpose: 'growth',
        idempotency_key: `idem-${id}`,
        goal_id: null,
        action_key: KEY,
        action_version: 1,
        input: {},
        rationale: null,
        evidence: {},
        status: 'pending_approval',
        authorization_decision_id: `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        cost_cap_usd: 0,
        cost_estimate_usd: 0,
        updated_at: SAME,
        created_at: SAME,
      })
    }
    const first = await listPendingApprovals(f.supabase, CLIENT_A, { limit: 2 })
    const second = await listPendingApprovals(f.supabase, CLIENT_A, {
      limit: 2,
      cursor: first.nextCursor,
    })
    expect(first.items.map((i) => i.runId)).toEqual([seededRunId(0), seededRunId(1)])
    expect(
      second.items.map((i) => i.runId),
      '只比时间的话，撞在游标那一刻的同伴会被整批跳过',
    ).toEqual([seededRunId(2), seededRunId(3)])
  })

  it('页大小夹在 [1, MAX]，给的不是正整数就用默认值（不当成无上限）', () => {
    expect(clampPageSize(undefined)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(0)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(-5)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(Number.NaN)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize('abc')).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(Number.POSITIVE_INFINITY)).toBe(PENDING_APPROVAL_PAGE_SIZE)
    expect(clampPageSize(7)).toBe(7)
    expect(clampPageSize(10_000)).toBe(PENDING_APPROVAL_MAX_PAGE_SIZE)
  })

  it('🔴 分页查询照样只看这一个客户', async () => {
    const { f } = await pendingFixture()
    seedPending(f, 5)
    const page = await listPendingRunsForClient(f.supabase, CLIENT_B, { limit: 10 })
    expect(page.runs).toEqual([])
    expect(page.hasMore).toBe(false)
  })
})
