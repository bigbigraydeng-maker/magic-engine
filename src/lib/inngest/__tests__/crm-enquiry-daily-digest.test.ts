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
  enquiryDigestPaused,
  recipientsFor,
  ENQUIRY_DIGEST_CRON,
  ENQUIRY_DIGEST_JOB,
  ENQUIRY_DIGEST_RECIPIENTS,
  ENQUIRY_DIGEST_TZ,
  NO_RECIPIENT_REASON,
  PAUSED_REASON,
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

const NOW = new Date('2026-11-24T18:00:00Z') // NZDT 11-25 07:00
const CTS = 'c0000000-0000-0000-0000-000000000000'
const CTS_INFO = 'info@ctstours.co.nz'
const formRow: EnquiryTouchRow = {
  contact_id: 'p1', channel: 'meta_lead_form', source: 'meta_lead_form',
  occurred_at: '2026-11-24T01:00:00Z', summary: null, raw: null,
  metadata: { tour_interest_raw: 'silk_road_–_18_days' },
}

function deps(over: Partial<EnquiryDigestDeps> = {}): EnquiryDigestDeps {
  return {
    supabase: {} as SupabaseClient,
    loadClients: vi.fn(async () => [{ id: CTS, name: 'CTS Tours NZ' }, { id: 'c2', name: 'Other' }]),
    loadRows: vi.fn(async () => [formRow]),
    loadNames: vi.fn(async () => new Map([['p1', 'Mary Smith']])),
    send: vi.fn(async (p: { recipients: string[] }) => ({ sent: true, recipients: p.recipients, messageId: 'msg_1' })),
    env: {},
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
  it('收件人表里只有 CTS → info@ctstours.co.nz（PM 2026-11-25 原话）', () => {
    expect(Object.keys(ENQUIRY_DIGEST_RECIPIENTS)).toEqual([CTS])
    expect(recipientsFor(CTS)).toEqual([CTS_INFO])
    expect(recipientsFor('c2')).toEqual([])
  })

  it('改不动收件人表（冻结）', () => {
    expect(Object.isFrozen(ENQUIRY_DIGEST_RECIPIENTS)).toBe(true)
    expect(Object.isFrozen(ENQUIRY_DIGEST_RECIPIENTS[CTS])).toBe(true)
  })

  it('只给表里的客户发，发给表里的信箱；不在表里的只取数不发', async () => {
    const d = deps()
    const r = await runEnquiryDailyDigest(fakeStep().step, d, NOW)
    expect(vi.mocked(d.send)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(d.send).mock.calls[0][0].recipients).toEqual([CTS_INFO])
    const other = r.results.find((x) => x.client_id === 'c2')
    expect(other?.sent).toBe(false)
    expect(other?.reason).toBe(NO_RECIPIENT_REASON)
    expect(other?.enquiries).toBe(1)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 0, completed: 1 }))
  })

  it('踩下紧急刹车：一封不发，不算失败', async () => {
    const d = deps({ env: { ENQUIRY_DAILY_DIGEST_PAUSED: 'true' } })
    const r = await runEnquiryDailyDigest(fakeStep().step, d, NOW)
    expect(d.send).not.toHaveBeenCalled()
    expect(r.results.find((x) => x.client_id === CTS)?.reason).toBe(PAUSED_REASON)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 0 }))
    expect(enquiryDigestPaused({ ENQUIRY_DAILY_DIGEST_PAUSED: 'yes' })).toBe(false)
  })

  it('🔴 发信带去重键：同一客户同一天只受理一封', async () => {
    const d = deps()
    await runEnquiryDailyDigest(fakeStep().step, d, NOW)
    expect(vi.mocked(d.send).mock.calls[0][0].idempotencyKey)
      .toBe(`${ENQUIRY_DIGEST_JOB}:${CTS}:2026-11-23T11:00:00.000Z`)
  })

  it('发出去了 no_publish 才是 false', async () => {
    const r = await runEnquiryDailyDigest(fakeStep().step, deps(), NOW)
    expect(r.results.find((x) => x.client_id === CTS)?.no_publish).toBe(false)
    expect(r.results.find((x) => x.client_id === 'c2')?.no_publish).toBe(true)
  })
})

describe('编排', () => {
  it('一个客户取数炸了，不牵连别的客户', async () => {
    const d = deps({
      loadRows: vi.fn(async (_s, clientId: string) => {
        if (clientId === CTS) throw new Error('db down')
        return [formRow]
      }),
    })
    const r = await runEnquiryDailyDigest(fakeStep().step, d, NOW)
    expect(r.results.find((x) => x.client_id === CTS)?.reason).toBe('db down')
    expect(r.results.find((x) => x.client_id === 'c2')?.enquiries).toBe(1)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1, completed: 0 }))
  })

  it('定时器是新西兰早上 7 点', () => {
    expect(ENQUIRY_DIGEST_CRON).toBe('0 7 * * *')
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
