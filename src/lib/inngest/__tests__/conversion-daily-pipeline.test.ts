/**
 * 成交/咨询回传管道每日定时任务 · Inngest 函数装配测试。
 *
 * 测的是**装配**（触发器、并发、重试、onFailure、分块循环怎么推进/怎么停、运行记录
 * 只在 step 里写），不是同步/审核/补发本身的业务逻辑（那些各自有自己的测试）。
 *
 * 2026-09-22 拆块之后新增的契约（两轮设计复审要求的，每条都对应一个「写了保护没接上」的坑）：
 *   · 同步块之间游标靠 step 返回值传递，且能过 JSON（Inngest 记忆化）
 *   · 同步块失败 → 该线余下的块不跑，另一条线和审核照常
 *   · 审核块失败 → 该客户余下的审核块**必须**停（硬顶不能被清零重来）
 *   · 审核块之间 carried = 前几块累计批准的条数/金额
 *   · 块数硬顶到顶 = 失败，log-finish 仍执行
 *   · onFailure → failOpenCronRuns，带失败事件时刻
 *   · 每个 step 的返回值里不含邮箱/完整电话（PII 不进 Inngest 云端）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MAX_BATCH_SIZE } from '@/lib/conversions/ai-auto-review-run'

const failOpenCronRuns = vi.fn<(job: string, message: string, opts: { startedBefore: Date }) => Promise<number>>(async () => 1)
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: vi.fn(async () => 'run-1'),
  cronRunHandle: () => ({ finish: vi.fn() }),
  startCronRun: vi.fn(),
  failOpenCronRuns: (job: string, message: string, opts: { startedBefore: Date }) => failOpenCronRuns(job, message, opts),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/meta/capi/writer', () => ({ metaCapiWriter: {} }))

import {
  createConversionDailyPipelineFunction,
  runConversionDailyPipeline,
  CONVERSION_DAILY_PIPELINE_CRON,
  CONVERSION_DAILY_PIPELINE_TZ,
  CONVERSION_DAILY_PIPELINE_JOB,
  CONVERSION_DAILY_PIPELINE_RETRIES,
  AI_REVIEW_CHUNK_SIZE,
  MAX_SYNC_CHUNKS,
  TRANSIENT_BACKOFF_MS,
  TRANSIENT_MAX_RETRIES,
  isTransientError,
  type ConversionPipelineDeps,
  type PipelineStep,
} from '../functions/conversion-daily-pipeline'
import type { CtsCrmSyncSummary } from '@/lib/conversions/cts-crm-sheet-sync-run'
import type { NalMessengerSyncSummary } from '@/lib/conversions/nal-messenger-lead-sync-run'
import type { RunSummary } from '@/lib/conversions/ai-auto-review-run'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'

const NAL = '4ae76381-cd45-43bd-85cd-98cfd7604007'
const CTS = 'c0000000-0000-0000-0000-000000000000'

type Fn = ReturnType<typeof createConversionDailyPipelineFunction>
/** Inngest 函数把触发器/重试/并发/onFailure 存在 opts 里——跟 flywheel-seo-weekly.test.ts 同一个读法（实测那边跑得通）。 */
function optsOf(fn: Fn) {
  const withOpts = fn as Fn & {
    opts: {
      triggers?: { cron?: string }[]
      retries?: number
      concurrency?: { limit: number }
      onFailure?: (ctx: { event: { ts?: number; data: unknown }; error: Error }) => Promise<void>
    }
  }
  return withOpts.opts
}

/**
 * 假 step：记 id 顺序，并把每个返回值走一遍 JSON.parse(JSON.stringify()) ——
 * 跟 Inngest 记忆化一样，Date/undefined/Infinity 在这一层会变形，游标要是带了这种值这里先炸。
 */
function fakeStep() {
  const ranStepIds: string[] = []
  const outputs: unknown[] = []
  const sleeps: Array<{ id: string; ms: number }> = []
  const step: PipelineStep = {
    run: async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
      ranStepIds.push(id)
      const value = JSON.parse(JSON.stringify(await fn())) as T
      outputs.push(value)
      return value
    },
    sleep: async (id, ms) => {
      ranStepIds.push(`sleep:${id}`)
      sleeps.push({ id, ms })
    },
  }
  return { ranStepIds, outputs, sleeps, step }
}

/** 造一个长得像 Google Sheets 客户端 / SDK 抛出来的 HTTP 错误。 */
function httpError(status: number, message = `HTTP ${status}`): Error & { httpStatus: number } {
  return Object.assign(new Error(message), { httpStatus: status })
}

function ctsSummary(over: Partial<CtsCrmSyncSummary> = {}): CtsCrmSyncSummary {
  return {
    totalCrmRows: 0,
    excludedNoPhone: 0,
    excludedByNotes: 0,
    excludedNoInterest: 0,
    excludedNoConversation: 0,
    rejectedStaleLeads: 0,
    excludedNoDate: 0,
    insertedLeads: 0,
    insertedPurchases: 0,
    skippedAlreadySynced: 0,
    heldForManualReview: [],
    contactNotLinked: 0,
    insertErrors: [],
    cappedAtMaxInserts: false,
    qualifiedFromConversation: 0, conversationReadFailed: 0, skippedPastWindow: 0,
    ...over,
  }
}
function nalSummary(over: Partial<NalMessengerSyncSummary> = {}): NalMessengerSyncSummary {
  return {
    totalConversations: 0,
    qualifiedLeadsFound: 0,
    insertedLeads: 0,
    skippedAlreadySynced: 0,
    skippedNoPsid: 0,
    skippedNoContact: 0,
    insertErrors: [],
    cappedAtMaxInserts: false,
    ...over,
  }
}
function ranSummary(processed: number, over: Partial<Extract<RunSummary, { ran: true }>> = {}): RunSummary {
  return { ran: true, processed, approved: 0, approvedAmountMinor: 0, rejected: 0, uncertain: 0, expired: 0, items: [], ...over }
}

type ReviewCall = { clientId: string; opts: { maxBatchSize?: number; carried?: { approvedCount: number; approvedAmountMinor: number }; nowIso: string } }
type ResendCall = { clientId: string; opts: { nowIso: string } }

/** 默认假依赖：每条同步线 2 块、审核每客户 1 块（processed < 块大小即停）、补发空跑。 */
function makeDeps(over: Partial<ConversionPipelineDeps> = {}) {
  const calls = { nal: [] as unknown[], cts: [] as unknown[], review: [] as ReviewCall[], resend: [] as ResendCall[] }
  const deps: ConversionPipelineDeps = {
    sheetSyncEnabled: true,
    syncNalChunk: async (cursor) => {
      calls.nal.push(cursor)
      const second = cursor.offset > 0
      return { summary: nalSummary({ totalConversations: 1, insertedLeads: 1 }), nextOffset: cursor.offset + 1, insertedSoFar: cursor.insertedSoFar + 1, done: second }
    },
    syncCtsChunk: async (cursor) => {
      calls.cts.push(cursor)
      const second = cursor.offset > 0
      return { summary: ctsSummary({ totalCrmRows: 1, insertedLeads: 1 }), nextOffset: cursor.offset + 1, totalSheetRows: 2, insertedSoFar: cursor.insertedSoFar + 1, done: second }
    },
    reviewClient: async (clientId, opts) => {
      calls.review.push({ clientId, opts })
      return ranSummary(1)
    },
    resendFailed: async (clientId, opts) => {
      calls.resend.push({ clientId, opts })
      return { candidates: 0 }
    },
    ...over,
  }
  // 覆盖版的 reviewClient/resendFailed 也要记调用——包一层。
  const recorded: ConversionPipelineDeps = {
    ...deps,
    reviewClient: (clientId, opts) => {
      if (over.reviewClient) calls.review.push({ clientId, opts })
      return deps.reviewClient(clientId, opts)
    },
    resendFailed: (clientId, opts) => {
      if (over.resendFailed) calls.resend.push({ clientId, opts })
      return deps.resendFailed(clientId, opts)
    },
  }
  return { deps: recorded, calls }
}

function makeRunLog() {
  const finish = vi.fn(async () => {})
  const start = vi.fn(async () => 'run-1')
  return { runLog: { start, finish }, finish, start }
}

async function run(over: Partial<ConversionPipelineDeps> = {}) {
  const { deps, calls } = makeDeps(over)
  const harness = fakeStep()
  const log = makeRunLog()
  const result = await runConversionDailyPipeline(harness.step, deps, log.runLog)
  return { result, harness, calls, ...log }
}

describe('注册与命名空间', () => {
  const fn = () => cloudFunctions.find((f) => f.id().endsWith('conversion-daily-pipeline')) as Fn

  it('注册进了 cloudFunctions，id 带 cloud- 前缀', () => {
    expect(cloudFunctions.map((f) => f.id())).toContain(`${CLOUD_FN_PREFIX}conversion-daily-pipeline`)
  })

  it('🔴 定时器必须带时区——不带的话 Inngest 按 UTC 解释，跑的就不是新西兰早上6点', () => {
    const cron = optsOf(fn()).triggers?.[0]?.cron ?? ''
    expect(cron).toContain(`TZ=${CONVERSION_DAILY_PIPELINE_TZ}`)
    expect(cron).toContain(CONVERSION_DAILY_PIPELINE_CRON)
  })

  it('🔴 retries=2：只重跑挂掉的那一步（step 记忆化），不是 0——拆成几十块后一次网络抖动不能让全天报废', () => {
    expect(CONVERSION_DAILY_PIPELINE_RETRIES).toBe(2)
    expect(optsOf(fn()).retries).toBe(CONVERSION_DAILY_PIPELINE_RETRIES)
  })

  it('并发限制为 1——同一时刻不许两个实例同时跑', () => {
    expect(optsOf(fn()).concurrency).toMatchObject({ limit: 1 })
  })

  it('🔴 onFailure 真的挂上了，并把停在 running 的运行记录收成 failed（带失败事件时刻）', async () => {
    const onFailure = optsOf(fn()).onFailure
    expect(typeof onFailure).toBe('function')
    failOpenCronRuns.mockClear()
    await onFailure!({ event: { ts: 1_800_000_000_000, data: { error: { message: '被网关掐断' } } }, error: new Error('被网关掐断') })
    expect(failOpenCronRuns).toHaveBeenCalledTimes(1)
    const [job, message, opts] = failOpenCronRuns.mock.calls[0]
    expect(job).toBe(CONVERSION_DAILY_PIPELINE_JOB)
    expect(message).toContain('被网关掐断')
    expect(opts.startedBefore.getTime()).toBe(1_800_000_000_000)
  })
})

describe('分块循环怎么推进、怎么停', () => {
  beforeEach(() => vi.clearAllMocks())

  it('正常路径：同步各 2 块、审核各 1 块、补发各 1 步，顺序正确，运行记录写 6/6 完成', async () => {
    const { harness, finish, start, calls } = await run()
    expect(harness.ranStepIds).toEqual([
      'log-start',
      'sync-nal-1',
      'sync-nal-2',
      'sync-cts-1',
      'sync-cts-2',
      'ai-review-nal-1',
      'ai-review-cts-1',
      'resend-failed-nal',
      'resend-failed-cts',
      'log-finish',
    ])
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(CONVERSION_DAILY_PIPELINE_JOB)
    expect(finish).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledWith('run-1', expect.any(Number), expect.objectContaining({ processed: 6, completed: 6, failed: 0 }))
    expect(calls.review.map((c) => c.clientId)).toEqual([NAL, CTS])
    expect(calls.resend.map((c) => c.clientId)).toEqual([NAL, CTS])
  })

  it('表格成交同步默认关：不调用同步块，步骤名不能用 sync-cts- 前缀来判断', async () => {
    const { harness, calls, result } = await run({ sheetSyncEnabled: false })
    expect(calls.cts).toEqual([])
    expect(harness.ranStepIds).toContain('sync-cts-skipped')
    expect(harness.ranStepIds.filter((id) => /^sync-cts-\d/.test(id))).toEqual([])
    expect(result.ctsSync).toEqual({ ok: true, reason: 'sheet_deal_sync_off' })
  })

  it('邮箱付款识别段：同步之后、AI 审核之前跑，计入运行记录 7/7', async () => {
    const detect = vi.fn(async () => ({ ok: true }))
    const { harness, finish, result } = await run({ detectPayments: detect })
    expect(harness.ranStepIds).toEqual([
      'log-start',
      'sync-nal-1',
      'sync-nal-2',
      'sync-cts-1',
      'sync-cts-2',
      'detect-payments',
      'ai-review-nal-1',
      'ai-review-cts-1',
      'resend-failed-nal',
      'resend-failed-cts',
      'log-finish',
    ])
    expect(detect).toHaveBeenCalledTimes(1)
    expect(result).toHaveProperty('payments')
    expect(finish).toHaveBeenCalledWith('run-1', expect.any(Number), expect.objectContaining({ processed: 7, completed: 7, failed: 0 }))
  })

  it('邮箱付款识别段失败 → 记失败，但同步已完成、审核与补发照常（互不连坐）', async () => {
    const { result, harness, finish } = await run({
      detectPayments: async () => {
        throw new Error('模拟 Graph 读取失败')
      },
    })
    expect(result.payments).toMatchObject({ ok: false, error: expect.stringContaining('模拟 Graph 读取失败') })
    expect(harness.ranStepIds).toContain('ai-review-cts-1')
    expect(harness.ranStepIds).toContain('resend-failed-cts')
    expect(finish).toHaveBeenCalledWith('run-1', expect.any(Number), expect.objectContaining({ processed: 7, completed: 6, failed: 1 }))
  })

  it('游标靠上一块的返回值推进：offset / insertedSoFar 跨块传递，且经过了 JSON 序列化', async () => {
    const { calls, result } = await run()
    expect(calls.cts).toEqual([
      { offset: 0, limit: 20, insertedSoFar: 0 },
      { offset: 1, limit: 20, insertedSoFar: 1 },
    ])
    expect(calls.nal[0]).toMatchObject({ offset: 0, limit: 25, insertedSoFar: 0, createdBeforeIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
    expect(calls.nal[1]).toMatchObject({ offset: 1, insertedSoFar: 1 })
    // 跨块汇总是相加的
    expect(result.ctsSync).toMatchObject({ ok: true, chunks: 2, summary: { totalCrmRows: 2, insertedLeads: 2 } })
    if (!('durationMs' in result.ctsSync)) throw new Error('sheet sync did not run')
    expect(result.ctsSync.durationMs).toHaveLength(2)
  })

  it('同步块失败 → 该线余下的块不跑；另一条线、审核、补发照常（互不连坐）', async () => {
    const { result, harness, finish } = await run({
      syncNalChunk: async () => {
        throw new Error('模拟 NAL 私信读取失败')
      },
    })
    expect(harness.ranStepIds.filter((id) => id.startsWith('sync-nal'))).toEqual(['sync-nal-1'])
    expect(result.nalSync).toMatchObject({ ok: false, error: expect.stringContaining('模拟 NAL 私信读取失败'), chunks: 1 })
    expect(result.ctsSync).toMatchObject({ ok: true })
    expect(harness.ranStepIds).toContain('ai-review-nal-1')
    expect(harness.ranStepIds).toContain('resend-failed-nal')
    expect(finish).toHaveBeenCalledWith('run-1', expect.any(Number), expect.objectContaining({ completed: 5, failed: 1 }))
  })

  it(`同步块跑满 ${MAX_SYNC_CHUNKS} 块仍没到表尾 → 算失败（表尾永远同步不到），log-finish 仍执行`, async () => {
    const { result, harness } = await run({
      syncCtsChunk: async (cursor) => ({ summary: ctsSummary(), nextOffset: cursor.offset + 1, totalSheetRows: 99999, insertedSoFar: 0, done: false }),
    })
    expect(harness.ranStepIds.filter((id) => id.startsWith('sync-cts'))).toHaveLength(MAX_SYNC_CHUNKS)
    expect(result.ctsSync).toMatchObject({ ok: false, chunks: MAX_SYNC_CHUNKS })
    expect(result.ctsSync.ok === false && result.ctsSync.error).toContain('表尾')
    expect(harness.ranStepIds.at(-1)).toBe('log-finish')
  })

  it('审核块 processed 满一块就再来一块，不满就停；日上限是 MAX_BATCH_SIZE 条（60 = 12 块 × 5）', async () => {
    const { harness, calls } = await run({
      reviewClient: async (clientId) => (clientId === CTS ? ranSummary(AI_REVIEW_CHUNK_SIZE) : ranSummary(1)),
    })
    expect(harness.ranStepIds.filter((id) => id.startsWith('ai-review-nal'))).toEqual(['ai-review-nal-1'])
    expect(harness.ranStepIds.filter((id) => id.startsWith('ai-review-cts'))).toHaveLength(MAX_BATCH_SIZE / AI_REVIEW_CHUNK_SIZE)
    expect(calls.review.filter((c) => c.clientId === CTS)).toHaveLength(MAX_BATCH_SIZE / AI_REVIEW_CHUNK_SIZE)
  })

  it('🔴 审核块之间 carried = 前几块累计批准的条数/金额；首块不带 carried（首块才做熔断预检）', async () => {
    let k = 0
    const { calls, result } = await run({
      reviewClient: async (clientId) => {
        if (clientId !== CTS) return ranSummary(0)
        k++
        return k <= 2 ? ranSummary(AI_REVIEW_CHUNK_SIZE, { approved: 2, approvedAmountMinor: 1000 }) : ranSummary(1)
      },
    })
    const cts = calls.review.filter((c) => c.clientId === CTS).map((c) => c.opts)
    expect(cts).toHaveLength(3)
    expect(cts[0].carried).toBeUndefined()
    expect(cts[0].maxBatchSize).toBe(AI_REVIEW_CHUNK_SIZE)
    expect(cts[1].carried).toEqual({ approvedCount: 2, approvedAmountMinor: 1000 })
    expect(cts[2].carried).toEqual({ approvedCount: 4, approvedAmountMinor: 2000 })
    // 三块用同一个 now
    expect(new Set(cts.map((c) => c.nowIso)).size).toBe(1)
    expect(result.ctsReview).toMatchObject({ ok: true, chunks: 3, summary: { ran: true, processed: 11, approved: 4, approvedAmountMinor: 2000 } })
  })

  it('🔴 审核块失败 → 该客户余下的审核块必须停（失败的块拿不回它已批准的数，继续跑等于硬顶清零）', async () => {
    let k = 0
    const { harness, result, finish } = await run({
      reviewClient: async (clientId) => {
        if (clientId !== CTS) return ranSummary(0)
        k++
        if (k === 2) throw new Error('模拟 AI 调用超时')
        return ranSummary(AI_REVIEW_CHUNK_SIZE, { approved: 5, approvedAmountMinor: 500 })
      },
    })
    expect(harness.ranStepIds.filter((id) => id.startsWith('ai-review-cts'))).toEqual(['ai-review-cts-1', 'ai-review-cts-2'])
    expect(result.ctsReview).toMatchObject({ ok: false, error: expect.stringContaining('模拟 AI 调用超时'), chunks: 2 })
    expect(result.nalReview).toMatchObject({ ok: true })
    expect(harness.ranStepIds).toContain('resend-failed-cts')
    expect(finish).toHaveBeenCalledWith('run-1', expect.any(Number), expect.objectContaining({ failed: 1 }))
  })

  it('首块就 ran:false（开关关着 / 熔断）→ 只跑 1 块，如实报原因', async () => {
    const { harness, result } = await run({
      reviewClient: async (clientId) => (clientId === CTS ? { ran: false, reason: 'disabled' } : ranSummary(0)),
    })
    expect(harness.ranStepIds.filter((id) => id.startsWith('ai-review-cts'))).toEqual(['ai-review-cts-1'])
    expect(result.ctsReview).toMatchObject({ ok: true, summary: { ran: false, reason: 'disabled' } })
  })

  it('中途熔断（第 2 块 ran:false）→ 停，保留前几块的汇总并附上原因', async () => {
    let k = 0
    const { result } = await run({
      reviewClient: async (clientId) => {
        if (clientId !== CTS) return ranSummary(0)
        k++
        return k === 1 ? ranSummary(AI_REVIEW_CHUNK_SIZE, { approved: 3 }) : { ran: false, reason: 'circuit_breaker_tripped', detail: '硬顶' }
      },
    })
    expect(result.ctsReview).toMatchObject({ ok: true, chunks: 2, summary: { approved: 3, stoppedReason: 'circuit_breaker_tripped', stoppedDetail: '硬顶' } })
  })

  it('补发步骤拿到的 now 跟审核同一个，且抛错只算那一段失败', async () => {
    const { result, calls } = await run({
      resendFailed: async (clientId) => {
        if (clientId === CTS) throw new Error('模拟补发查询失败')
        return {}
      },
    })
    expect(result.ctsResend).toMatchObject({ ok: false, error: expect.stringContaining('模拟补发查询失败') })
    expect(result.nalResend).toMatchObject({ ok: true })
    expect(calls.resend[0].opts.nowIso).toBe(calls.review[0].opts.nowIso)
  })

  it('🔴 每个 step 的返回值不含邮箱、不含电话样的数字串（PII 不进 Inngest 云端）', async () => {
    const { harness } = await run({
      syncCtsChunk: async () => ({
        summary: ctsSummary({ heldForManualReview: [{ phoneMasked: '***3598', tourInterest: 'Golden China', reason: '查不到价' }], insertErrors: [{ phoneMasked: '***0001', error: 'x' }] }),
        nextOffset: 1,
        totalSheetRows: 1,
        insertedSoFar: 0,
        done: true,
      }),
    })
    for (const out of harness.outputs) {
      const text = JSON.stringify(out)
      expect(text).not.toMatch(/@/)
      // 电话是字符串（带引号），8 位以上；log-start 的 startedAt 是数字时间戳、不带引号，不算。
      expect(text).not.toMatch(/"\+?\d{8,}"/)
    }
  })

  it('🔴 开跑记录只在 step 里写——不在 step 外，防止 Inngest 重放时重复插入假记录', async () => {
    const { harness, start } = await run()
    expect(harness.ranStepIds[0]).toBe('log-start')
    expect(start).toHaveBeenCalledTimes(1)
  })
})

describe('瞬时错误：sleep 一会儿再把同一块当新 step 重跑（魏征实施后复审 MAJOR：Sheets 每分钟 60 次读配额）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('isTransientError：429 / 5xx（httpStatus 或 status 字段）/ fetch failed 算瞬时；业务错误、4xx 不算', () => {
    expect(isTransientError(httpError(429))).toBe(true)
    expect(isTransientError(httpError(503))).toBe(true)
    expect(isTransientError(Object.assign(new Error('overloaded'), { status: 529 }))).toBe(true)
    expect(isTransientError(Object.assign(new TypeError('fetch failed'), {}))).toBe(true)
    expect(isTransientError(httpError(400))).toBe(false)
    expect(isTransientError(httpError(401))).toBe(false)
    expect(isTransientError(new Error('读取已同步记录失败：permission denied'))).toBe(false)
    expect(isTransientError('string')).toBe(false)
    expect(isTransientError(null)).toBe(false)
  })

  it('CTS 第 2 块撞 429 → step.sleep 65 秒 → 以新 step id 重跑同一块（游标不变）→ 继续到表尾', async () => {
    let calls = 0
    const { harness, result, calls: c } = await run({
      syncCtsChunk: async (cursor) => {
        calls++
        if (calls === 2) throw httpError(429, 'Quota exceeded for quota metric Read requests')
        return { summary: ctsSummary({ totalCrmRows: 1 }), nextOffset: cursor.offset + 1, totalSheetRows: 2, insertedSoFar: 0, done: cursor.offset > 0 }
      },
    })
    const cts = harness.ranStepIds.filter((id) => id.includes('sync-cts'))
    expect(cts).toEqual(['sync-cts-1', 'sync-cts-2', 'sleep:sync-cts-2-backoff-1', 'sync-cts-2-retry-1'])
    expect(harness.sleeps).toEqual([{ id: 'sync-cts-2-backoff-1', ms: TRANSIENT_BACKOFF_MS }])
    expect(TRANSIENT_BACKOFF_MS).toBeGreaterThanOrEqual(60_000) // 配额按分钟算
    // 重跑的那一块拿到的是同一个游标
    expect(c.cts[1]).toEqual(c.cts[2])
    expect(result.ctsSync).toMatchObject({ ok: true, chunks: 2, transientRetries: 1, summary: { totalCrmRows: 2 } })
  })

  it(`连续 ${TRANSIENT_MAX_RETRIES + 1} 次瞬时错误 → 放弃该线，记 transient:true，其余段照常`, async () => {
    const { harness, result } = await run({
      syncCtsChunk: async () => {
        throw httpError(429)
      },
    })
    const cts = harness.ranStepIds.filter((id) => id.startsWith('sync-cts'))
    expect(cts).toEqual(['sync-cts-1', 'sync-cts-1-retry-1', 'sync-cts-1-retry-2'])
    expect(harness.sleeps).toHaveLength(TRANSIENT_MAX_RETRIES)
    expect(result.ctsSync).toMatchObject({ ok: false, transient: true, transientRetries: TRANSIENT_MAX_RETRIES })
    expect(harness.ranStepIds).toContain('ai-review-cts-1')
    expect(harness.ranStepIds.at(-1)).toBe('log-finish')
  })

  it('业务错误（不是 429/5xx/断网）不 sleep、不重跑，直接停该线', async () => {
    const { harness, result } = await run({
      syncCtsChunk: async () => {
        throw httpError(403, '没权限读这张表')
      },
    })
    expect(harness.ranStepIds.filter((id) => id.includes('sync-cts'))).toEqual(['sync-cts-1'])
    expect(harness.sleeps).toHaveLength(0)
    expect(result.ctsSync).toMatchObject({ ok: false, transient: false })
  })

  it('审核块撞 AI 上游 529 → 同样 sleep 后重跑，carried 不变', async () => {
    let k = 0
    const { harness, calls } = await run({
      reviewClient: async (clientId) => {
        if (clientId !== CTS) return ranSummary(0)
        k++
        if (k === 2) throw Object.assign(new Error('Overloaded'), { status: 529 })
        return k === 1 ? ranSummary(AI_REVIEW_CHUNK_SIZE, { approved: 1, approvedAmountMinor: 10 }) : ranSummary(1)
      },
    })
    expect(harness.ranStepIds.filter((id) => id.includes('ai-review-cts'))).toEqual([
      'ai-review-cts-1',
      'ai-review-cts-2',
      'sleep:ai-review-cts-2-backoff-1',
      'ai-review-cts-2-retry-1',
    ])
    const cts = calls.review.filter((c) => c.clientId === CTS)
    expect(cts[1].opts.carried).toEqual(cts[2].opts.carried)
  })
})
