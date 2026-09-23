/**
 * 「客人填了表还没人回」每日汇总信 · Inngest 装配与编排测试。
 *
 * 测两件事：
 *   · **装配**：触发器带时区、retries=0（发信不幂等）、注册进了 cloudFunctions
 *   · **编排**：默认不发、收件人锁死、一个客户炸了不牵连别人、回执不带客人隐私
 *
 * 不测判据本身（`crm/lead-followup-due` 有自己的测试）也不测文案
 * （`crm/lead-followup-digest` 有自己的测试）。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  createLeadFollowupDigestFunction,
  runLeadFollowupDigest,
  digestEnabled,
  LEAD_DIGEST_CRON,
  LEAD_DIGEST_TZ,
  type DigestStep,
  type LeadFollowupDigestDeps,
} from '../functions/crm-lead-followup-digest'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import { ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import type { LeadDueResult } from '@/lib/crm/lead-followup-due'
import type { SupabaseClient } from '@supabase/supabase-js'

/** 假 supabase：只实现 `from().select().not()` 这一条链，别的用不上。 */
function fakeSupabase(rows: Array<{ id: string; name: string; facebook_page_id: string }> | null, error?: { message: string }): SupabaseClient {
  return {
    from: () => ({ select: () => ({ not: async () => ({ data: rows, error: error ?? null }) }) }),
  } as unknown as SupabaseClient
}

type Fn = ReturnType<typeof createLeadFollowupDigestFunction>

function optsOf(fn: Fn) {
  return (fn as Fn & {
    opts: { triggers?: { cron?: string }[]; retries?: number; concurrency?: { limit: number } }
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

function due(over: Partial<LeadDueResult> = {}): LeadDueResult {
  return {
    items: [
      {
        clientId: 'cts',
        contactId: 'p1',
        displayName: '王女士',
        interest: 'Best of China',
        leadAt: '2026-09-22T00:00:00Z',
      },
    ],
    dropped: 0,
    backlog: 0,
    ...over,
  }
}

function deps(over: Partial<LeadFollowupDigestDeps> = {}): LeadFollowupDigestDeps {
  return {
    supabase: fakeSupabase([{ id: 'cts', name: 'CTS Tours NZ', facebook_page_id: '1' }]),
    findDue: vi.fn(async () => due()),
    sendDigest: vi.fn(async () => ({ sent: true, recipients: [ME_MAIL_TO_ADDRESS] })),
    env: { LEAD_FOLLOWUP_DIGEST_ENABLED: 'true' },
    ...over,
  }
}

describe('装配', () => {
  const fn = () => cloudFunctions.find((f) => f.id().endsWith('crm-lead-followup-digest')) as Fn

  it('注册进了 cloudFunctions，id 带 cloud- 前缀', () => {
    expect(cloudFunctions.map((f) => f.id())).toContain(`${CLOUD_FN_PREFIX}crm-lead-followup-digest`)
  })

  it('🔴 定时器必须带时区 —— 不带的话 Inngest 按 UTC 算，夏令时一来就漂到别的时段', () => {
    const cron = optsOf(fn()).triggers?.[0]?.cron ?? ''
    expect(cron).toContain(`TZ=${LEAD_DIGEST_TZ}`)
    expect(cron).toContain(LEAD_DIGEST_CRON)
  })

  it('🔴 retries 必须是 0 —— 发信不幂等，重试一次就是同一封信收两遍', () => {
    expect(optsOf(fn()).retries).toBe(0)
  })

  it('同时只跑一个，不跟自己撞车', () => {
    expect(optsOf(fn()).concurrency).toEqual({ limit: 1 })
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
    const r = await runLeadFollowupDigest(fakeStep().step, d)
    expect(d.sendDigest).not.toHaveBeenCalled()
    expect(r.emails_sent).toBe(0)
    expect(r.results[0].listed).toBe(1)
    expect(r.results[0].reason).toContain('未启用')
  })

  it('🔴 收件人锁死成 ME 自己的信箱，调用方不能从配置里改掉', async () => {
    const d = deps()
    await runLeadFollowupDigest(fakeStep().step, d)
    expect(d.sendDigest).toHaveBeenCalledWith(
      'CTS Tours NZ',
      expect.any(Array),
      expect.objectContaining({ recipients: [ME_MAIL_TO_ADDRESS] }),
    )
  })

  it('回执里 no_publish 恒为 true —— 这封信不外发给客户', async () => {
    const r = await runLeadFollowupDigest(fakeStep().step, deps())
    expect(r.results.every((x) => x.no_publish === true)).toBe(true)
  })

  it('🔴 回执里不出现客人的名字 / 邮箱 / 电话 —— 隐私不进 Inngest 云端', async () => {
    const r = await runLeadFollowupDigest(fakeStep().step, deps())
    expect(JSON.stringify(r)).not.toContain('王女士')
    expect(JSON.stringify(r)).not.toContain('Best of China')
  })

  it('一条都没有的客户不发信，但回执里要留下积压数字', async () => {
    const d = deps({ findDue: vi.fn(async () => due({ items: [], backlog: 277 })) })
    const r = await runLeadFollowupDigest(fakeStep().step, d)
    expect(d.sendDigest).not.toHaveBeenCalled()
    expect(r.results[0].backlog).toBe(277)
  })

  it('🔴 一个客户挑名单炸了，不牵连别的客户，而且原因要留在回执里', async () => {
    const d = deps({
      supabase: fakeSupabase([
        { id: 'bad', name: '坏客户', facebook_page_id: '1' },
        { id: 'good', name: '好客户', facebook_page_id: '2' },
      ]),
      findDue: vi.fn(async (_s, clientId: string) => {
        if (clientId === 'bad') throw new Error('这个客户的触点表读不出来')
        return due()
      }),
    })
    const r = await runLeadFollowupDigest(fakeStep().step, d)
    expect(r.results).toHaveLength(2)
    expect(r.results[0].reason).toContain('触点表读不出来')
    expect(r.results[1].sent).toBe(true)
    expect(r.emails_sent).toBe(1)
  })

  it('读客户清单失败就整趟失败 —— 不要拿半份客户名单当跑完了', async () => {
    const broken = fakeSupabase(null, { message: '连不上' })
    await expect(runLeadFollowupDigest(fakeStep().step, deps({ supabase: broken }))).rejects.toThrow('连不上')
  })

  it('每个客户各占一个 step —— 出事能看出是哪个客户', async () => {
    const { ids, step } = fakeStep()
    await runLeadFollowupDigest(step, deps())
    expect(ids).toEqual(['load-clients', 'scan-and-send-cts'])
  })
})
