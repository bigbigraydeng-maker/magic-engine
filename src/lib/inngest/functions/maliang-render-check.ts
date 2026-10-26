/**
 * 马良 · 出片自检工作流（agent 自治计划 B2）。
 *
 * 成片落库后发 `me/maliang.render.ready`。两条路共用同一次自检：
 * - Creatomate（factory-creatomate-render.ts）：带 job_id + post_id。裁决写回
 *   `content_posts.generation_context_snapshot.maliang_check`（只动这一个子 key）。
 *   不过关把渲染工单标 `needs_rework`（不进审片队列；返工还是放弃由今日待办问）。
 * - 模板出片（工单 complete）：带 work_order_id。裁决写回工单 output 里的同一个
 *   `maliang_check` 对象（工单没有内容帖）。不过关把仍在 in_review 的工单标
 *   `review_rejected`。自检抛错或超时则保持 in_review，并标未机器审。
 * 回执写 cron_run_logs（job_name 恒为 'maliang-render-check'，非周期任务）。
 *
 * 🔴 retries 0：花模型钱，失败进回执不重跑——重跑等于重复付款。
 *
 * 🔴 读不到 = unverifiable，不给「过关」默认值。只出裁决，不发布。
 *
 * 结构照抄 knowledge-mining.ts：事件触发、依赖注入版 create...Function(deps)
 * 便于测试、payload 校验 fail-closed；回执模式照抄 factory-creatomate-render.ts
 * （startCronRunId / cronRunHandle(...).finish 都在 step 里，job_name 是静态字面量）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GetStepTools } from 'inngest'
import { z } from 'zod'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { cronRunHandle, startCronRunId } from '@/lib/cron/run-logger'
import { projectFactoryConfig } from '@/lib/factory/client-config'
import { runNineGridCheck, mergeMaliangIntoSnapshot, allowedVideoHosts, type MaliangCheck, type NineGridInput } from '@/lib/maliang/render-check'
import { dispositionOf, REMOTION_REVIEW_TIMEOUT_MS, runCheckWithTimeout } from '@/lib/maliang/review-disposition'
import { readWorkOrderContext, writeWorkOrderVerdict, type WorkOrderReady } from '@/lib/maliang/work-order-review'

export const MALIANG_RENDER_READY_EVENT = 'me/maliang.render.ready' as const
export const MALIANG_JOB = 'maliang-render-check'
export const NEEDS_REWORK_STATUS = 'needs_rework'

const uuidLike = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

const postReadySchema = z.object({
  client_id: uuidLike,
  job_id: uuidLike,
  post_id: uuidLike,
  output_url: z.string().url(),
})

const workOrderReadySchema = z.object({
  client_id: uuidLike,
  work_order_id: uuidLike,
  output_url: z.string().url(),
})

export const MaliangRenderReadySchema = z.union([postReadySchema, workOrderReadySchema])

export type MaliangRenderReadyData = z.infer<typeof MaliangRenderReadySchema>
export type PostReadyData = z.infer<typeof postReadySchema>

function isWorkOrderReady(data: MaliangRenderReadyData): data is WorkOrderReady {
  return 'work_order_id' in data
}

export interface MaliangDeps {
  supabase: SupabaseClient
  check: typeof runNineGridCheck
  apiKey: () => string | undefined
  /** Template-render reviews only. A hung model must not leave the order unmarked. */
  reviewTimeoutMs?: number
}

export interface MaliangContext {
  title: string
  brandName: string
  expectedCaptions: string[]
  visualNotes: string[]
  logoExpected: boolean
  snapshot: unknown
}

export interface MaliangReceipt {
  request_id: string
  client_id: string
  source_record_id: string
  status: MaliangCheck['status'] | 'invalid_payload' | 'context_unreadable'
  reasons: string[]
  no_publish: true
}

/** 模板里有没有 logo/水印层：看 creatomate.static_overrides 的 key。读不到 = 没有。 */
export function logoExpectedFrom(factoryConfig: unknown): boolean {
  const overrides = projectFactoryConfig(factoryConfig).render?.creatomate?.staticOverrides ?? {}
  return Object.keys(overrides).some((k) => /logo|watermark|brand/i.test(k))
}

/** 镜头数组 → 自检输入的字幕/素材说明。非数组 = 空。 */
export function scenesToInput(scenes: unknown): { captions: string[]; notes: string[] } {
  if (!Array.isArray(scenes)) return { captions: [], notes: [] }
  const captions: string[] = []
  const notes: string[] = []
  scenes.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return
    const s = raw as Record<string, unknown>
    if (typeof s.captionText === 'string' && s.captionText.length > 0) captions.push(s.captionText)
    const source = s.visualSource === 'ai_generated' ? 'AI-generated' : 'a real client photo'
    notes.push(`scene ${i + 1} is ${source}`)
  })
  return { captions, notes }
}

/** 读三张表拼出自检上下文。任何一处读不到 = 不判，说清是哪一处。 */
export async function readContext(
  supabase: SupabaseClient,
  data: PostReadyData,
): Promise<{ ok: true; ctx: MaliangContext } | { ok: false; reason: string }> {
  const job = await supabase
    .from('content_factory_render_jobs')
    .select('scenes')
    .eq('id', data.job_id)
    .maybeSingle()
  if (job.error) return { ok: false, reason: `render_job_read_failed: ${job.error.message}` }
  if (!job.data) return { ok: false, reason: 'render_job_not_found' }

  const post = await supabase
    .from('content_posts')
    .select('title, generation_context_snapshot')
    .eq('id', data.post_id)
    .maybeSingle()
  if (post.error) return { ok: false, reason: `post_read_failed: ${post.error.message}` }
  if (!post.data) return { ok: false, reason: 'post_not_found' }

  const client = await supabase
    .from('clients')
    .select('name, factory_config')
    .eq('id', data.client_id)
    .maybeSingle()
  if (client.error) return { ok: false, reason: `client_read_failed: ${client.error.message}` }
  if (!client.data) return { ok: false, reason: 'client_not_found' }

  const jobRow = job.data as Record<string, unknown>
  const postRow = post.data as Record<string, unknown>
  const clientRow = client.data as Record<string, unknown>
  const { captions, notes } = scenesToInput(jobRow.scenes)

  return {
    ok: true,
    ctx: {
      title: typeof postRow.title === 'string' ? postRow.title : '',
      brandName: typeof clientRow.name === 'string' ? clientRow.name : '',
      expectedCaptions: captions,
      visualNotes: notes,
      logoExpected: logoExpectedFrom(clientRow.factory_config),
      snapshot: postRow.generation_context_snapshot,
    },
  }
}

/** 写回裁决：只动 snapshot 的 maliang_check 子 key；不过关再标工单返工。 */
export async function writeVerdict(
  supabase: SupabaseClient,
  data: PostReadyData,
  snapshot: unknown,
  check: MaliangCheck,
): Promise<void> {
  const merged = mergeMaliangIntoSnapshot(snapshot, check)
  const postUpdate = await supabase
    .from('content_posts')
    .update({ generation_context_snapshot: merged })
    .eq('id', data.post_id)
  if (postUpdate.error) throw new Error(`写回 snapshot 失败：${postUpdate.error.message}`)

  if (!dispositionOf(check.status).holdFromQueue) return

  const jobUpdate = await supabase
    .from('content_factory_render_jobs')
    .update({
      status: NEEDS_REWORK_STATUS,
      error: `马良自检不过关：${check.reasons.join('；')}`.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.job_id)
  if (jobUpdate.error) throw new Error(`标返工失败：${jobUpdate.error.message}`)
}

type StepRunner = GetStepTools<typeof inngest>

interface OpenReceipt {
  finish: (patch: {
    completed?: number
    failed?: number
    error?: string
    summary: Record<string, unknown>
  }) => Promise<unknown>
}

function unreadReceipt(requestId: string, clientId: string, sourceId: string, reason: string): MaliangReceipt {
  return {
    request_id: requestId,
    client_id: clientId,
    source_record_id: sourceId,
    status: 'context_unreadable',
    reasons: [reason],
    no_publish: true,
  }
}

async function finishChecked(
  step: StepRunner,
  run: OpenReceipt,
  check: MaliangCheck,
  summary: Record<string, unknown>,
): Promise<void> {
  await step.run('finish-receipt', async () => {
    await run.finish({
      completed: check.status === 'unverifiable' ? 0 : 1,
      failed: check.status === 'unverifiable' ? 1 : 0,
      summary,
      error: check.status === 'unverifiable' ? check.reasons.join('；') : undefined,
    })
    return null
  })
}

function verdictReceipt(
  requestId: string,
  clientId: string,
  sourceId: string,
  check: MaliangCheck,
): MaliangReceipt {
  return {
    request_id: requestId,
    client_id: clientId,
    source_record_id: sourceId,
    status: check.status,
    reasons: check.reasons,
    no_publish: true,
  }
}

async function finishUnread(
  step: StepRunner,
  run: OpenReceipt,
  requestId: string,
  clientId: string,
  sourceId: string,
  reason: string,
): Promise<void> {
  await step.run('finish-receipt-context', async () => {
    await run.finish({
      failed: 1,
      error: reason,
      summary: { request_id: requestId, client_id: clientId, source_record_id: sourceId, no_publish: true },
    })
    return null
  })
}

async function runPostReview(
  deps: MaliangDeps,
  data: PostReadyData,
  step: StepRunner,
  requestId: string,
): Promise<MaliangReceipt> {
  const started = await step.run('start-receipt', async () => ({
    runId: await startCronRunId(MALIANG_JOB),
    startedAt: Date.now(),
  }))
  const run = cronRunHandle(MALIANG_JOB, started.runId, started.startedAt)
  const read = await step.run('read-context', () => readContext(deps.supabase, data))
  if (!read.ok) {
    await finishUnread(step, run, requestId, data.client_id, data.job_id, read.reason)
    return unreadReceipt(requestId, data.client_id, data.job_id, read.reason)
  }
  const ctx = read.ctx
  const input: NineGridInput = {
    title: ctx.title,
    brandName: ctx.brandName,
    expectedCaptions: ctx.expectedCaptions,
    visualNotes: ctx.visualNotes,
    logoExpected: ctx.logoExpected,
  }
  const check = await step.run('run-check', () =>
    deps.check({ videoUrl: data.output_url, input, apiKey: deps.apiKey(), allowedHosts: allowedVideoHosts() }),
  )
  await step.run('write-verdict', () => writeVerdict(deps.supabase, data, ctx.snapshot, check))
  await finishChecked(step, run, check, {
    request_id: requestId,
    client_id: data.client_id,
    source_record_id: data.job_id,
    post_id: data.post_id,
    status: check.status,
    reasons: check.reasons,
    no_publish: true,
  })
  return verdictReceipt(requestId, data.client_id, data.job_id, check)
}

async function runWorkOrderReview(
  deps: MaliangDeps,
  data: WorkOrderReady,
  step: StepRunner,
  requestId: string,
): Promise<MaliangReceipt> {
  const started = await step.run('start-receipt', async () => ({
    runId: await startCronRunId(MALIANG_JOB),
    startedAt: Date.now(),
  }))
  const run = cronRunHandle(MALIANG_JOB, started.runId, started.startedAt)
  const read = await step.run('read-work-order', () => readWorkOrderContext(deps.supabase, data))
  if (!read.ok) {
    await finishUnread(step, run, requestId, data.client_id, data.work_order_id, read.reason)
    return unreadReceipt(requestId, data.client_id, data.work_order_id, read.reason)
  }
  const ctx = read.ctx
  const check = await step.run('run-check', () =>
    runCheckWithTimeout(
      () => deps.check({
        videoUrl: data.output_url,
        input: ctx.input,
        apiKey: deps.apiKey(),
        allowedHosts: allowedVideoHosts(),
      }),
      deps.reviewTimeoutMs ?? REMOTION_REVIEW_TIMEOUT_MS,
      data.output_url,
    ),
  )
  await step.run('write-verdict', () =>
    writeWorkOrderVerdict(deps.supabase, data.work_order_id, ctx.output, ctx.status, check),
  )
  await finishChecked(step, run, check, {
    request_id: requestId,
    client_id: data.client_id,
    source_record_id: data.work_order_id,
    status: check.status,
    reasons: check.reasons,
    machine_reviewed: dispositionOf(check.status).machineReviewed,
    no_publish: true,
  })
  return verdictReceipt(requestId, data.client_id, data.work_order_id, check)
}

/** 依赖注入版：便于集成测试注入假 supabase / 假 check。 */
export function createMaliangRenderCheckFunction(deps: MaliangDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}maliang-render-check`,
      name: 'Maliang render check: nine-frame self-check of a finished video (verdict only, never publishes)',
      // 同一客户串行：防止重复投递把同一客户的成片并发自检两份。
      concurrency: { limit: 1, key: 'event.data.client_id' },
      // 不重试：花模型钱，失败进回执不重跑。
      retries: 0,
    },
    { event: MALIANG_RENDER_READY_EVENT },
    async ({ event, step }): Promise<MaliangReceipt> => {
      const parsed = MaliangRenderReadySchema.safeParse(event.data)
      if (!parsed.success) {
        return {
          request_id: event.id ?? '',
          client_id: '',
          source_record_id: '',
          status: 'invalid_payload',
          reasons: [parsed.error.issues.map((i) => i.message).join('；')],
          no_publish: true,
        }
      }
      const requestId = event.id ?? ''
      if (isWorkOrderReady(parsed.data)) return runWorkOrderReview(deps, parsed.data, step, requestId)
      return runPostReview(deps, parsed.data, step, requestId)
    },
  )
}

/** 生产实例。 */
export const maliangRenderCheck = createMaliangRenderCheckFunction({
  supabase: supabaseAdmin,
  check: runNineGridCheck,
  apiKey: () => process.env.GEMINI_API_KEY,
})
