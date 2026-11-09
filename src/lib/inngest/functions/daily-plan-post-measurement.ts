/**
 * Facebook 帖子 Act → Check 闭环（云端 Inngest 消费者）。
 *
 * Daily Plan 已能发帖并发出 `daily_plan.post.published`，但没人回收表现。本模块补上。
 *
 *   fan-out   收发布事件 → 校验 → 隔离检查 → 记发布动作 → 每个测量窗口各发一条内部
 *             事件（稳定 id `<idempotency_key>:measurement:<hours>`）
 *   measure   每条内部事件一个独立 run → 睡到该窗口 → 从库读 action 核对身份 →
 *             独立 step 读 Graph → RPC 事务性提交回执 + 全部指标
 *
 * 🔴 **必须拆开**：若一个 run 顺序睡 4h 再睡 72h，T+4 失败会连累 T+72 永远跑不到，
 *    T+72 重试又会重放已成功的 T+4。拆开后：T+4 失败不挡 T+72、T+72 失败不删
 *    T+4、一条帖子不影响别的帖子、重放靠事件 id + 数据库唯一约束双层挡住。
 *
 * measure 只允许 T+4/T+72，并将事件时间重新绑定到已登记发布 action。
 * Measurement is non-billable: no customer credit, quota or paid task execution.
 * 本期不做 Tune：动作行 `expected_metric` 为 NULL，通用归因不加载它。
 *
 * ## Codex #1399 复审修正
 *
 * - P1：Supabase 查询失败不能塌成 `client_page_unknown`。DB 错误抛出让 Inngest 重试。
 * - P2：`recordPublishAction` 幂等冲突必须核对全身份，不同则 fail-closed。
 * - P3：Graph 读拆成独立 step；回执与所有指标走 RPC 事务性一次提交；
 *   ok/partial 不能被 unmeasurable 覆盖；同 hash 幂等，不同 hash 拒绝。
 * - P4：数据库组合外键锁 receipts.client_id ↔ action.client_id；消费者
 *   访问 Meta 前必须从 DB 读 action 核对 client/post/page/idempotency。
 */

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import {
  DAILY_PLAN_POST_PUBLISHED_EVENT,
  DailyPlanPostPublishedEventSchema,
  measurementEventId,
  type DailyPlanPostPublishedEvent,
} from '@/lib/campaign/daily-plan-publish'
import { getStoredPageToken } from '@/lib/meta/token-manager'
import { fetchPostEngagement, type EngagementRead, type FieldRead, type GraphFailure } from '@/lib/meta/post-engagement'
import {
  recordPublishAction,
  recordSnapshot,
  verifyActionIdentity,
  PublishActionIdentityMismatchError,
  type ReceiptStatus,
} from '@/lib/social/post-measurement-store'

/** 云端专属内部事件 —— 本机 worker 不监听（见 client.ts WORKER_OWNED_EVENTS）。 */
export const DAILY_PLAN_POST_MEASURE_EVENT = 'daily_plan.post.measure_due'

export const MeasureDueSchema = z.object({
  client_id: z.string().min(1),
  action_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  post_id: z.string().min(1),
  page_id: z.string().min(1),
  window_hours: z.number().int().refine((hours): boolean => hours === 4 || hours === 72, 'unsupported measurement window'),
  target_at: z.string().datetime(),
  // Existing durable events omit this field; omission retains the same non-billable contract.
  billing_mode: z.literal('non_billable').optional(),
})
export type MeasureDueData = z.infer<typeof MeasureDueSchema>

// ─── fan-out ─────────────────────────────────────────────────────────────────

export type IsolationResult =
  | { ok: true }
  | { ok: false; reason: 'page_mismatch' | 'post_not_on_page' | 'client_page_unknown' }

/**
 * 客户 / 主页 / 帖子必须自洽，否则一步都不往下走 —— 不读 Graph、不记动作。
 * 拿别的客户的帖子写进这个客户的账，比什么都不做危险得多。
 */
export function checkIsolation(
  registeredPageId: string | null,
  event: Pick<DailyPlanPostPublishedEvent, 'page_id' | 'post_id'>,
): IsolationResult {
  if (!registeredPageId) return { ok: false, reason: 'client_page_unknown' }
  if (registeredPageId !== event.page_id) return { ok: false, reason: 'page_mismatch' }
  if (!event.post_id.startsWith(`${event.page_id}_`)) return { ok: false, reason: 'post_not_on_page' }
  return { ok: true }
}

/**
 * P1：读客户档案里登记的 Facebook 主页 ID。
 *
 * DB 错误（网络、权限、超时）**必须抛出**让 Inngest 重试 —— 静默返回 null 会被
 * `checkIsolation` 塌成 `client_page_unknown` 永久结案，帖子既没 action、也没测量。
 * 只有查询成功且字段真的为空/客户不存在，才返回 null。
 */
export async function readRegisteredPageId(
  supabase: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()

  if (error) {
    // 抛出让 Inngest 重试；不塌成「主页未登记」这种永久结论。
    throw new Error(`readRegisteredPageId: db error — ${error.message}`)
  }
  if (!data) return null
  return (data as { facebook_page_id?: string | null }).facebook_page_id ?? null
}

export function createFanOutFunction(deps: { supabase: SupabaseClient }) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}daily-plan-post-fanout`,
      name: 'Daily Plan Post: fan out measurement windows',
      concurrency: { limit: 4, key: 'event.data.page_id' },
    },
    { event: DAILY_PLAN_POST_PUBLISHED_EVENT },
    async ({ event, step }) => {
      // fail-closed：形状不对整条拒，不猜、不补默认值。
      const parsed = DailyPlanPostPublishedEventSchema.safeParse(event.data)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid_payload', issues: parsed.error.issues.slice(0, 5) }
      }
      const d = parsed.data

      const isolation = await step.run('isolation-check', async () => {
        const registered = await readRegisteredPageId(deps.supabase, d.client_id)
        return checkIsolation(registered, d)
      })
      if (!isolation.ok) return { ok: false, reason: isolation.reason }

      // 帖子已经在 Facebook 上了 —— 先记下这个既成事实，不看令牌。
      // P2：recordPublishAction 内部核对身份；不同则抛 PublishActionIdentityMismatchError，
      // 由 Inngest 重试上限兜底记 failure。
      const actionId = await step.run('record-publish-action', () =>
        recordPublishAction(deps.supabase, {
          clientId: d.client_id,
          idempotencyKey: d.idempotency_key,
          postId: d.post_id,
          pageId: d.page_id,
          permalink: d.permalink,
          campaignId: d.campaign_id,
          planId: d.plan_id,
          publishedAt: d.published_at,
          scheduledPublishTime: d.scheduled_publish_time,
          measureAt: d.measure_at,
        }),
      )

      // 每个窗口一条独立事件 —— 稳定 id 让重放不产生第二个 run。
      const eventIds = await step.run('fan-out-windows', async () => {
        const ids: string[] = []
        for (const w of d.measure_at) {
          const sent = await sendInngestEvent<Record<string, unknown>>({
            id: measurementEventId(d.idempotency_key, w.hours),
            name: DAILY_PLAN_POST_MEASURE_EVENT,
            data: {
              client_id: d.client_id,
              action_id: actionId,
              idempotency_key: d.idempotency_key,
              post_id: d.post_id,
              page_id: d.page_id,
              window_hours: w.hours,
              target_at: w.at,
            } satisfies MeasureDueData,
          })
          ids.push(...sent.event_ids)
        }
        return ids
      })

      return { ok: true, action_id: actionId, windows: d.measure_at.length, event_ids: eventIds }
    },
  )
}

// ─── measurement ─────────────────────────────────────────────────────────────

/** 一次读取 → 回执长什么样。纯函数，直测。 */
export function summariseRead(read: EngagementRead): {
  status: Extract<ReceiptStatus, 'ok' | 'partial'>
  values: Record<string, number>
  missing: Record<string, string>
} {
  const values: Record<string, number> = {}
  const missing: Record<string, string> = {}
  const fields: [string, FieldRead][] = [
    ['likes', read.reactions],
    ['comments', read.comments],
    ['shares', read.shares],
  ]
  for (const [name, r] of fields) {
    if (r.kind === 'value') values[name] = r.value
    else missing[name] = r.kind === 'omitted_unverified' ? 'omitted_unverified' : 'field_absent'
  }
  return { status: Object.keys(missing).length === 0 ? 'ok' : 'partial', values, missing }
}

/** Graph 读一次 → 结构化结果。抽出来给独立 step 用，也便于直测。 */
export type GraphReadResult =
  | { kind: 'read'; read: EngagementRead }
  | { kind: 'no_token' }
  | { kind: 'permanent'; failure: GraphFailure }
  | { kind: 'transient'; failure: GraphFailure }

export async function readGraphOnce(
  clientId: string,
  pageId: string,
  postId: string,
  fetcher: typeof fetch,
): Promise<GraphReadResult> {
  const token = await getStoredPageToken(clientId, pageId)
  if (!token) return { kind: 'no_token' }
  const result = await fetchPostEngagement(postId, token, fetcher)
  if (result.ok) return { kind: 'read', read: result.read }
  return result.failure.kind === 'transient'
    ? { kind: 'transient', failure: result.failure }
    : { kind: 'permanent', failure: result.failure }
}

export function createMeasureFunction(deps: {
  supabase: SupabaseClient
  fetcher?: typeof fetch
  now?: () => Date
}) {
  const now = deps.now ?? (() => new Date())

  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}daily-plan-post-measure`,
      name: 'Daily Plan Post: measure one window',
      concurrency: { limit: 4, key: 'event.data.page_id' },
      retries: 3,
      // 重试耗尽也要留痕 —— 但 P3：不能把已成功的回执降级成 unmeasurable。
      // RPC 内部铁律 1 保证 ok/partial 不会被 unmeasurable 覆盖，所以这里放心记账。
      onFailure: async ({ event: failureEvent }) => {
        const original = (failureEvent.data as { event?: { data?: unknown } })?.event?.data
        const parsed = MeasureDueSchema.safeParse(original)
        if (!parsed.success) return
        const d = parsed.data
        const identity = await verifyActionIdentity(deps.supabase, d.action_id, {
          clientId: d.client_id, idempotencyKey: d.idempotency_key,
          postId: d.post_id, pageId: d.page_id, windowHours: d.window_hours, targetAt: d.target_at,
        })
        if (!identity.ok) return
        await recordSnapshot(deps.supabase, {
          clientId: d.client_id,
          actionId: d.action_id,
          idempotencyKey: d.idempotency_key,
          postId: d.post_id,
          pageId: d.page_id,
          windowHours: d.window_hours,
          targetAt: d.target_at,
          measuredAt: null,
          status: 'unmeasurable',
          values: {},
          missing: {},
          reason: 'retries_exhausted',
        })
      },
    },
    { event: DAILY_PLAN_POST_MEASURE_EVENT },
    async ({ event, step }) => {
      const parsed = MeasureDueSchema.safeParse(event.data)
      if (!parsed.success) return { ok: false, reason: 'invalid_payload' }
      const d = parsed.data

      // 到点再干活。已过的时刻立即返回 —— 迟测仍测，回执上看得出迟了。
      // 🔴 P4：访问 Meta 前必须从 DB 读 action 核对身份。事件里带的 client/post/page
      // 全部只是"声称"，DB 里那条 action 才是权威。任何不一致 → 拒，不读、不写。
      const identity = await step.run('verify-measurement-contract-v1', () =>
        verifyActionIdentity(deps.supabase, d.action_id, {
          clientId: d.client_id,
          idempotencyKey: d.idempotency_key,
          postId: d.post_id,
          pageId: d.page_id,
          windowHours: d.window_hours,
          targetAt: d.target_at,
        }),
      )
      if (!identity.ok) return { ok: false, reason: identity.reason }
      await step.sleepUntil(`wait-${d.window_hours}h`, new Date(d.target_at))

      // 🔴 P3：把 Graph 读取做成独立的持久 step —— 成功后被 Inngest 记忆化，
      // 后续同一 run 的重试都复用同一份数字，不再重新问 Graph、不再产生 hash 漂移。
      const read = await step.run(`read-graph-${d.window_hours}h`, () =>
        readGraphOnce(d.client_id, d.page_id, d.post_id, deps.fetcher ?? fetch),
      )

      // 到执行时才重新取令牌 —— 发布时能用不代表 72 小时后还能用。
      if (read.kind === 'no_token') {
        await step.run('write-unmeasurable-no-token', () =>
          recordSnapshot(deps.supabase, {
            clientId: d.client_id,
            actionId: d.action_id,
            idempotencyKey: d.idempotency_key,
            postId: d.post_id,
            pageId: d.page_id,
            windowHours: d.window_hours,
            targetAt: d.target_at,
            measuredAt: null,
            status: 'unmeasurable',
            values: {},
            missing: {},
            reason: 'token_unavailable',
          }),
        )
        return { ok: false, reason: 'token_unavailable' }
      }

      if (read.kind === 'transient') {
        // 抛出去让 Inngest 有界重试；耗尽后 onFailure 写 retries_exhausted 回执。
        throw new Error(`transient:${read.failure.reason}`)
      }

      if (read.kind === 'permanent') {
        await step.run(`write-unmeasurable-${read.failure.reason}`, () =>
          recordSnapshot(deps.supabase, {
            clientId: d.client_id,
            actionId: d.action_id,
            idempotencyKey: d.idempotency_key,
            postId: d.post_id,
            pageId: d.page_id,
            windowHours: d.window_hours,
            targetAt: d.target_at,
            measuredAt: null,
            status: 'unmeasurable',
            values: {},
            missing: {},
            reason: read.failure.reason,
            graphCode: read.failure.code,
            graphSubcode: read.failure.subcode,
          }),
        )
        return { ok: false, reason: read.failure.reason }
      }

      const measuredAt = now().toISOString()
      const summary = summariseRead(read.read)

      // 🔴 P3：回执 + 全部指标一次事务提交（RPC 内部保证原子性）。
      const outcome = await step.run(`write-snapshot-${d.window_hours}h`, () =>
        recordSnapshot(deps.supabase, {
          clientId: d.client_id,
          actionId: d.action_id,
          idempotencyKey: d.idempotency_key,
          postId: d.post_id,
          pageId: d.page_id,
          windowHours: d.window_hours,
          targetAt: d.target_at,
          measuredAt,
          status: summary.status,
          values: summary.values,
          missing: summary.missing,
        }),
      )

      return {
        ok: true,
        outcome,
        status: summary.status,
        values: summary.values,
        missing: summary.missing,
      }
    },
  )
}

export const dailyPlanPostFanOut = createFanOutFunction({ supabase: supabaseAdmin })
export const dailyPlanPostMeasure = createMeasureFunction({ supabase: supabaseAdmin })

// P2 类型导出，测试用。
export { PublishActionIdentityMismatchError } from '@/lib/social/post-measurement-store'
