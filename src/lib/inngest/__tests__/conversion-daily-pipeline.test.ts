/**
 * 成交/咨询回传管道每日定时任务 · Inngest 函数装配测试。
 *
 * 测的是**装配**（触发器、并发、重试、四步顺序、单步失败不连坐、运行记录只在
 * step 里写），不是同步/审核本身的业务逻辑（那些各自有自己的测试）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const startCronRunId = vi.fn(async (_jobName: string) => 'run-1')
const finish = vi.fn(async (_opts: Record<string, unknown>) => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (jobName: string) => startCronRunId(jobName),
  cronRunHandle: () => ({ finish }),
  startCronRun: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/meta/capi/writer', () => ({ metaCapiWriter: {} }))

import {
  createConversionDailyPipelineFunction,
  CONVERSION_DAILY_PIPELINE_CRON,
  CONVERSION_DAILY_PIPELINE_TZ,
  CONVERSION_DAILY_PIPELINE_JOB,
} from '../functions/conversion-daily-pipeline'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'

type Fn = ReturnType<typeof createConversionDailyPipelineFunction>
/** Inngest 函数把触发器/重试/并发存在 opts 里——跟 flywheel-seo-weekly.test.ts 同一个读法。 */
function optsOf(fn: Fn) {
  const withOpts = fn as Fn & {
    opts: { triggers?: { cron?: string }[]; retries?: number; concurrency?: { limit: number } }
  }
  return withOpts.opts
}

function fakeStep() {
  const ranStepIds: string[] = []
  let insideStep = false
  return {
    ranStepIds,
    isInsideStep: () => insideStep,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ranStepIds.push(id)
        insideStep = true
        try {
          return await fn()
        } finally {
          insideStep = false
        }
      },
    },
  }
}

describe('注册与命名空间', () => {
  it('注册进了 cloudFunctions，id 带 cloud- 前缀', () => {
    expect(cloudFunctions.map((f) => f.id())).toContain(`${CLOUD_FN_PREFIX}conversion-daily-pipeline`)
  })

  it('🔴 定时器必须带时区——不带的话 Inngest 按 UTC 解释，跑的就不是新西兰早上6点', () => {
    const fn = cloudFunctions.find((f) => f.id().endsWith('conversion-daily-pipeline'))
    const cron = optsOf(fn as Fn).triggers?.[0]?.cron ?? ''
    expect(cron).toContain(`TZ=${CONVERSION_DAILY_PIPELINE_TZ}`)
    expect(cron).toContain(CONVERSION_DAILY_PIPELINE_CRON)
  })

  it('🔴 不许自动重试——③④两步真花钱/真发数据出去，整条重试等于再来一遍', () => {
    const fn = cloudFunctions.find((f) => f.id().endsWith('conversion-daily-pipeline'))
    expect(optsOf(fn as Fn).retries).toBe(0)
  })

  it('并发限制为 1——同一时刻不许两个实例同时跑', () => {
    const fn = cloudFunctions.find((f) => f.id().endsWith('conversion-daily-pipeline'))
    expect(optsOf(fn as Fn).concurrency).toMatchObject({ limit: 1 })
  })
})

describe('四步执行顺序与单步失败隔离', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startCronRunId.mockResolvedValue('run-1')
  })

  async function runPipeline(deps: {
    syncNal?: () => Promise<{ ok: boolean }>
    syncCts?: () => Promise<{ ok: boolean }>
    reviewClient?: (clientId: string) => Promise<{ ran: boolean }>
  }) {
    const reviewCalls: string[] = []
    const fn = createConversionDailyPipelineFunction({
      syncNal: deps.syncNal ?? (async () => ({ ok: true })),
      syncCts: deps.syncCts ?? (async () => ({ ok: true })),
      reviewClient: deps.reviewClient
        ? (clientId: string) => {
            reviewCalls.push(clientId)
            return deps.reviewClient!(clientId)
          }
        : async (clientId: string) => {
            reviewCalls.push(clientId)
            return { ran: true }
          },
    })
    const harness = fakeStep()
    // 实测核实：Inngest 把 handler 挂在函数对象的私有 `fn` 上，跟
    // flywheel-seo-weekly.test.ts 用的是同一个读法（那边跑得通，这里形状一致）。
    const withHandler = fn as unknown as { fn: (a: unknown) => Promise<Record<string, unknown>> }
    const result = await withHandler.fn({ step: harness.step })
    return { result, harness, reviewCalls }
  }

  it('正常路径：四步都跑、都成功，运行记录写"4/4完成、0失败"', async () => {
    const { result, harness, reviewCalls } = await runPipeline({})
    expect(harness.ranStepIds).toEqual(['log-start', 'sync-nal', 'sync-cts', 'ai-review-nal', 'ai-review-cts', 'log-finish'])
    expect(reviewCalls).toEqual(['4ae76381-cd45-43bd-85cd-98cfd7604007', 'c0000000-0000-0000-0000-000000000000'])
    expect((result.nalSync as { ok: boolean }).ok).toBe(true)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ processed: 4, completed: 4, failed: 0 }))
  })

  it('先同步再审核——顺序不能反，不然当天新同步的记录赶不上当天的审核', async () => {
    const { harness } = await runPipeline({})
    const idx = (id: string) => harness.ranStepIds.indexOf(id)
    expect(idx('sync-nal')).toBeLessThan(idx('ai-review-nal'))
    expect(idx('sync-cts')).toBeLessThan(idx('ai-review-cts'))
  })

  it('NAL 同步失败不影响 CTS 同步、也不影响两边的 AI 审核照常跑（互不连坐）', async () => {
    const { result, reviewCalls } = await runPipeline({
      syncNal: async () => {
        throw new Error('模拟 NAL 私信读取失败')
      },
    })
    expect((result.nalSync as { ok: boolean; error?: string }).ok).toBe(false)
    expect((result.nalSync as { error?: string }).error).toContain('模拟 NAL 私信读取失败')
    expect((result.ctsSync as { ok: boolean }).ok).toBe(true)
    // AI 审核两个客户都照常被调用，不因为同步失败而跳过
    expect(reviewCalls).toEqual(['4ae76381-cd45-43bd-85cd-98cfd7604007', 'c0000000-0000-0000-0000-000000000000'])
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ completed: 3, failed: 1 }))
  })

  it('AI 审核那一步抛错也不会让整个函数抛出去——落进运行记录里，不是未捕获异常', async () => {
    const { result } = await runPipeline({
      reviewClient: async (clientId: string) => {
        if (clientId === 'c0000000-0000-0000-0000-000000000000') throw new Error('模拟 AI 调用超时')
        return { ran: true }
      },
    })
    expect((result.ctsReview as { ok: boolean; error?: string }).ok).toBe(false)
    expect((result.ctsReview as { error?: string }).error).toContain('模拟 AI 调用超时')
    expect((result.nalReview as { ok: boolean }).ok).toBe(true)
  })

  it('🔴 开跑记录只在 step 里写——不在 step 外，防止 Inngest 重放时重复插入假记录', async () => {
    await runPipeline({})
    // startCronRunId 只应该被调用一次（一次 step.run 执行一次）
    expect(startCronRunId).toHaveBeenCalledTimes(1)
    expect(startCronRunId).toHaveBeenCalledWith(CONVERSION_DAILY_PIPELINE_JOB)
    expect(finish).toHaveBeenCalledTimes(1)
  })
})
