/**
 * 第十轮 —— Codex review 7 的四条。
 *
 * P1-1  接管付费 running 之后的「转人工」必须**真的落库**，不能只返回一个内存值；
 * P1-2  handler 跑着的时候要续租，否则第二代会在它还在跑的时候把它再调一遍；
 * P2-2  `createKernel` 的 `leaseSeconds` / `ownerId` 必须真的转发下去。
 *
 * 🔴 贯穿这三条的同一个教训：**「返回值对」和「库里状态对」是两件事。**
 *    只断言返回值的测试会让一道装饰性的闸看起来在干活。
 */

import { describe, it, expect, vi } from 'vitest'
import type { ActionDefinition, CapabilityImplementation, CapabilityStepResult } from '../types'
import { runAction, submitActionRun } from '../runner'
import { createKernel } from '../index'
import { claimOrTakeoverRun, parkRunForHuman, renewLease } from '../store'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A } from './fixtures'
import { createFakeSupabase } from './fake-supabase'

const KEY = 'seo.build_publish_package'
const LEASE = 60
const T0 = '2026-08-08T02:00:00.000Z'

/** 会花钱、而且 provider **不保证**幂等重放的动作 —— 就是不敢自动重跑的那一类。 */
function paidUnsafeDefinition(over: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    actionKey: KEY,
    version: 1,
    title: '会花钱且供应商不保证幂等的动作',
    inputSchema: { type: 'object', required: ['n'], properties: { n: { type: 'string' } }, additionalProperties: false },
    outputSchema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } }, additionalProperties: true },
    capability: 'test',
    risk: 'low',
    sideEffect: 'internal_write',
    reversible: true,
    idempotency: { keyFields: ['n'], scope: 'client' },
    costModel: { kind: 'fixed', estimate: () => 1, stepCeilingUsd: { a: 1 } },
    providerIdempotency: 'unsupported',
    retryPolicy: { maxAttempts: 1, backoff: 'fixed', baseMs: 1 },
    verification: null,
    requiredCapabilityTier: 'paid_client',
    steps: ['a'],
    allowedPurposes: ['growth'],
    ...over,
  } as ActionDefinition
}

const submit = () => ({
  clientId: CLIENT_A,
  actionKey: KEY,
  purpose: 'growth' as const,
  goalId: GOAL_A,
  triggeredBy: 'agent' as const,
  input: { n: 'one' },
})

const policy = (cap: number) => ({ action_key: KEY, mode: 'auto_approve', spend_cap_per_run_usd: cap })

function paidFixture(handler: () => Promise<CapabilityStepResult>, calls: () => void) {
  return makeFixture({
    registry: makeRegistry([paidUnsafeDefinition()]),
    capabilities: () => ({
      [KEY]: {
        actionKey: KEY as never,
        version: 1,
        steps: {
          a: async () => {
            calls()
            return handler()
          },
        } as never,
      } as CapabilityImplementation,
    }),
    options: { policy: policy(10) },
    startAt: T0,
    leaseSeconds: LEASE,
  })
}
type F = ReturnType<typeof paidFixture>
const runRow = (f: F) => f.tables.action_runs[0]
const advancePastLease = (f: F) => {
  f.clock.now = new Date(f.clock.now.getTime() + (LEASE + 1) * 1000)
}

describe('P1-1 · 接管付费 running → 转人工必须真的落库', () => {
  /** 把库摆成「上一个执行者崩在 handler 中途」：running + 租约已过期。 */
  async function crashedMidFlight(f: F) {
    const { run } = await submitActionRun(f.kernel, submit())
    await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'dead-worker#1', leaseSeconds: LEASE,
    })
    const row = runRow(f)
    row.status = 'running'
    advancePastLease(f)
    return run.id
  }

  it('🔴 ① 数据库里真的是 dead_letter + needs_human，不只是返回值', async () => {
    const calls = vi.fn()
    const f = paidFixture(async () => ({ output: { done: true }, costActualUsd: 1 }), calls)
    const runId = await crashedMidFlight(f)

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('dead_letter')
    // 🔴 关键：落库了，不是内存里的安全假象
    const row = runRow(f)
    expect(row.id).toBe(runId)
    expect(row.status).toBe('dead_letter')
    expect(row.needs_human).toBe(true)
    expect(String(row.last_error)).toContain('不敢自动重跑')
    // 租约清干净了 —— 不留一个还能被自动推进的 owner
    expect(row.claimed_by).toBeNull()
    expect(row.lease_expires_at).toBeNull()
    // 留痕说得清是怎么停的
    expect((row.evidence as Record<string, unknown>).parked_unsafe_takeover).toBeTruthy()
    expect(calls).not.toHaveBeenCalled()
  })

  it('🔴 ② 租约再过期、同键再提交 → handler 仍然 0 次（不会从 queued 重新授权）', async () => {
    const calls = vi.fn()
    const f = paidFixture(async () => ({ output: { done: true }, costActualUsd: 1 }), calls)
    await crashedMidFlight(f)
    await runAction(f.kernel, submit())
    expect(runRow(f).status).toBe('dead_letter')

    // 时间再往前推很久，然后同一把幂等键再提交若干次
    advancePastLease(f)
    advancePastLease(f)
    for (let i = 0; i < 3; i += 1) {
      const again = await runAction(f.kernel, submit())
      expect(again.kind).toBe('dead_letter')
    }

    // 🔴 handler 一次都没被调过；也没有新的 allow 决策
    expect(calls).not.toHaveBeenCalled()
    expect(f.tables.authorization_decisions.filter((d) => d.verdict === 'allow')).toHaveLength(0)
    expect(runRow(f).status).toBe('dead_letter')
  })

  it('🔴 ③ 用过期的代际去落人工终态 → STALE_CLAIM，一个字都写不进去', async () => {
    const calls = vi.fn()
    const f = paidFixture(async () => ({ output: { done: true }, costActualUsd: 1 }), calls)
    const runId = await crashedMidFlight(f)
    const genBefore = Number(runRow(f).claim_generation)

    // 别人接管了（代际 +1）
    await claimOrTakeoverRun(f.supabase, { runId, ownerId: 'new-owner#1', leaseSeconds: LEASE })
    const statusBefore = String(runRow(f).status)

    const parked = await parkRunForHuman(f.supabase, {
      runId,
      expectedGeneration: genBefore,
      reason: '旧执行者以为该转人工',
    })

    expect(parked.ok).toBe(false)
    expect(parked.reason).toContain('stale_generation')
    expect(runRow(f).status).toBe(statusBefore) // 状态没被覆盖
    expect(Boolean(runRow(f).needs_human)).toBe(false)
  })

  it('零成本 / provider 认幂等键的动作不受影响（照常接管重跑）', async () => {
    const calls = vi.fn()
    const f = makeFixture({
      registry: makeRegistry([
        paidUnsafeDefinition({
          costModel: { kind: 'fixed', estimate: () => 0, stepCeilingUsd: { a: 0 } },
        }),
      ]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY as never,
          version: 1,
          steps: {
            a: async () => {
              calls()
              return { output: { done: true }, costActualUsd: 0 }
            },
          } as never,
        } as CapabilityImplementation,
      }),
      options: { policy: policy(0) },
      startAt: T0,
      leaseSeconds: LEASE,
    })
    const { run } = await submitActionRun(f.kernel, submit())
    await claimOrTakeoverRun(f.supabase, { runId: run.id, ownerId: 'dead#1', leaseSeconds: LEASE })
    f.tables.action_runs[0].status = 'running'
    f.clock.now = new Date(f.clock.now.getTime() + (LEASE + 1) * 1000)

    const out = await runAction(f.kernel, submit())

    expect(out.kind).toBe('succeeded')
    expect(calls).toHaveBeenCalledTimes(1)
  })
})

describe('P1-2 · handler 跑着的时候要续租', () => {
  it('🔴 handler 跑得比原租约还久 → 心跳把租约续上，B 抢不走', async () => {
    // 租约只有 1 秒（心跳间隔 = 1/3 秒）；handler 卡住直到我们放行。
    // 然后把**冻结时钟**往前推 5 秒 —— 原来那份租约（T0+1s）早就该过期了。
    // 如果没有心跳，这时 B 一定抢得走；有心跳的话租约已经被推到 T0+5s+1s。
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const f = makeFixture({
      registry: makeRegistry([paidUnsafeDefinition({ providerIdempotency: 'supported' })]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY as never,
          version: 1,
          steps: {
            a: async () => { await gate; return { output: { done: true }, costActualUsd: 1 } },
          } as never,
        } as CapabilityImplementation,
      }),
      options: { policy: policy(10) },
      startAt: T0,
      leaseSeconds: 1,
    })

    const running = runAction(f.kernel, submit())
    for (let i = 0; i < 200 && f.tables.action_runs[0]?.status !== 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(f.tables.action_runs[0]?.status).toBe('running')
    const runId = String(runRow(f).id)
    const originalExpiry = String(runRow(f).lease_expires_at)

    // 时间过去 5 秒 —— 原租约已经过期
    f.clock.now = new Date(f.clock.now.getTime() + 5_000)
    // 🔴 用 Date.parse 比，别比 ISO 字符串 —— 一旦某处产出不带毫秒或带偏移量，
    //    字符串比较会**静默判错**（长度/字典序都不再对应时间先后）。
    expect(Date.parse(originalExpiry)).toBeLessThan(f.clock.now.getTime())

    // 等心跳真的跑一轮（间隔 333ms）
    for (let i = 0; i < 100 && String(runRow(f).lease_expires_at) === originalExpiry; i += 1) {
      await new Promise((r) => setTimeout(r, 10))
    }

    // 🔴 租约被推到了「现在」之后 —— 这就是心跳在干活
    expect(Date.parse(String(runRow(f).lease_expires_at))).toBeGreaterThan(f.clock.now.getTime())

    // 于是 B 抢不走这条还在跑的 run
    const steal = await claimOrTakeoverRun(f.supabase, {
      runId, ownerId: 'B#1', leaseSeconds: 60,
    })
    expect(steal.ok).toBe(false)
    expect(steal.reason.startsWith('already_owned')).toBe(true)

    release()
    const out = await running
    expect(out.kind).toBe('succeeded')
  })

  it('🔴 owner 真死了（心跳停了）→ 租约到期后才能被接管', async () => {
    const f = paidFixture(async () => ({ output: { done: true }, costActualUsd: 1 }), () => {})
    const { run } = await submitActionRun(f.kernel, submit())
    await claimOrTakeoverRun(f.supabase, { runId: run.id, ownerId: 'dead#1', leaseSeconds: LEASE })
    runRow(f).status = 'running'

    // 租约还没到期 → 抢不走
    const early = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'B#1', leaseSeconds: LEASE,
    })
    expect(early.ok).toBe(false)
    expect(early.reason).toBe('already_owned:dead#1')

    // 到期之后才轮得到
    advancePastLease(f)
    const late = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'B#1', leaseSeconds: LEASE,
    })
    expect(late.ok).toBe(true)
  })

  it('🔴 续租的四项 CAS 各自单独可咬', async () => {
    const f = paidFixture(async () => ({ output: { done: true }, costActualUsd: 1 }), () => {})
    const { run } = await submitActionRun(f.kernel, submit())
    const claim = await claimOrTakeoverRun(f.supabase, {
      runId: run.id, ownerId: 'A#1', leaseSeconds: LEASE,
    })
    runRow(f).status = 'running'
    const good = { runId: run.id, ownerId: 'A#1', expectedGeneration: claim.claimGeneration, leaseSeconds: LEASE }

    expect((await renewLease(f.supabase, good)).ok).toBe(true)
    expect((await renewLease(f.supabase, { ...good, ownerId: 'B#1' })).reason).toContain('not_owner')
    expect((await renewLease(f.supabase, { ...good, expectedGeneration: claim.claimGeneration + 5 })).reason)
      .toContain('stale_generation')
    expect((await renewLease(f.supabase, { ...good, runId: 'no-such-run' })).reason).toBe('run_not_found')

    runRow(f).status = 'succeeded'
    expect((await renewLease(f.supabase, good)).reason).toContain('not_running')
  })

  it('🔴 业务副作用有数据库级唯一兜底：同一条 run 只可能落一个包', async () => {
    // 复刻迁移里的部分唯一索引 `uq_production_packages_kernel_run`：
    // 两代执行者各插一条 → 第二条必须被**库**拒掉，而不是靠「先 SELECT 再 INSERT」。
    const f = paidFixture(async () => ({ output: { done: true }, costActualUsd: 1 }), () => {})
    const pkg = (runId: string) => ({
      client_id: CLIENT_A,
      status: 'draft',
      source_payload: { kernel_run_id: runId, produced_by: 'execution_kernel' },
    })

    const first = await f.supabase.from('production_packages').insert(pkg('run-1'))
    expect(first.error).toBeNull()
    const second = await f.supabase.from('production_packages').insert(pkg('run-1'))
    expect(second.error?.message ?? '').toContain('duplicate key')
    expect(f.tables.production_packages).toHaveLength(1)

    // 另一条 run 不受影响
    const other = await f.supabase.from('production_packages').insert(pkg('run-2'))
    expect(other.error).toBeNull()

    // 🔴 人工 / 其它管道造的包（不带 kernel_run_id）完全不受这条部分索引约束
    const manual = { client_id: CLIENT_A, status: 'draft', source_payload: { produced_by: 'human' } }
    expect((await f.supabase.from('production_packages').insert(manual)).error).toBeNull()
    expect((await f.supabase.from('production_packages').insert(manual)).error).toBeNull()
  })
})

describe('P2-2 · createKernel 必须把租约参数真的转发下去', () => {
  it('🔴 leaseSeconds / ownerId 的 override 真的改变行为，不是只挂在对象上', async () => {
    const tables = {
      action_runs: [] as Array<Record<string, unknown>>,
      action_run_steps: [] as Array<Record<string, unknown>>,
    }
    const sb = createFakeSupabase(tables as never, {})
    const kernel = createKernel(sb, {
      registry: makeRegistry([paidUnsafeDefinition()]),
      capabilities: {},
      leaseSeconds: 4242,
      ownerId: 'my-explicit-owner',
    })

    expect(kernel.leaseSeconds).toBe(4242)
    expect(kernel.ownerId).toBe('my-explicit-owner')

    // 行为层面：领取时写下的租约必须按 4242 秒算，owner 必须带我给的前缀
    const now = new Date(T0)
    tables.action_runs.push({
      id: 'run-x', client_id: CLIENT_A, status: 'queued',
      claim_generation: 0, reclaim_count: 0, evidence: {},
    })
    const sb2 = createFakeSupabase(tables as never, { now: () => now })
    const claim = await claimOrTakeoverRun(sb2, {
      runId: 'run-x',
      ownerId: `${kernel.ownerId}#1`,
      leaseSeconds: kernel.leaseSeconds,
    })
    expect(claim.ok).toBe(true)
    const expiry = Date.parse(String(tables.action_runs[0].lease_expires_at))
    expect(Math.round((expiry - now.getTime()) / 1000)).toBe(4242)
    expect(String(tables.action_runs[0].claimed_by)).toContain('my-explicit-owner')
  })

  it('不给 override 时用默认值（300 秒 + 带 workerId 前缀的随机 owner）', () => {
    const sb = createFakeSupabase({ action_runs: [], action_run_steps: [] } as never, {})
    const kernel = createKernel(sb, {
      registry: makeRegistry([paidUnsafeDefinition()]),
      capabilities: {},
      workerId: 'worker-7',
    })
    expect(kernel.leaseSeconds).toBe(300)
    expect(kernel.ownerId).toContain('worker-7')
  })
})

describe('P2-1 · 待办不许假装有一个不存在的审批入口', () => {
  it('🔴 pending_approval 的待办：没有假链接，也没有「点同意执行」这类假操作文案', async () => {
    const { fetchKernelHandoffTodos, APPROVAL_SURFACE_BLOCKER } = await import('../handoff')
    const f = paidFixture(async () => ({ output: { done: true }, costActualUsd: 1 }), () => {})
    const { run } = await submitActionRun(f.kernel, submit())
    const row = runRow(f)
    row.status = 'pending_approval'
    row.needs_human = true

    const [todo] = await fetchKernelHandoffTodos(f.supabase, f.clock.now)
    expect(todo.run_id).toBe(run.id)

    // 🔴 不给假的 action URL —— 全仓没有任何页面/接口读 action_runs
    expect(todo.href).toBe('')
    // 🔴 不给假的操作步骤
    for (const fake of ['同意执行', '不做', '打开执行看板', '/execution']) {
      expect(`${todo.what} ${todo.how} ${todo.href}`).not.toContain(fake)
    }
    // 🔴 要如实说清「现在做不了」和缺的是什么
    expect(todo.how).toContain('还没有可以点的审批入口')
    expect(todo.how).toContain(APPROVAL_SURFACE_BLOCKER)
    // 而且要让人放心：它不会自动跑
    expect(todo.what).toContain('不会自动执行')
  })

  it('🔴 待办渲染器：没有 href 时不许画出一个点了没反应的按钮', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const raw = readFileSync(join(process.cwd(), 'src/app/dashboard/today/page.tsx'), 'utf8')
    // 🔴 先把注释去掉再找锚点 —— 讲解这条规则的注释里也写着「去做这件事」，
    //    直接 indexOf 会锚到注释上，断言就变成了「注释前面有没有守卫」（永远假）。
    //    这跟之前那条按「下一条语句」切片的断言是同一类坑。
    const page = raw
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const guard = page.indexOf('m.href ?')
    expect(guard, '按钮必须被 href 守住').toBeGreaterThan(-1)
    // 🔴 「守卫在按钮前面」还不够 —— 三元的 else 分支里再画一个同样的按钮照样过。
    //    所以要求整份文件里**只有一处**「去做这件事」，且它在守卫之后。
    const all = Array.from(page.matchAll(/去做这件事/g)).map((m) => m.index ?? -1)
    expect(all, '只应该有一处按钮文案').toHaveLength(1)
    expect(guard).toBeLessThan(all[0])
    // else 分支必须是 null，不能是另一个按钮
    expect(page).toContain(') : null}')
  })
})

describe('P2-1 端到端 · 没有链接的待办必须真的到得了人眼前', () => {
  it('🔴 走完整条管道（含 dropBrokenLinks）之后，这条待办还在', async () => {
    const { dropBrokenLinks } = await import('@/lib/pm-todo/manual-items')
    const { fetchKernelHandoffTodos } = await import('../handoff')

    const f = paidFixture(async () => ({ output: { done: true }, costActualUsd: 1 }), () => {})
    await submitActionRun(f.kernel, submit())
    const row = runRow(f)
    row.status = 'pending_approval'
    row.needs_human = true

    const [todo] = await fetchKernelHandoffTodos(f.supabase, f.clock.now)
    expect(todo.href).toBe('')

    // 🔴 这一步是之前漏掉的那段管道：空 href 曾经被判成「链接坏了」→ 整条丢弃，
    //    于是「如实告诉人入口还没上线」端到端等于「人什么都看不到」。
    const neverCalled = (() => { throw new Error('空 href 不该去 fetch') }) as unknown as typeof fetch
    const { kept, dropped } = await dropBrokenLinks(
      [{
        kind: 'kernel_needs_human' as never,
        client_id: todo.client_id,
        client_name: 'X',
        what: todo.what,
        how: todo.how,
        href: todo.href,
      }],
      neverCalled,
    )

    expect(dropped).toHaveLength(0)
    expect(kept).toHaveLength(1)
    expect(kept[0].how).toContain('还没有可以点的审批入口')
  })
})

describe('P1-2b · handler 返回之后必须复核「我还握着执行权吗」', () => {
  /**
   * 🔴 找一个**围栏救不了**的场景，否则这道闸整块删掉都没人发现。
   *
   *    step / run 的写入围栏只比 `claim_generation`。而「转人工」和「人工恢复」
   *    这两条路会把 `claimed_by` 清空却**不换代际** —— 于是旧执行者手里的代际
   *    仍然对得上，`writeStep` 照写不误。能拦住它的只有 `assertStillOwner`
   *    里那句 owner 比对。
   */
  it('🔴 handler 跑着的时候这条 run 被转人工（owner 清空、代际不变）→ 结果不许被当成自己的提交', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const f = makeFixture({
      registry: makeRegistry([paidUnsafeDefinition({ providerIdempotency: 'supported' })]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY as never,
          version: 1,
          steps: {
            a: async () => { await gate; return { output: { done: true }, costActualUsd: 1 } },
          } as never,
        } as CapabilityImplementation,
      }),
      options: { policy: policy(10) },
      startAt: T0,
      // 租约很长 → 这次执行期间心跳一次都不会触发，把变量收到最少
      leaseSeconds: 3600,
    })

    const running = runAction(f.kernel, submit()).then(
      (v) => ({ ok: true as const, v }),
      (e: Error) => ({ ok: false as const, e }),
    )
    for (let i = 0; i < 200 && f.tables.action_runs[0]?.status !== 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(runRow(f).status).toBe('running')
    const genDuring = Number(runRow(f).claim_generation)

    // 有人（比如人工介入）把它转成了等人处理：owner 清空，**代际没变**
    const parked = await parkRunForHuman(f.supabase, {
      runId: String(runRow(f).id),
      expectedGeneration: genDuring,
      reason: '人工介入：先确认供应商那边扣没扣钱',
    })
    expect(parked.ok).toBe(true)
    expect(runRow(f).claimed_by).toBeNull()
    // 🔴 代际没动 —— 所以写入围栏这时是**拦不住**旧执行者的
    expect(Number(runRow(f).claim_generation)).toBe(genDuring)

    // 人工处置写下的那份说法 —— 下面逐字比对，一个标点都不许被冲掉
    const human = {
      lastError: String(runRow(f).last_error),
      finishedAt: String(runRow(f).finished_at),
      evidence: JSON.stringify(runRow(f).evidence ?? {}),
    }
    expect(human.lastError).toBe('人工介入：先确认供应商那边扣没扣钱')

    release()
    const out = await running

    // 🔴 直接冒泡，不是「跑完再报一个失败」—— 报失败的路上就会写状态
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.e.message).toMatch(/接管/)

    expect(runRow(f).status).toBe('dead_letter')
    expect(runRow(f).needs_human).toBe(true)
    // 产物也没被写出去
    expect(f.tables.action_run_steps.every((st) => st.status !== 'succeeded')).toBe(true)

    // 🔴 **人工写下的那份处置必须原样还在。**
    //    写入围栏比的是代际，而 park 清 owner 不换代际 —— 旧执行者的
    //    `writeStep` / `failRun` 本来照写不误，会把「请确认供应商那边扣没扣钱」
    //    覆盖成「被接管了」，`finished_at` 也会被推到它自己停手的那一刻。
    //    人再看这条待办时，真正要他去做的事就没了。
    expect(runRow(f).last_error).toBe(human.lastError)
    expect(String(runRow(f).last_error)).not.toContain('接管')
    expect(String(runRow(f).finished_at)).toBe(human.finishedAt)
    expect(JSON.stringify(runRow(f).evidence ?? {})).toBe(human.evidence)
    // 步骤也不许被旧执行者改写
    expect(f.tables.action_run_steps.every((st) => st.status !== 'dead_letter')).toBe(true)
  })

  /**
   * 🔴 同一个覆盖的**另一条分支**：handler 不是正常返回，而是抛错。
   *
   *    抛错时控制流直接跳进通用 catch，绕过「返回之后那句复核」——
   *    只补正常返回那条路等于没补：只比代际的 writeStep / failRun
   *    照样把人工处置的原话、时间、步骤状态覆盖掉。
   */
  it('🔴 转人工之后 handler 抛错 → 也不许落自己的死信（人工原话原样保留）', async () => {
    let boom: () => void = () => {}
    const gate = new Promise<void>((_, rej) => { boom = () => rej(new Error('供应商 502')) })
    const f = makeFixture({
      registry: makeRegistry([paidUnsafeDefinition({ providerIdempotency: 'supported' })]),
      capabilities: () => ({
        [KEY]: {
          actionKey: KEY as never,
          version: 1,
          steps: { a: async () => { await gate; return { output: { done: true } } } } as never,
        } as CapabilityImplementation,
      }),
      options: { policy: policy(10) },
      startAt: T0,
      leaseSeconds: 3600,
    })

    const running = runAction(f.kernel, submit()).then(
      (v) => ({ ok: true as const, v }),
      (e: Error) => ({ ok: false as const, e }),
    )
    for (let i = 0; i < 200 && f.tables.action_runs[0]?.status !== 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(runRow(f).status).toBe('running')

    const parked = await parkRunForHuman(f.supabase, {
      runId: String(runRow(f).id),
      expectedGeneration: Number(runRow(f).claim_generation),
      reason: '人工介入：先确认供应商那边扣没扣钱',
    })
    expect(parked.ok).toBe(true)
    const human = {
      lastError: String(runRow(f).last_error),
      finishedAt: String(runRow(f).finished_at),
      evidence: JSON.stringify(runRow(f).evidence ?? {}),
    }

    boom()
    const out = await running

    // 🔴 抛错这条路也必须冒泡，而不是把「供应商 502」写成这条 run 的结局
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.e.message).toMatch(/接管/)

    expect(runRow(f).status).toBe('dead_letter')
    expect(runRow(f).needs_human).toBe(true)
    expect(runRow(f).last_error).toBe(human.lastError)
    expect(String(runRow(f).last_error)).not.toContain('502')
    expect(String(runRow(f).finished_at)).toBe(human.finishedAt)
    expect(JSON.stringify(runRow(f).evidence ?? {})).toBe(human.evidence)
    expect(f.tables.action_run_steps.every((st) => st.status !== 'dead_letter')).toBe(true)
  })
})
