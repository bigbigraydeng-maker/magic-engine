import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import {
  createLibaiPromptLibraryMonthlyFunction,
  isFirstWeekNz,
  LIBAI_PROMPT_AUDIT_CRON,
  LIBAI_PROMPT_AUDIT_TZ,
} from '../functions/libai-prompt-library-monthly'
import type { PromptLibraryAudit } from '@/lib/content/prompt-library-audit'

const startCronRunId = vi.fn(async (_jobName: string) => 'run-1')
const finish = vi.fn(async (_opts: Record<string, unknown>) => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (j: string) => startCronRunId(j),
  cronRunHandle: () => ({ finish }),
  startCronRun: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

// 🔴 finish 是模块级 mock，不清的话上一条用例留下的调用会被后面的用例当成自己的第一次调用读。
beforeEach(() => {
  finish.mockClear()
  startCronRunId.mockClear()
})

type Fn = ReturnType<typeof createLibaiPromptLibraryMonthlyFunction>

/** 同 simaqian-reputation-weekly.test.ts 的读法：Inngest 函数把触发器和 id 存在 opts 里。 */
function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: {
      triggers?: { event?: string; cron?: string }[]
      retries?: number
      concurrency?: { limit: number; key?: string }
    }
  }).opts
}

function fakeStep() {
  const ranStepIds: string[] = []
  return {
    ranStepIds,
    step: {
      run: async (id: string, fn: () => Promise<unknown>) => {
        ranStepIds.push(id)
        return await fn()
      },
      sendEvent: async (id: string, _events: unknown[]) => {
        ranStepIds.push(id)
      },
    },
  }
}

const cleanAudit: PromptLibraryAudit = {
  checked_at: '2026-10-06T00:00:00.000Z',
  files_checked: 3,
  findings: [],
  error: null,
}

const twoFindings: PromptLibraryAudit = {
  checked_at: '2026-10-06T00:00:00.000Z',
  files_checked: 3,
  findings: [
    { file: 'a.md', line: 4, reference: 'src/gone.ts', reason: '文件里点名的代码路径在仓库里找不到' },
    { file: 'b.md', line: 0, reference: 'b.md', reason: '变更日志（CHANGELOG.md）从没记录过这个文件' },
  ],
  error: null,
}

const erroredAudit: PromptLibraryAudit = {
  checked_at: '2026-10-06T00:00:00.000Z',
  files_checked: 0,
  findings: [],
  error: '目录读不到',
}

/** 第一个周二那一周（NZ 10 月 6 日）。 */
const firstWeek = () => new Date('2026-10-06T00:00:00Z')
/** 第二周（NZ 10 月 13 日）。 */
const secondWeek = () => new Date('2026-10-13T00:00:00Z')

function runFn(audit: PromptLibraryAudit, now: () => Date) {
  // auditPromptLibrary 是同步函数（读本地文件），假件也要同步——形状跟真实产出一致
  const auditFn = vi.fn((_repoRoot?: string, _now?: Date) => audit)
  const fn = createLibaiPromptLibraryMonthlyFunction({ audit: auditFn, now })
  const harness = fakeStep()
  const result = (fn as unknown as { fn: (a: { step: unknown }) => Promise<unknown> }).fn({
    step: harness.step,
  })
  return { auditFn, harness, result }
}

describe('注册与命名空间', () => {
  it('注册进了 cloudFunctions，id 带 cloud- 前缀', () => {
    const ids = cloudFunctions.map((f) => f.id())
    expect(ids).toContain(`${CLOUD_FN_PREFIX}libai-prompt-library-monthly`)
  })

  it('定时器带时区、周二 09:00，retries 1，并发限 1', () => {
    const fn = cloudFunctions.find((f) => f.id().endsWith('libai-prompt-library-monthly'))!
    const opts = optsOf(fn as unknown as Fn)
    expect(opts.triggers?.[0]?.cron).toBe(`TZ=${LIBAI_PROMPT_AUDIT_TZ} ${LIBAI_PROMPT_AUDIT_CRON}`)
    expect(opts.retries).toBe(1)
    expect(opts.concurrency).toEqual({ limit: 1 })
  })

  it('🔴 定时器落在周二——不是周五(5)也不是周六(6)', () => {
    const dow = LIBAI_PROMPT_AUDIT_CRON.split(' ')[4]
    expect(dow).toBe('2')
    expect(dow).not.toBe('5')
    expect(dow).not.toBe('6')
  })
})

describe('isFirstWeekNz（新西兰时区判 1–7 号）', () => {
  it('NZ 10 月 6 日（周二）→ true', () => {
    expect(isFirstWeekNz(new Date('2026-10-06T00:00:00Z'))).toBe(true)
  })

  it('NZ 10 月 13 日 → false', () => {
    expect(isFirstWeekNz(new Date('2026-10-13T00:00:00Z'))).toBe(false)
  })

  it('边界：NZ 10 月 7 日 → true', () => {
    expect(isFirstWeekNz(new Date('2026-10-07T10:00:00Z'))).toBe(true)
  })

  it('边界：NZ 10 月 8 日 → false', () => {
    expect(isFirstWeekNz(new Date('2026-10-07T13:00:00Z'))).toBe(false)
  })
})

describe('月巡行为（依赖注入版，不碰真文件系统）', () => {
  it('不是本月第一周 → skipped_not_first_week，audit 不调用，finish summary.skipped true', async () => {
    const { auditFn, result } = runFn(cleanAudit, secondWeek)
    const receipt = (await result) as { status: string; findings_count: number }
    expect(receipt.status).toBe('skipped_not_first_week')
    expect(receipt.findings_count).toBe(0)
    expect(auditFn).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        processed: 0,
        summary: expect.objectContaining({ skipped: true, no_publish: true }),
      }),
    )
  })

  it('第一周、两条 finding → completed，findings_count 2，summary.findings 长度 2', async () => {
    const { auditFn, result } = runFn(twoFindings, firstWeek)
    const receipt = (await result) as { status: string; findings_count: number }
    expect(receipt.status).toBe('completed')
    expect(receipt.findings_count).toBe(2)
    expect(auditFn).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        processed: 3,
        completed: 1,
        failed: 0,
        summary: expect.objectContaining({ skipped: false, no_publish: true }),
      }),
    )
    const summary = finish.mock.calls[0][0].summary as { findings: unknown[] }
    expect(summary.findings).toHaveLength(2)
  })

  it('🔴 audit 报错 → finish failed 1 且带 error 字符串', async () => {
    const { result } = runFn(erroredAudit, firstWeek)
    const receipt = (await result) as { status: string; error: string | null }
    expect(receipt.status).toBe('completed')
    expect(receipt.error).toBe('目录读不到')
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ failed: 1, error: '目录读不到' }),
    )
  })

  it('🔴 每一处副作用都在 step 里——log-start 与 log-finish 都进过 ranStepIds', async () => {
    const { harness, result } = runFn(twoFindings, firstWeek)
    await result
    expect(harness.ranStepIds).toContain('log-start')
    expect(harness.ranStepIds).toContain('log-finish')
  })

  it('🔴 跳过那条也把回执写在 step 里', async () => {
    const { harness, result } = runFn(cleanAudit, secondWeek)
    await result
    expect(harness.ranStepIds).toContain('log-start')
    expect(harness.ranStepIds).toContain('log-finish-skipped')
  })
})
