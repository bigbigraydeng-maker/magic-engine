import { describe, expect, it, vi } from 'vitest'
import { runProbe, type CommentRunSnapshot, type CronRunRow, type ProbeDeps } from '../probes'
import type { LedgerCardView } from '../classify'
import type { ParsedProbe, ProbeOutcome } from '../types'

const NOW = new Date('2026-10-08T00:00:00.000Z')
const NOW_ISO = NOW.toISOString()

const ALLOWED = new Set(['social-comment-autoreply', 'calendar-closure-audit'])

function makeDeps(overrides: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    now: () => NOW,
    loadCronRuns: vi.fn(async () => [] as CronRunRow[]),
    allowedJobs: ALLOWED,
    loadCommentRun: vi.fn(async () => null as CommentRunSnapshot | null),
    loadReplyScopeTodos: vi.fn(async () => [] as { client_id: string; kind: string }[]),
    clientExists: vi.fn(async () => true),
    loadCard: vi.fn(() => undefined as LedgerCardView | undefined),
    ...overrides,
  }
}

function probe(name: ParsedProbe['name'], params: Record<string, string>): ParsedProbe {
  return { name, params }
}

/** 一条「最近一轮」评论运行记录，finished_at 就在刚才。 */
function freshCommentRun(results: CommentRunSnapshot['results']): CommentRunSnapshot {
  return { finished_at: NOW_ISO, results }
}

describe('runProbe — 通用契约', () => {
  it('fetchedAt 永远来自 deps.now()', async () => {
    const deps = makeDeps()
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps)
    expect(result.fetchedAt).toBe(NOW_ISO)
  })

  it('任何结果都不会是 verified', async () => {
    const deps = makeDeps({
      loadCronRuns: vi.fn(async () => [{ status: 'completed', started_at: NOW_ISO }]),
      loadCommentRun: vi.fn(async () =>
        freshCommentRun([{ client_id: 'c1', permission_denied_count: 3, posts_scanned: 10 }]),
      ),
      loadCard: vi.fn(() => ({ id: 'x', status: 'verified', verifiedRef: null }) as LedgerCardView),
    })

    const results = await Promise.all([
      runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps),
      runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps),
      runProbe(probe('ledger_card_status', { id: 'x', status: 'verified' }), deps),
    ])

    for (const r of results) {
      expect(r.outcome).not.toBe('verified')
    }
  })

  it('未知 probe 名 → unreadable', async () => {
    const deps = makeDeps()
    const result = await runProbe({ name: 'cron_run_ok', params: {} }, deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('核对参数不合格')
  })

  it('参数多一个 → unreadable', async () => {
    const deps = makeDeps()
    const result = await runProbe(
      probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24', extra: 'x' }),
      deps,
    )
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('核对参数不合格')
  })

  it('参数少一个 → unreadable', async () => {
    const deps = makeDeps()
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('核对参数不合格')
  })
})

describe('runProbe — 每个依赖抛错都变成 unreadable', () => {
  it('loadCronRuns 抛错', async () => {
    const deps = makeDeps({
      loadCronRuns: vi.fn(async () => {
        throw new Error('boom-cron')
      }),
    })
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('取数出错：boom-cron')
  })

  it('loadCommentRun 抛错', async () => {
    const deps = makeDeps({
      loadCommentRun: vi.fn(async () => {
        throw new Error('boom-comment')
      }),
    })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('取数出错：boom-comment')
  })

  it('clientExists 抛错', async () => {
    const deps = makeDeps({
      clientExists: vi.fn(async () => {
        throw new Error('boom-client')
      }),
    })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('取数出错：boom-client')
  })

  it('loadCard 抛错', async () => {
    const deps = makeDeps({
      loadCard: vi.fn(() => {
        throw new Error('boom-card')
      }),
    })
    const result = await runProbe(probe('ledger_card_status', { id: 'x', status: 'verified' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('取数出错：boom-card')
  })

  it('now 抛错', async () => {
    const deps = makeDeps({
      now: () => {
        throw new Error('boom-now')
      },
    })
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('取数出错：boom-now')
  })

  it('错误信息超过 160 字会被截断', async () => {
    const long = 'x'.repeat(500)
    const deps = makeDeps({
      loadCronRuns: vi.fn(async () => {
        throw new Error(long)
      }),
    })
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe(`取数出错：${'x'.repeat(160)}`)
  })
})

describe('runProbe — cron_run_ok', () => {
  it('任务名不在白名单 → unreadable', async () => {
    const deps = makeDeps()
    const result = await runProbe(probe('cron_run_ok', { job: 'not-allowed', within_hours: '24' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('任务名不在白名单')
    expect(deps.loadCronRuns).not.toHaveBeenCalled()
  })

  it('within_hours 不是整数 → unreadable', async () => {
    const deps = makeDeps()
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '1.5' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('核对参数不合格')
  })

  it('within_hours 超出 1..720 → unreadable', async () => {
    const deps = makeDeps()
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '721' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('核对参数不合格')
  })

  it('有 completed → passed_needs_human_confirm', async () => {
    const deps = makeDeps({
      loadCronRuns: vi.fn(async () => [
        { status: 'failed', started_at: NOW_ISO },
        { status: 'completed', started_at: NOW_ISO },
      ]),
    })
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps)
    expect(result.outcome).toBe('passed_needs_human_confirm')
    expect(result.fact).toBe('2 条跑完的运行记录里有成功的')
    expect(result.sample).toBe(2)
  })

  it('有记录但没 completed → failed', async () => {
    const deps = makeDeps({
      loadCronRuns: vi.fn(async () => [
        { status: 'failed', started_at: NOW_ISO },
        { status: 'running', started_at: NOW_ISO },
      ]),
    })
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps)
    expect(result.outcome).toBe('failed')
    expect(result.fact).toBe('1 条跑完的运行记录里没有成功的（1 条失败）')
    expect(result.sample).toBe(2)
  })

  it('空窗口 → not_yet', async () => {
    const deps = makeDeps({ loadCronRuns: vi.fn(async () => []) })
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps)
    expect(result.outcome).toBe('not_yet')
    expect(result.fact).toBe('时间窗内没有运行记录；窗口短于任务周期时不代表没跑')
    expect(result.sample).toBe(0)
  })

  it('since 按 within_hours 从 now 往前推', async () => {
    const loadCronRuns = vi.fn(async () => [] as CronRunRow[])
    const deps = makeDeps({ loadCronRuns })
    await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps)
    expect(loadCronRuns).toHaveBeenCalledWith('social-comment-autoreply', '2026-10-07T00:00:00.000Z')
  })
})

describe('runProbe — todo_item_present', () => {
  it('不支持的待办类型 → unreadable', async () => {
    const deps = makeDeps()
    const result = await runProbe(probe('todo_item_present', { kind: 'nope', client: 'c1' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('不支持的待办类型')
  })

  it('客户不存在 → unreadable', async () => {
    const deps = makeDeps({ clientExists: vi.fn(async () => false) })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('客户不存在')
  })

  it('没有运行记录 → not_yet', async () => {
    const deps = makeDeps({ loadCommentRun: vi.fn(async () => null) })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('not_yet')
    expect(result.fact).toBe('评论自动回复任务还没有运行记录')
  })

  it('运行记录太旧 → not_yet', async () => {
    const stale = new Date(NOW.getTime() - 3 * 86_400_000).toISOString()
    const deps = makeDeps({
      loadCommentRun: vi.fn(async () => ({ finished_at: stale, results: [] })),
    })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('not_yet')
    expect(result.fact).toBe('最近一轮运行记录太旧')
  })

  it('finished_at 为 null → not_yet', async () => {
    const deps = makeDeps({
      loadCommentRun: vi.fn(async () => ({ finished_at: null, results: [] })),
    })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('not_yet')
    expect(result.fact).toBe('最近一轮运行记录太旧')
  })

  it('最近一轮没扫到这个客户 → not_yet', async () => {
    const deps = makeDeps({
      loadCommentRun: vi.fn(async () => freshCommentRun([{ client_id: 'other', permission_denied_count: 1 }])),
    })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('not_yet')
    expect(result.fact).toBe('最近一轮没有扫到这个客户')
    expect(result.sample).toBe(1)
  })

  it('该客户会出现这条待办 → passed_needs_human_confirm', async () => {
    const deps = makeDeps({
      loadCommentRun: vi.fn(async () =>
        freshCommentRun([{ client_id: 'c1', permission_denied_count: 3, posts_scanned: 10 }]),
      ),
    })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('passed_needs_human_confirm')
    expect(result.fact).toBe('最近一轮运行结果里该客户会出现这条待办（只证明待办会出现，不证明授权已修好）')
    expect(result.sample).toBe(1)
  })

  it('该客户没有这条待办 → failed', async () => {
    const deps = makeDeps({
      loadCommentRun: vi.fn(async () => freshCommentRun([{ client_id: 'c1' }])),
    })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('failed')
    expect(result.fact).toBe('最近一轮运行结果里该客户没有这条待办（可能已修好，也可能没触发）')
  })

  it('令牌被拒时 kind 不匹配 → failed', async () => {
    const deps = makeDeps({
      loadCommentRun: vi.fn(async () =>
        freshCommentRun([{ client_id: 'c1', token_invalid: 'OAuthException: token expired' }]),
      ),
    })
    const result = await runProbe(probe('todo_item_present', { kind: 'comment_scope_missing', client: 'c1' }), deps)
    expect(result.outcome).toBe('failed')
  })
})

describe('runProbe — ledger_card_status', () => {
  it('台账里没有这张卡 → unreadable', async () => {
    const deps = makeDeps({ loadCard: vi.fn(() => undefined) })
    const result = await runProbe(probe('ledger_card_status', { id: 'x', status: 'verified' }), deps)
    expect(result.outcome).toBe('unreadable')
    expect(result.fact).toBe('台账里没有这张卡')
  })

  it('状态相符 → passed_needs_human_confirm', async () => {
    const deps = makeDeps({
      loadCard: vi.fn(() => ({ id: 'x', status: 'verified', verifiedRef: null }) as LedgerCardView),
    })
    const result = await runProbe(probe('ledger_card_status', { id: 'x', status: 'verified' }), deps)
    expect(result.outcome).toBe('passed_needs_human_confirm')
    expect(result.sample).toBe(1)
  })

  it('卡是 failed 而期望不是 → failed', async () => {
    const deps = makeDeps({
      loadCard: vi.fn(() => ({ id: 'x', status: 'failed', verifiedRef: null }) as LedgerCardView),
    })
    const result = await runProbe(probe('ledger_card_status', { id: 'x', status: 'verified' }), deps)
    expect(result.outcome).toBe('failed')
    expect(result.sample).toBe(1)
  })

  it('状态还没到 → not_yet', async () => {
    const deps = makeDeps({
      loadCard: vi.fn(() => ({ id: 'x', status: 'decided', verifiedRef: null }) as LedgerCardView),
    })
    const result = await runProbe(probe('ledger_card_status', { id: 'x', status: 'verified' }), deps)
    expect(result.outcome).toBe('not_yet')
    expect(result.sample).toBe(1)
  })
})

describe('runProbe — 结果类型只可能是这四种', () => {
  it('所有分支的 outcome 都在 ProbeOutcome 里', async () => {
    const allowed: ProbeOutcome[] = ['passed_needs_human_confirm', 'failed', 'not_yet', 'unreadable']
    const deps = makeDeps()
    const result = await runProbe(probe('cron_run_ok', { job: 'social-comment-autoreply', within_hours: '24' }), deps)
    expect(allowed).toContain(result.outcome)
  })
})

describe('todo_item_present — comment_reply_scope_missing', () => {
  const probe = {
    name: 'todo_item_present' as const,
    params: { kind: 'comment_reply_scope_missing', client: 'c1' },
  }

  it('该客户现在会出现这条待办 -> passed_needs_human_confirm（不叫 verified）', async () => {
    const deps = makeDeps({
      loadReplyScopeTodos: vi.fn(async () => [{ client_id: 'c1', kind: 'comment_reply_scope_missing' }]),
    })
    const r = await runProbe(probe, deps)
    expect(r.outcome).toBe('passed_needs_human_confirm')
    expect(r.sample).toBe(1)
  })

  it('没有这条待办 -> failed（永远不判通过）', async () => {
    const r = await runProbe(probe, makeDeps())
    expect(r.outcome).toBe('failed')
  })

  it('别的客户有、这个客户没有 -> failed', async () => {
    const deps = makeDeps({
      loadReplyScopeTodos: vi.fn(async () => [{ client_id: 'c2', kind: 'comment_reply_scope_missing' }]),
    })
    expect((await runProbe(probe, deps)).outcome).toBe('failed')
  })

  it('取数抛错 -> unreadable', async () => {
    const deps = makeDeps({
      loadReplyScopeTodos: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    expect((await runProbe(probe, deps)).outcome).toBe('unreadable')
  })
})

describe('cron_run_ok — 正在进行中的记录不算结果', () => {
  const probe = { name: 'cron_run_ok' as const, params: { job: 'social-comment-autoreply', within_hours: '72' } }

  it('只有一条 running（巡检核对自己时看到自己这一轮）-> not_yet，不是 failed', async () => {
    const deps = makeDeps({
      allowedJobs: new Set(['social-comment-autoreply']),
      loadCronRuns: vi.fn(async () => [{ status: 'running', started_at: '2026-10-12T00:00:00Z' }]),
    })
    const r = await runProbe(probe, deps)
    expect(r.outcome).toBe('not_yet')
    expect(r.sample).toBe(1)
  })

  it('running + 一条 completed -> 通过（running 不干扰）', async () => {
    const deps = makeDeps({
      allowedJobs: new Set(['social-comment-autoreply']),
      loadCronRuns: vi.fn(async () => [
        { status: 'running', started_at: '2026-10-12T00:00:00Z' },
        { status: 'completed', started_at: '2026-10-11T00:00:00Z' },
      ]),
    })
    expect((await runProbe(probe, deps)).outcome).toBe('passed_needs_human_confirm')
  })

  it('running + 一条 failed -> failed', async () => {
    const deps = makeDeps({
      allowedJobs: new Set(['social-comment-autoreply']),
      loadCronRuns: vi.fn(async () => [
        { status: 'running', started_at: '2026-10-12T00:00:00Z' },
        { status: 'failed', started_at: '2026-10-11T00:00:00Z' },
      ]),
    })
    expect((await runProbe(probe, deps)).outcome).toBe('failed')
  })
})
