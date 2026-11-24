/**
 * 每日咨询早报 · Inngest 装配与编排测试。
 * 归类与文案在 `crm/__tests__/enquiry-daily-digest.test.ts`。
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
  createEnquiryDailyDigestFunction,
  runEnquiryDailyDigest,
  enquiryDigestEnabled,
  ENQUIRY_DIGEST_CRON,
  ENQUIRY_DIGEST_JOB,
  ENQUIRY_DIGEST_RECIPIENT,
  ENQUIRY_DIGEST_TZ,
  type EnquiryDigestDeps,
  type EnquiryDigestStep,
} from '../functions/crm-enquiry-daily-digest'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EnquiryTouchRow } from '@/lib/crm/enquiry-daily-digest'

type Fn = ReturnType<typeof createEnquiryDailyDigestFunction>

function optsOf(fn: Fn) {
  return (fn as Fn & {
    opts: {
      triggers?: { cron?: string }[]
      retries?: number
      onFailure?: (ctx: { event: { ts?: number; data: unknown }; error: Error }) => Promise<void>
    }
  }).opts
}

function fakeStep() {
  const ids: string[] = []
  const step: EnquiryDigestStep = {
    run: async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
      ids.push(id)
      return JSON.parse(JSON.stringify(await fn())) as T
    },
  }
  return { ids, step }
}

const NOW = new Date('2026-11-24T19:15:00Z')
const formRow: EnquiryTouchRow = {
  contact_id: 'p1', channel: 'meta_lead_form', source: 'meta_lead_form',
  occurred_at: '2026-11-24T01:00:00Z', summary: null, raw: null,
  metadata: { tour_interest_raw: 'silk_road_–_18_days' },
}

function deps(over: Partial<EnquiryDigestDeps> = {}): EnquiryDigestDeps {
  return {
    supabase: {} as SupabaseClient,
    loadClients: vi.fn(async () => [{ id: 'c1', name: 'CTS Tours NZ' }, { id: 'c2', name: 'Other' }]),
    loadRows: vi.fn(async () => [formRow]),
    loadNames: vi.fn(async () => new Map([['p1', 'Mary Smith']])),
    send: vi.fn(async () => ({ sent: true, recipients: [ENQUIRY_DIGEST_RECIPIENT], messageId: 'msg_1' })),
    env: { ENQUIRY_DAILY_DIGEST_ENABLED: 'true' },
    ...over,
  }
}

beforeEach(() => {
  startCronRunId.mockClear()
  finish.mockClear()
  failOpenCronRuns.mockClear()
})

describe('装配', () => {
  const fn = () => cloudFunctions.find((f) => f.id().endsWith(ENQUIRY_DIGEST_JOB)) as Fn

  it('注册进了 cloudFunctions', () => {
    expect(cloudFunctions.map((f) => f.id())).toContain(`${CLOUD_FN_PREFIX}${ENQUIRY_DIGEST_JOB}`)
  })

  it('🔴 定时器带新西兰时区', () => {
    const cron = optsOf(fn()).triggers?.[0]?.cron ?? ''
    expect(cron).toBe(`TZ=${ENQUIRY_DIGEST_TZ} ${ENQUIRY_DIGEST_CRON}`)
  })

  it('有 onFailure，重试耗尽会把「在跑」的记录收成失败', async () => {
    await optsOf(fn()).onFailure?.({ event: { ts: 1, data: {} }, error: new Error('boom') })
    expect(failOpenCronRuns).toHaveBeenCalledWith(ENQUIRY_DIGEST_JOB, expect.stringContaining('boom'), expect.anything())
  })
})

describe('🔴 授权闸', () => {
  it('收件人锁死成 ME 自己的信箱（还没转给客户）', () => {
    expect(ENQUIRY_DIGEST_RECIPIENT).toBe('hello@magicengine.cloud')
  })

  it('开关默认关着：只取数、一封不发', async () => {
    const d = deps({ env: {} })
    const r = await runEnquiryDailyDigest(fakeStep().step, d, NOW)
    expect(d.send).not.toHaveBeenCalled()
    expect(r.emails_sent).toBe(0)
    expect(r.results[0].enquiries).toBe(1)
    expect(enquiryDigestEnabled({ ENQUIRY_DAILY_DIGEST_ENABLED: 'yes' })).toBe(false)
  })

  it('开关打开时只发给那个字面量收件人', async () => {
    const d = deps()
    await runEnquiryDailyDigest(fakeStep().step, d, NOW)
    for (const call of vi.mocked(d.send).mock.calls) {
      expect(call[0].recipients).toEqual([ENQUIRY_DIGEST_RECIPIENT])
    }
  })
})

describe('编排', () => {
  it('一个客户取数炸了，不牵连别的客户', async () => {
    const d = deps({
      loadRows: vi.fn(async (_s, clientId: string) => {
        if (clientId === 'c1') throw new Error('db down')
        return [formRow]
      }),
    })
    const r = await runEnquiryDailyDigest(fakeStep().step, d, NOW)
    expect(r.results.find((x) => x.client_id === 'c1')?.reason).toBe('db down')
    expect(r.results.find((x) => x.client_id === 'c2')?.sent).toBe(true)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1, completed: 1 }))
  })

  it('取的是新西兰的「昨天」', async () => {
    const d = deps()
    await runEnquiryDailyDigest(fakeStep().step, d, NOW)
    const win = vi.mocked(d.loadRows).mock.calls[0][2]
    expect(new Date(win.startMs).toISOString()).toBe('2026-11-23T11:00:00.000Z')
  })

  it('🔴 回执里不带客人姓名', async () => {
    const r = await runEnquiryDailyDigest(fakeStep().step, deps(), NOW)
    expect(JSON.stringify(r)).not.toContain('Mary')
  })

  it('客户清单读不出来：记失败并抛错让 Inngest 重试', async () => {
    const d = deps({ loadClients: vi.fn(async () => { throw new Error('no clients') }) })
    await expect(runEnquiryDailyDigest(fakeStep().step, d, NOW)).rejects.toThrow('no clients')
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('no clients') }))
  })
})
