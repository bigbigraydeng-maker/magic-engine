/**
 * 成交/咨询回传管道：每天自动跑一遍（PM 拍板 2026-09-15："每天有新客户咨询,
 * 为何被判定太老了" → 查出根因是同步这一步还是纯手动、没有每天自动跑 → PM 拍板
 * "做"）。
 *
 * 六段顺序执行，一段失败不挡下一段（各自用 try/catch 包起来，互不连坐）：
 *   1. `sync-nal-N`      —— 扫 NAL 私信，判有效咨询，写 `me_sale_outcomes`（pending_review）
 *   2. `sync-cts-N`      —— 扫 CTS 表格，同上
 *   3. `ai-review-nal-N` —— 对 NAL 的 `pending_review` 记录跑 AI 判断+自动发送
 *   4. `ai-review-cts-N` —— 对 CTS 同上
 *   5. `resend-failed-nal` —— 令牌修好后，把之前因授权失效没发出去的已批准记录补发
 *   6. `resend-failed-cts` —— 同上
 *
 * 先同步再审核，同一天新同步进来的记录当天就能被审核到，不用等下一轮。
 *
 * 🔴 **2026-09-22 拆块（PITFALLS F10 第二实例）**：原来 `sync-cts` 一步处理整张
 *    ~600 行表格，实测跑 4–24 分钟，被网关 ~125 秒超时（PITFALLS F8）强杀 →
 *    步骤失败 → 工作流静默死 → 9/16 起 6 天 `cron_run_logs` 全停在 running、AI 审核
 *    一次都没跑到。现在每个 `step.run` 只处理一小块（CTS 20 行 / NAL 25 个对话 /
 *    AI 审核 5 条），块之间用步骤返回值传游标（全是 number/string，能过 JSON），
 *    单步目标 ≤ 60 秒、硬上限 125 秒。**不许在 step.run 里 setTimeout 轮询**（F10）。
 *    每块的耗时记进 summary（`durationMs`），上线第一周看真实分布再调块大小。
 *
 * 🔴 **块失败的两种处理**：同步块失败（`ok:false`）→ 该客户余下的块不跑（拿不到下一个
 *    游标），但不影响另一个客户、也不影响审核；审核块失败 → 该客户余下的审核块**必须**
 *    停（魏征复审 BLOCKER）：失败的块拿不回它已批准的条数/金额，继续跑等于把「单次
 *    运行硬顶」清零重来。
 *
 * 🔴 **这是本仓第一次让"会真花钱/真发数据出去"的步骤（③④）接上自动定时**——
 *    之前两轮设计复审明确建议"先观察几天判断质量和熔断阈值，再决定要不要接定时"
 *    （见 `ai-auto-review-run.ts` 文件头），这次是 PM 在看到一次干净的手动试跑结果
 *    （15 条：14 条正确判过期不发送、1 条 AI 拿不准放着、0 条误发）之后明确拍板"做"，
 *    不是我自己绕过那条建议——这条历史必须留在这里，不然以后有人以为这是随手加的。
 *
 * 🔴 **不做成"派单+单客户 event"两段式**（对照 `flywheel-seo-weekly.ts` 的两段模式）：
 *    那边要两段是因为客户名单是动态查出来的、数量不定，用 event fan-out 天然并发；
 *    这里永远只有 NAL/CTS 两个写死的客户，顺序执行一个函数就够，没必要为"看起来
 *    更像标准范式"而引入用不上的复杂度。
 *
 * 🔴 **`retries: 2`（2026-09-22 起，原来是 0）**——Inngest 重试时已成功的 step 走缓存，
 *    **只重跑挂掉的那一步**，不是"四步全部再来一遍"（子牙 2026-09-07 在
 *    `messenger-brief-after-sync.ts` 复审时已经写死的结论，这里第一版抄错了 worker 的
 *    0）。它管的是「step 根本没回应」的那类失败：网关强杀、进程被杀、`log-start`/
 *    `log-finish` 抛错。块**内部**的异常被 `guarded()` 吞成 `ok:false`，Inngest 看不到、
 *    不会重试——所以瞬时错误（Sheets 429 限流、fetch 断网、上游 5xx）由本文件自己处理：
 *    `step.sleep` 等一会儿再把那一块当新 step 重跑一次（见 `TRANSIENT_*`），不是在
 *    step 里 setTimeout（F10）；业务错误照旧 `ok:false` 停该线。重跑一块是安全的：
 *    同步块靠幂等键；审核块里已批准的行状态已变、不会再被捞到；发送有
 *    `post_started_at` 抢占，卡在 `sending` 的由补发步骤推给状态机转 `in_doubt` 交人。
 *    人在 Inngest 后台手动点 "Replay" 是另一回事：那会开全新的 run id，step 缓存不复用，
 *    四段全部真跑一遍——那种场景下兜底的仍是 `writeback-service.ts` 的 CAS 幂等。
 *
 * 🔴 **`now` 只给判断用，不给发送用**（子牙实施后复审 MAJOR）：`log-start` 取一次的
 *    `nowIso` 传给审核/补发做「7 天窗口」「6 小时冷却」的判断，保证跨块口径一致；但
 *    `sendApprovedOutcome()` 必须用真实时间——它拿 `now` 写 `last_attempt_at`，再用
 *    `now - last_attempt_at` 判「卡在 sending 超过 5 分钟」。同步几十块跑完后 `nowIso`
 *    已落后十几分钟，若透传进去，写出的 `last_attempt_at` 就是过去时，看板那边用真实时间
 *    一算就把在途的那 1 秒发送误判成断线 → 转 in_doubt → 回执丢失 → 人点重发 → 双发。
 *    这正是 2026-09-05 那条双发路径。`ai-auto-review-run.ts` / `writeback-resend-run.ts`
 *    调发送时都不透传 `now`。
 *
 * 🔴 **`concurrency: { limit: 1 }` 防的是"同一时刻两个实例同时跑"（竞态），不是
 *    "重复处理"**——如果 Inngest 平台故障导致同一天被调度了两次（间隔几分钟到几
 *    小时），这个并发闸挡不住先后两次都真的执行。真正防重复靠的是业务层三道闸：
 *    `ai_review_attempts` 上限 + `ai_last_reviewed_at` 6 小时冷却窗口（`ai-auto-
 *    review-run.ts` 的 `UNCERTAIN_RETRY_COOLDOWN_MS`）+ 批准/拒绝的 CAS 幂等——
 *    这三层对"一天一次"的调度频率完全够用，但如果以后把调度频率改得比 6 小时还密，
 *    要重新算这笔账，不能想当然沿用今天的结论。
 *
 * 🔴 **`onFailure`**：重试耗尽仍失败（包括步骤被网关强杀没回应的那种）→ 把这个任务
 *    停在 `running` 的运行记录写成 `failed`，不能再留一行永远"在跑"的假记录。
 *
 * 🔴 **`ai_auto_review_enabled` 开关 + 异常刹车原样生效**——这个函数不判断"要不要跑
 *    AI 审核"，`runAiAutoReviewForClient()` 内部自己会先查开关、查熔断，关着的客户
 *    这里调了也是直接跳过。分块调用时只在首块查熔断预检（理由见那边 `RunOptions`）。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, failOpenCronRuns, startCronRunId } from '@/lib/cron/run-logger'
import {
  runNalMessengerLeadSyncChunk,
  mergeNalMessengerSummaries,
  type NalMessengerSyncCursor,
  type NalMessengerSyncChunkResult,
  type NalMessengerSyncSummary,
} from '@/lib/conversions/nal-messenger-lead-sync-run'
import {
  runCtsCrmSyncChunk,
  mergeCtsCrmSummaries,
  type CtsCrmSyncCursor,
  type CtsCrmSyncChunkResult,
  type CtsCrmSyncSummary,
} from '@/lib/conversions/cts-crm-sheet-sync-run'
import { runAiAutoReviewForClient, MAX_BATCH_SIZE, type RunOptions, type RunSummary } from '@/lib/conversions/ai-auto-review-run'
import { runFailedWritebackResend } from '@/lib/conversions/writeback-resend-run'
import { metaCapiWriter } from '@/lib/meta/capi/writer'
import { runPaymentEmailDetectionForEnabledClients } from '@/lib/conversions/payment-email-detect-wire'
import { isSheetDealSyncEnabled } from '@/lib/conversions/sheet-deal-sync'

export const CONVERSION_DAILY_PIPELINE_JOB = 'conversion-daily-pipeline'
export const CONVERSION_DAILY_PIPELINE_TZ = 'Pacific/Auckland'
/** 早上 6 点——给 PM/FDE 早上上班时今日待办里就能看到前一晚的结果。 */
export const CONVERSION_DAILY_PIPELINE_CRON = '0 6 * * *'
export const CONVERSION_DAILY_PIPELINE_RETRIES = 2

const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'
const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

/**
 * 块大小——按「单步 ≤ 60 秒」定（PITFALLS F8 网关 ~125 秒硬上限）。
 * CTS 实测 0.4–2.4 秒/行（历史行现在先查幂等键跳过，实际远低于此）；
 * AI 审核每条 = 1 次 Sonnet 判断 + 1 次发送，5 条典型 25–40 秒。
 */
export const CTS_SYNC_CHUNK_ROWS = 20
export const NAL_SYNC_CHUNK_CONVERSATIONS = 25
export const AI_REVIEW_CHUNK_SIZE = 5
/** 同步块数硬顶——防表格无限长导致无限循环。到顶算失败（那样表尾的行会永远同步不到）。 */
export const MAX_SYNC_CHUNKS = 100
/**
 * 瞬时错误（限流 / 断网 / 上游 5xx）的重试：`step.sleep` 等这么久再把同一块当新 step 重跑，
 * 每块最多重试这么多次。65 秒是冲着 Google Sheets「每用户每分钟 60 次读」的配额来的
 * （魏征实施后复审 MAJOR：CTS 30 块 × 2 次读，历史行秒过之后很可能 1 分钟内撞上 429，
 * 撞上的恰是表尾最新的客户，且每天同一位置复现）。
 */
export const TRANSIENT_BACKOFF_MS = 65_000
export const TRANSIENT_MAX_RETRIES = 2

/**
 * 哪些错误算「等一会儿再来就好」：Sheets/Graph 一类 HTTP 客户端抛的 429 与 5xx、
 * SDK 错误对象上的 `status` 429/5xx（Anthropic/OpenAI SDK 都这么放）、Node fetch 断网。
 * 认错误对象的形状不认文案；认不出来的一律当业务错误（不重试，宁可停也不盲跑）。
 */
export function isTransientError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const err = e as { name?: string; message?: string; status?: unknown; httpStatus?: unknown; cause?: unknown }
  const status = typeof err.httpStatus === 'number' ? err.httpStatus : typeof err.status === 'number' ? err.status : null
  if (status === 429 || (status != null && status >= 500 && status < 600)) return true
  if (err.name === 'TypeError' && /fetch failed/i.test(err.message ?? '')) return true
  return false
}

type StepResult<T> = { ok: true; summary: T } | { ok: false; error: string; transient?: boolean }
type ChunkedResult<T> = StepResult<T> & { chunks: number; durationMs: number[]; transientRetries?: number }

async function guarded<T>(label: string, fn: () => Promise<T>): Promise<StepResult<T>> {
  try {
    return { ok: true, summary: await fn() }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[${CONVERSION_DAILY_PIPELINE_JOB}] ${label} 失败：${error}`)
    return { ok: false, error, transient: isTransientError(e) }
  }
}

/** 一块的执行结果：业务返回值 + 耗时，耗时用来验证块大小定得对不对。 */
type Timed<T> = StepResult<T> & { durationMs: number }

async function timed<T>(label: string, fn: () => Promise<T>): Promise<Timed<T>> {
  const t0 = Date.now()
  const r = await guarded(label, fn)
  return { ...r, durationMs: Date.now() - t0 }
}

/** 装配层只认识这个最小接口，测试用假 step 即可（跟 daily-plan-post-story-resolve 同一做法）。 */
export type PipelineStep = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>
  /** 暂停工作流、交还控制权、到点由 Inngest 唤起（不是进程内等待）。 */
  sleep(id: string, ms: number): Promise<void>
}

/**
 * 跑一块；瞬时错误就 `step.sleep` 后用新 step id 再跑，最多 TRANSIENT_MAX_RETRIES 次。
 * 每次尝试都是独立 step（`<id>` / `<id>-retry-1` …），重放时按记忆化结果原样推进。
 */
async function runChunkWithBackoff<T>(
  step: PipelineStep,
  id: string,
  fn: () => Promise<T>,
): Promise<Timed<T> & { transientRetries: number }> {
  let attempt = 0
  for (;;) {
    const stepId = attempt === 0 ? id : `${id}-retry-${attempt}`
    const r = await step.run(stepId, () => timed(stepId, fn))
    if (r.ok || !r.transient || attempt >= TRANSIENT_MAX_RETRIES) return { ...r, transientRetries: attempt }
    attempt++
    await step.sleep(`${id}-backoff-${attempt}`, TRANSIENT_BACKOFF_MS)
  }
}

export type ReviewChunkOptions = RunOptions & { nowIso: string }

export type ConversionPipelineDeps = {
  syncNalChunk: (cursor: NalMessengerSyncCursor) => Promise<NalMessengerSyncChunkResult>
  syncCtsChunk: (cursor: CtsCrmSyncCursor) => Promise<CtsCrmSyncChunkResult>
  reviewClient: (clientId: string, opts: ReviewChunkOptions) => Promise<RunSummary>
  resendFailed: (clientId: string, opts: { nowIso: string }) => Promise<unknown>
  /**
   * 邮箱付款确认 → 成交（2026-10-04）：对开了 `leads_config.payment_email_detect.enabled` 的客户各跑一遍。
   * 可选：没传就不跑这一段（旧测试与本地试跑不受影响）。放在同步之后、AI 审核之前。
   */
  detectPayments?: (opts: { nowIso: string }) => Promise<unknown>
  /**
   * Sheet deal import. Omitted or false skips the chunks. Production passes
   * the env flag, which is off unless explicitly turned on.
   */
  sheetSyncEnabled?: boolean
  /** 运行记录读写——默认真的 run-logger；本地 Inngest dev server 试跑时注入假的。 */
  runLog?: {
    start: (jobName: string) => Promise<string>
    finish: (runId: string, startedAt: number, opts: Parameters<ReturnType<typeof cronRunHandle>['finish']>[0]) => Promise<void>
  }
}

const defaultRunLog: NonNullable<ConversionPipelineDeps['runLog']> = {
  // 字面量传 job 名：registry.test 全仓扫 startCronRunId 的调用处对账，变量传不进去。
  start: () => startCronRunId(CONVERSION_DAILY_PIPELINE_JOB),
  finish: (runId, startedAt, opts) => cronRunHandle(CONVERSION_DAILY_PIPELINE_JOB, runId, startedAt).finish(opts),
}

/** 逐块推进一条同步线；任一块失败就停（拿不到下一个游标），到块数硬顶也算失败。 */
async function runSyncChunks<Cursor extends { offset: number; insertedSoFar: number }, Summary>(
  step: PipelineStep,
  label: string,
  first: Cursor,
  runChunk: (cursor: Cursor) => Promise<{ summary: Summary; nextOffset: number; insertedSoFar: number; done: boolean }>,
  merge: (a: Summary, b: Summary) => Summary,
): Promise<ChunkedResult<Summary>> {
  let cursor = first
  let merged: Summary | null = null
  const durationMs: number[] = []
  let transientRetries = 0
  for (let n = 1; n <= MAX_SYNC_CHUNKS; n++) {
    const cur = cursor
    const r = await runChunkWithBackoff(step, `${label}-${n}`, () => runChunk(cur))
    durationMs.push(r.durationMs)
    transientRetries += r.transientRetries
    if (!r.ok) return { ok: false, error: r.error, transient: r.transient, chunks: n, durationMs, transientRetries }
    merged = merged ? merge(merged, r.summary.summary) : r.summary.summary
    if (r.summary.done) return { ok: true, summary: merged, chunks: n, durationMs, transientRetries }
    cursor = { ...cursor, offset: r.summary.nextOffset, insertedSoFar: r.summary.insertedSoFar }
  }
  return {
    ok: false,
    error: `${label} 跑满 ${MAX_SYNC_CHUNKS} 块仍没到表尾——表尾的行永远同步不到，块大小或硬顶要调`,
    chunks: MAX_SYNC_CHUNKS,
    durationMs,
    transientRetries,
  }
}

type ReviewAggregate =
  | { ran: false; reason: string; detail?: string }
  | { ran: true; processed: number; approved: number; approvedAmountMinor: number; rejected: number; uncertain: number; expired: number }

/**
 * 逐块推进一个客户的 AI 审核。日上限仍是 MAX_BATCH_SIZE（50）条；块与块之间把已批准的
 * 条数/金额带过去（`carried`），硬顶不因拆块清零。任一块失败立刻停。
 */
async function runReviewChunks(
  step: PipelineStep,
  label: string,
  clientId: string,
  nowIso: string,
  review: ConversionPipelineDeps['reviewClient'],
): Promise<ChunkedResult<ReviewAggregate>> {
  const maxChunks = Math.ceil(MAX_BATCH_SIZE / AI_REVIEW_CHUNK_SIZE)
  const durationMs: number[] = []
  let carried: RunOptions['carried'] | undefined
  let agg: Extract<ReviewAggregate, { ran: true }> = {
    ran: true,
    processed: 0,
    approved: 0,
    approvedAmountMinor: 0,
    rejected: 0,
    uncertain: 0,
    expired: 0,
  }
  let transientRetries = 0
  for (let n = 1; n <= maxChunks; n++) {
    const opts: ReviewChunkOptions = { maxBatchSize: AI_REVIEW_CHUNK_SIZE, nowIso, ...(carried ? { carried } : {}) }
    const r = await runChunkWithBackoff(step, `${label}-${n}`, () => review(clientId, opts))
    durationMs.push(r.durationMs)
    transientRetries += r.transientRetries
    if (!r.ok) return { ok: false, error: r.error, transient: r.transient, chunks: n, durationMs, transientRetries }
    const s = r.summary
    if (!s.ran) {
      // 首块就没跑（开关关着 / 熔断）→ 如实报原因；中途熔断 → 保留前几块的汇总，附上原因。
      if (n === 1) return { ok: true, summary: { ran: false, reason: s.reason, detail: s.detail }, chunks: n, durationMs }
      return { ok: true, summary: { ...agg, stoppedReason: s.reason, stoppedDetail: s.detail } as ReviewAggregate, chunks: n, durationMs }
    }
    agg = {
      ...agg,
      processed: agg.processed + s.processed,
      approved: agg.approved + s.approved,
      approvedAmountMinor: agg.approvedAmountMinor + s.approvedAmountMinor,
      rejected: agg.rejected + s.rejected,
      uncertain: agg.uncertain + s.uncertain,
      expired: agg.expired + s.expired,
    }
    carried = { approvedCount: agg.approved, approvedAmountMinor: agg.approvedAmountMinor }
    if (s.processed < AI_REVIEW_CHUNK_SIZE) break
  }
  return { ok: true, summary: agg, chunks: durationMs.length, durationMs, transientRetries }
}

/**
 * 依赖注入版，便于测试注入假的同步/审核/补发实现，不碰真 Supabase/AI/Meta。
 */
export function createConversionDailyPipelineFunction(deps: ConversionPipelineDeps) {
  const runLog = deps.runLog ?? defaultRunLog
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}conversion-daily-pipeline`,
      name: 'Conversions: daily sync + AI auto-review',
      concurrency: { limit: 1 },
      retries: CONVERSION_DAILY_PIPELINE_RETRIES,
      onFailure: async ({ event, error }) => {
        const message = error?.message || (event.data as { error?: { message?: string } } | undefined)?.error?.message || '未知错误'
        // 失败事件自带发生时刻（EventPayload.ts，FailureEventPayload 的类型没把它露出来）。
        const ts = (event as { ts?: number }).ts
        const startedBefore = new Date(typeof ts === 'number' ? ts : Date.now())
        await failOpenCronRuns(CONVERSION_DAILY_PIPELINE_JOB, `重试耗尽后仍失败：${message}`, { startedBefore })
      },
    },
    { cron: `TZ=${CONVERSION_DAILY_PIPELINE_TZ} ${CONVERSION_DAILY_PIPELINE_CRON}` },
    async ({ step }) =>
      runConversionDailyPipeline(
        {
          // Inngest 把记忆化结果标成 Jsonify<T>。本函数每个 step 的返回值都是纯 JSON
          // （游标是 number/string、汇总是计数和打码清单），Jsonify<T> 与 T 同形。
          run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
          sleep: async (id, ms) => {
            await step.sleep(id, ms)
          },
        },
        deps,
        runLog,
      ),
  )
}

/** 函数体单独导出：测试用假 step 直接驱动，不经过 Inngest 私有字段。 */
export async function runConversionDailyPipeline(
  step: PipelineStep,
  deps: ConversionPipelineDeps,
  runLog: NonNullable<ConversionPipelineDeps['runLog']> = defaultRunLog,
) {
  // `now` 在这里取一次、传给每一块——跨块的「7 天窗口」边界行不会在块与块之间换判。
  const started = await step.run('log-start', async () => ({
    runId: await runLog.start(CONVERSION_DAILY_PIPELINE_JOB),
    startedAt: Date.now(),
  }))
  const nowIso = new Date(started.startedAt).toISOString()

  const nalSync = await runSyncChunks<NalMessengerSyncCursor, NalMessengerSyncSummary>(
    step,
    'sync-nal',
    { offset: 0, limit: NAL_SYNC_CHUNK_CONVERSATIONS, insertedSoFar: 0, createdBeforeIso: nowIso },
    deps.syncNalChunk,
    mergeNalMessengerSummaries,
  )
  const ctsSync = deps.sheetSyncEnabled === true
    ? await runSyncChunks<CtsCrmSyncCursor, CtsCrmSyncSummary>(
        step,
        'sync-cts',
        { offset: 0, limit: CTS_SYNC_CHUNK_ROWS, insertedSoFar: 0 },
        deps.syncCtsChunk,
        mergeCtsCrmSummaries,
      )
    : await step.run('sync-cts-skipped', async () => ({ ok: true as const, reason: 'sheet_deal_sync_off' as const }))
  const detectPayments = deps.detectPayments
  const payments = detectPayments
    ? await step.run('detect-payments', () => timed('detect-payments', () => detectPayments({ nowIso })))
    : null
  const nalReview = await runReviewChunks(step, 'ai-review-nal', NAL_CLIENT_ID, nowIso, deps.reviewClient)
  const ctsReview = await runReviewChunks(step, 'ai-review-cts', CTS_CLIENT_ID, nowIso, deps.reviewClient)
  const nalResend = await step.run('resend-failed-nal', () =>
    timed('resend-failed-nal', () => deps.resendFailed(NAL_CLIENT_ID, { nowIso })),
  )
  const ctsResend = await step.run('resend-failed-cts', () =>
    timed('resend-failed-cts', () => deps.resendFailed(CTS_CLIENT_ID, { nowIso })),
  )

  const results = { nalSync, ctsSync, ...(payments ? { payments } : {}), nalReview, ctsReview, nalResend, ctsResend }
  const total = Object.keys(results).length
  const failedCount = Object.values(results).filter((r) => !r.ok).length

  await step.run('log-finish', async () => {
    await runLog.finish(started.runId, started.startedAt, {
      processed: total,
      completed: total - failedCount,
      failed: failedCount,
      summary: results,
      error: failedCount > 0 ? `${failedCount}/${total} 段失败，看 summary 具体哪段` : undefined,
    })
    return null
  })

  return results
}

/** 生产实例。 */
export const conversionDailyPipeline = createConversionDailyPipelineFunction({
  syncNalChunk: (cursor) => runNalMessengerLeadSyncChunk(cursor),
  syncCtsChunk: (cursor) => runCtsCrmSyncChunk(cursor),
  reviewClient: (clientId, { nowIso, ...opts }) =>
    runAiAutoReviewForClient(
      clientId,
      {
        supabase: supabaseAdmin,
        sendDeps: { writer: metaCapiWriter, fetcher: fetch },
        now: new Date(nowIso),
      },
      opts,
    ),
  resendFailed: (clientId, { nowIso }) =>
    runFailedWritebackResend(clientId, {
      supabase: supabaseAdmin,
      sendDeps: { writer: metaCapiWriter, fetcher: fetch },
      now: new Date(nowIso),
    }),
  detectPayments: ({ nowIso }) => runPaymentEmailDetectionForEnabledClients({ nowIso }),
  sheetSyncEnabled: isSheetDealSyncEnabled(),
})
