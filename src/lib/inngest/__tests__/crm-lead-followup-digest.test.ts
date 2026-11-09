/**
 * 「客人填了表还没人回」每日汇总信 · Inngest 装配与编排测试。
 *
 * 测两件事：
 *   · **装配**：触发器带时区、retries、onFailure、注册进了 cloudFunctions
 *   · **编排**：默认不发、收件人锁死成字面量、积压算不出来不牵连名单、
 *     一个客户炸了不牵连别人、每趟写运行记录、回执不带客人隐私
 *
 * 不测判据本身（`crm/lead-followup-due` 有自己的测试）也不测文案
 * （`crm/lead-followup-digest` 有自己的测试）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const startCronRunId = vi.fn<(job: string) => Promise<string>>(async () => 'run-1')
const finish = vi.fn<(opts: Record<string, unknown>) => Promise<void>>(async () => {})
const failOpenCronRuns = vi.fn<(job: string, msg: string, opts: unknown) => Promise<number>>(async () => 1)
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (job: string) => startCronRunId(job),
  cronRunHandle: () => ({ finish: (o: Record<string, unknown>) => finish(o) }),
  startCronRun: vi.fn(),
  failOpenCronRuns: (job: string, msg: string, opts: unknown) => failOpenCronRuns(job, msg, opts),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  createLeadFollowupDigestFunction,
  runLeadFollowupDigest,
  digestEnabled,
  DIGEST_RECIPIENT,
  LEAD_DIGEST_CRON,
  LEAD_DIGEST_JOB,
  LEAD_DIGEST_TZ,
  type DigestStep,
  type LeadFollowupDigestDeps,
} from '../functions/crm-lead-followup-digest'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadDueResult } from '@/lib/crm/lead-followup-due'

const CLIENT = 'client-a'

const NOW = new Date('2026-09-24T00:00:00Z')

type Fn = ReturnType<typeof createLeadFollowupDigestFunction>

function optsOf(fn: Fn) {
  return (fn as Fn & {
    opts: {
      triggers?: { cron?: string }[]
      retries?: number
      concurrency?: { limit: number }
      onFailure?: (ctx: { event: { ts?: number; data: unknown }; error: Error }) => Promise<void>
    }
  }).opts
}

/** 假 step：记 id 顺序，返回值走一遍 JSON —— 跟 Inngest 记忆化一样。 */
function fakeStep() {
  const ids: string[] = []
  const step: DigestStep = {
    run: async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
      ids.push(id)
      return JSON.parse(JSON.stringify(await fn())) as T
    },
  }
  return { ids, step }
}

/** 假 supabase：只实现客户清单那一条链。 */
function fakeSupabase(rows: Array<{ id: string; name: string }> | null, error?: { message: string }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        not: () => ({
          order: () => ({ range: async () => ({ data: rows, error: error ?? null }) }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

function due(over: Partial<LeadDueResult> = {}): LeadDueResult {
  return {
    items: [{ clientId: CLIENT, contactId: 'p1', displayName: '王女士', interest: 'Best of China', leadAt: '2026-09-22T00:00:00Z' }],
    dropped: 0,
    orphans: 0,
    ...over,
  }
}

function deps(over: Partial<LeadFollowupDigestDeps> = {}): LeadFollowupDigestDeps {
  return {
    supabase: fakeSupabase([{ id: CLIENT, name: '示例客户' }]),
    findDue: vi.fn(async () => due()),
    countBacklog: vi.fn(async () => ({ backlog: 277, lookbackDays: 180 })),
    sendDigest: vi.fn(async () => ({ sent: true, recipients: [DIGEST_RECIPIENT], messageId: 'msg_1' })),
    env: { LEAD_FOLLOWUP_DIGEST_ENABLED: 'true' },
    ...over,
  }
}

beforeEach(() => {
  startCronRunId.mockClear()
  finish.mockClear()
  failOpenCronRuns.mockClear()
})

describe('装配', () => {
  const fn = () => cloudFunctions.find((f) => f.id().endsWith(LEAD_DIGEST_JOB)) as Fn

  it('注册进了 cloudFunctions，id 带 cloud- 前缀', () => {
    expect(cloudFunctions.map((f) => f.id())).toContain(`${CLOUD_FN_PREFIX}${LEAD_DIGEST_JOB}`)
  })

  it('🔴 定时器必须带时区 —— 不带的话 Inngest 按 UTC 算，夏令时一来就漂到别的时段', () => {
    const cron = optsOf(fn()).triggers?.[0]?.cron ?? ''
    expect(cron).toContain(`TZ=${LEAD_DIGEST_TZ}`)
    expect(cron).toContain(LEAD_DIGEST_CRON)
  })

  it('🔴 敢重试的依据是 step 记忆化：发过信的那一步不会重跑，所以重试是安全的', () => {
    expect(optsOf(fn()).retries).toBe(2)
  })

  it('🔴 必须有 onFailure —— 否则重试耗尽后会留一行永远「在跑」的假记录', async () => {
    const onFailure = optsOf(fn()).onFailure
    expect(onFailure).toBeTypeOf('function')
    await onFailure?.({ event: { ts: 1_700_000_000_000, data: {} }, error: new Error('炸了') })
    expect(failOpenCronRuns).toHaveBeenCalled()
  })

  it('同时只跑一个，不跟自己撞车', () => {
    expect(optsOf(fn()).concurrency).toEqual({ limit: 1 })
  })

  it('🔴 收件人是字面量，不是环境变量 —— 改一行配置不该能把客人名单发到别处', () => {
    expect(DIGEST_RECIPIENT).toBe('hello@magicengine.cloud')
  })
})

describe('开关', () => {
  it.each([undefined, '', 'false', 'TRUE', '1', 'yes'])('环境变量是 %o 时一律当没开', (v) => {
    expect(digestEnabled({ LEAD_FOLLOWUP_DIGEST_ENABLED: v })).toBe(false)
  })

  it('只有字面 true 才算开', () => {
    expect(digestEnabled({ LEAD_FOLLOWUP_DIGEST_ENABLED: 'true' })).toBe(true)
  })
})

describe('编排', () => {
  it('🔴 开关没开时：名单照挑、回执照记，但一封都不发', async () => {
    const d = deps({ env: {} })
    const r = await runLeadFollowupDigest(fakeStep().step, d, NOW)
    expect(d.sendDigest).not.toHaveBeenCalled()
    expect(r.emails_sent).toBe(0)
    expect(r.results[0].listed).toBe(1)
    expect(r.results[0].reason).toContain('未启用')
  })

  it('🔴 收件人锁死成字面量常量，调用方不能从配置里改掉', async () => {
    const d = deps()
    await runLeadFollowupDigest(fakeStep().step, d, NOW)
    expect(d.sendDigest).toHaveBeenCalledWith(
      '示例客户',
      expect.any(Array),
      expect.objectContaining({ recipients: [DIGEST_RECIPIENT] }),
    )
  })

  it('回执里带上发信服务的凭据 id 和 no_publish', async () => {
    const r = await runLeadFollowupDigest(fakeStep().step, deps(), NOW)
    expect(r.results[0].provider_message_id).toBe('msg_1')
    expect(r.results.every((x) => x.no_publish === true)).toBe(true)
  })

  it('🔴 回执里不出现客人的名字 / 邮箱 / 电话 —— 隐私不进 Inngest 云端', async () => {
    const r = await runLeadFollowupDigest(fakeStep().step, deps(), NOW)
    expect(JSON.stringify(r)).not.toContain('王女士')
    expect(JSON.stringify(r)).not.toContain('Best of China')
  })

  it('🔴 积压算不出来时传 null、不当 0，而且名单照发', async () => {
    const d = deps({ countBacklog: vi.fn(async () => { throw new Error('查积压超时') }) })
    const r = await runLeadFollowupDigest(fakeStep().step, d, NOW)
    expect(r.results[0].backlog).toBeNull()
    expect(r.results[0].sent).toBe(true)
    expect(d.sendDigest).toHaveBeenCalledWith('示例客户', expect.any(Array), expect.objectContaining({ backlog: null }))
  })

  it('🔴 窗口内没人、但积压里还有 277 个 —— 不发信，可是回执不许说「没有待跟进的线索」就完了', async () => {
    const d = deps({ findDue: vi.fn(async () => due({ items: [] })) })
    const r = await runLeadFollowupDigest(fakeStep().step, d, NOW)
    expect(d.sendDigest).not.toHaveBeenCalled()
    expect(r.results[0].backlog).toBe(277)
    expect(r.results[0].reason).toContain('277')
  })

  it('查不到人的条数留在回执里，不静默吞掉', async () => {
    const d = deps({ findDue: vi.fn(async () => due({ orphans: 3 })) })
    expect((await runLeadFollowupDigest(fakeStep().step, d, NOW)).results[0].orphans).toBe(3)
  })

  it('🔴 一个客户挑名单炸了，不牵连别的客户，而且原因要留在回执里', async () => {
    const d = deps({
      supabase: fakeSupabase([{ id: 'bad', name: '坏客户' }, { id: 'good', name: '好客户' }]),
      findDue: vi.fn(async (_s, clientId: string) => {
        if (clientId === 'bad') throw new Error('这个客户的触点表读不出来')
        return due()
      }),
    })
    const r = await runLeadFollowupDigest(fakeStep().step, d, NOW)
    expect(r.results).toHaveLength(2)
    expect(r.results[0].reason).toContain('触点表读不出来')
    expect(r.results[1].sent).toBe(true)
    expect(r.emails_sent).toBe(1)
  })

  it('🔴 每趟都写一条运行记录 —— 否则「今天没信」和「今天没跑」分不出来', async () => {
    await runLeadFollowupDigest(fakeStep().step, deps(), NOW)
    expect(startCronRunId).toHaveBeenCalledWith(LEAD_DIGEST_JOB)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ processed: 1, completed: 1 }))
  })

  it('🔴 读客户清单失败：整趟失败，但运行记录要先收成失败，不留「在跑」', async () => {
    const broken = fakeSupabase(null, { message: '连不上' })
    await expect(runLeadFollowupDigest(fakeStep().step, deps({ supabase: broken }), NOW)).rejects.toThrow('连不上')
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('连不上') }))
  })

  it('每个客户各占自己的 step —— 出事能看出是哪个客户、哪一段', async () => {
    const { ids, step } = fakeStep()
    await runLeadFollowupDigest(step, deps(), NOW)
    expect(ids).toEqual([
      'log-start', 'load-clients',
      `scan-${CLIENT}`, `backlog-${CLIENT}`, `send-${CLIENT}`,
      'log-finish',
    ])
  })
})
