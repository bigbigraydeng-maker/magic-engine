/**
 * Factory Reel → IMPACT Check 接线器（#1399 measurement 的第二个上游）。
 *
 * 消费 `me/factory.reel.published`（PR #1424 emit 端），把它翻译成 #1399
 * 已经在跑的 daily-plan Post measurement 语义：登记一条 `social.publish_post`
 * 动作行 + fan-out T+4 / T+72 到 `daily_plan.post.measure_due`。
 * measurement consumer / RPC / 回执表 / 权限 一个都不改。
 *
 * 为什么不复用 `recordPublishAction`：它的签名要求 `campaign_id` / `plan_id`
 * 必填字符串，Reel 没有这两个概念，硬塞 = 编造 ID。这里 adapter 内部直接
 * INSERT，两个字段写 null，撞唯一约束时走同一条回读 + 完整身份核对分支。
 *
 * 幂等三层：
 *   1. adapter 派生 `factory-reel:<work_order>:<video>` 稳定 idempotency_key
 *   2. 数据库 UNIQUE (client_id, action_type='social.publish_post',
 *      payload->>idempotency_key) 挡重放
 *   3. Inngest 事件 id `measurementEventId(key, hours)` 让重放的 fan-out 只发
 *      一次 measure_due（Inngest 端去重）
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import {
  FACTORY_REEL_PUBLISHED_EVENT,
  FactoryReelPublishedEventSchema,
} from '@/lib/factory/publish/reel-published-event'
import {
  DAILY_PLAN_POST_MEASURE_EVENT,
  checkIsolation,
  readRegisteredPageId,
  type MeasureDueData,
} from './daily-plan-post-measurement'
import { SOCIAL_PUBLISH_ACTION_TYPE } from '@/lib/social/post-measurement-store'
import { measurementEventId } from '@/lib/campaign/daily-plan-publish'
import {
  socialReadbackOutcomeEnabled,
  writeReadbackOutcome,
} from '@/lib/social/readback-outcome-record'

const UNIQUE_VIOLATION = '23505'

/** Reel 与 daily-plan 走同一套测量窗口：T+4 / T+72。 */
export const REEL_MEASURE_WINDOWS = [4, 72] as const

/** (work_order, video) → 稳定 idempotency_key。 */
export function reelMeasurementIdempotencyKey(workOrderId: string, videoId: string): string {
  return `factory-reel:${workOrderId}:${videoId}`
}

/** Reel Feed story id = `<page>_<video>`。winner-reel-sync 生产已验证 promotable object。 */
export function reelPostId(pageId: string, videoId: string): string {
  return `${pageId}_${videoId}`
}

/** T+N 时刻从 `published_at` 起算，与现有 recordPublishAction.measureAt 同形状。 */
export function reelMeasureAt(
  publishedAt: string,
): { hours: number; at: string }[] {
  const t = new Date(publishedAt).getTime()
  if (!Number.isFinite(t)) throw new Error(`reelMeasureAt: invalid publishedAt ${publishedAt}`)
  return REEL_MEASURE_WINDOWS.map((h) => ({ hours: h, at: new Date(t + h * 3600_000).toISOString() }))
}

// ── 身份重绑 ────────────────────────────────────────────────────────────────

export type ReelActionRebindResult =
  | { ok: true; permalink: string | null }
  | {
      ok: false
      reason:
        | 'action_not_found'
        | 'client_mismatch'
        | 'page_mismatch'
        | 'video_mismatch'
        | 'not_published'
        | 'published_at_mismatch'
        | 'multiple_traffic_rows'
    }

type ReelTrafficClaim = {
  clientId: string
  workOrderId: string
  pageId: string
  videoId: string
  publishedAt: string
}

type ReelTrafficRow = { client_id: string; payload: Record<string, unknown> | null }

function judgeReelTrafficRow(row: ReelTrafficRow, claim: ReelTrafficClaim): ReelActionRebindResult {
  const p = (row.payload ?? {}) as Record<string, unknown>
  if (row.client_id !== claim.clientId) return { ok: false, reason: 'client_mismatch' }
  if (p.page_id !== claim.pageId) return { ok: false, reason: 'page_mismatch' }
  // published_ref 里 `post_id` 就是 bare video_id（PR #1424 语义）；video_id 有时也在。
  const storedVideo = p.video_id ?? p.post_id
  if (storedVideo !== claim.videoId) return { ok: false, reason: 'video_mismatch' }
  // A factory action also exists for draft uploads. The event's PUBLISHED claim is not proof.
  if (p.platform !== 'facebook' || p.video_state !== 'PUBLISHED') {
    return { ok: false, reason: 'not_published' }
  }
  if (typeof p.published_at !== 'string' ||
      Date.parse(p.published_at) !== Date.parse(claim.publishedAt)) {
    return { ok: false, reason: 'published_at_mismatch' }
  }
  const permalink = typeof p.permalink === 'string' ? p.permalink : null
  return { ok: true, permalink }
}

/**
 * 独立回读 `factory_reel_publish` action 做第二道身份闸。
 * event.data 来自 Inngest（可被伪造），action row 来自 publish-worker（可信）。
 * 任一字段不一致 fail-closed，不发测量事件。
 *
 * 开关默认关：沿用 maybeSingle。打开后按客户过滤，最多看 2 行；
 * 两行记 multiple_traffic_rows，不把数据库的「多行」错误抛出去。
 */
export async function rebindFactoryReelAction(
  supabase: SupabaseClient,
  claim: ReelTrafficClaim,
): Promise<ReelActionRebindResult> {
  const query = supabase
    .from('flywheel_actions')
    .select('id, client_id, payload')
    .eq('action_type', 'factory_reel_publish')
    .eq('payload->>work_order_id', claim.workOrderId)

  if (!socialReadbackOutcomeEnabled()) {
    const { data, error } = await query.maybeSingle()
    if (error) throw new Error(`rebindFactoryReelAction: db error — ${error.message}`)
    if (!data) return { ok: false, reason: 'action_not_found' }
    return judgeReelTrafficRow(data as ReelTrafficRow, claim)
  }

  const { data, error } = await query.eq('client_id', claim.clientId).limit(2)
  if (error) throw new Error(`rebindFactoryReelAction: db error — ${error.message}`)
  const rows = (data ?? []) as ReelTrafficRow[]
  if (rows.length > 1) return { ok: false, reason: 'multiple_traffic_rows' }
  if (rows.length === 0) return { ok: false, reason: 'action_not_found' }
  return judgeReelTrafficRow(rows[0], claim)
}

// ── social.publish_post 登记 ─────────────────────────────────────────────────

export interface RegisterReelPublishInput {
  clientId: string
  idempotencyKey: string
  postId: string
  pageId: string
  permalink: string | null
  publishedAt: string
  measureAt: { hours: number; at: string }[]
}

export type ReelPublishRegistrationResult =
  | { ok: true; actionId: string; created: boolean }
  | { ok: false; reason: 'db_error' | 'unique_conflict_unreadable' | 'identity_mismatch'; field?: string }

/**
 * 登记 Reel 的 `social.publish_post` 动作行 —— 与 daily-plan 走同一唯一约束
 * `(client_id, action_type='social.publish_post', payload->>idempotency_key)`。
 * campaign_id / plan_id 写 null（不伪造）。
 */
export async function registerReelPublishAction(
  supabase: SupabaseClient,
  input: RegisterReelPublishInput,
): Promise<ReelPublishRegistrationResult> {
  const row = {
    client_id: input.clientId,
    flywheel: 'social',
    action_type: SOCIAL_PUBLISH_ACTION_TYPE,
    execution_mode: 'in_house',
    vendor: 'meta_graph',
    expected_metric: null,
    expected_delta: null,
    executed_at: input.publishedAt,
    payload: {
      source: 'factory_reel',
      idempotency_key: input.idempotencyKey,
      post_id: input.postId,
      page_id: input.pageId,
      permalink: input.permalink,
      campaign_id: null,
      plan_id: null,
      published_at: input.publishedAt,
      measure_at: input.measureAt,
    },
  }

  const { data, error } = await supabase.from('flywheel_actions').insert(row).select('id').single()
  if (!error && data) return { ok: true, actionId: (data as { id: string }).id, created: true }
  if (!error || (error as { code?: string }).code !== UNIQUE_VIOLATION) {
    return { ok: false, reason: 'db_error' }
  }

  const { data: existing, error: readError } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, payload')
    .eq('client_id', input.clientId)
    .eq('action_type', SOCIAL_PUBLISH_ACTION_TYPE)
    .eq('payload->>idempotency_key', input.idempotencyKey)
    .maybeSingle()
  if (readError || !existing) return { ok: false, reason: 'unique_conflict_unreadable' }
  const mismatch = reelPublishIdentityMismatch(existing as Record<string, unknown>, input)
  if (mismatch) return { ok: false, reason: 'identity_mismatch', field: mismatch }
  return { ok: true, actionId: (existing as { id: string }).id, created: false }
}

/** 回读同 idempotency_key 的旧行时全字段核对，防身份漂移串台。 */
export function reelPublishIdentityMismatch(
  existing: Record<string, unknown> | null,
  input: RegisterReelPublishInput,
): string | null {
  if (!existing) return 'action_not_readable'
  const p = ((existing as { payload?: Record<string, unknown> }).payload ?? {}) as Record<string, unknown>
  const checks: [string, unknown, unknown][] = [
    ['client_id', (existing as { client_id?: unknown }).client_id, input.clientId],
    ['post_id', p.post_id, input.postId],
    ['page_id', p.page_id, input.pageId],
    ['idempotency_key', p.idempotency_key, input.idempotencyKey],
    ['published_at', p.published_at, input.publishedAt],
    ['campaign_id', p.campaign_id ?? null, null],
    ['plan_id', p.plan_id ?? null, null],
  ]
  for (const [name, a, b] of checks) if (a !== b) return `${name}_mismatch`
  const existingMa = p.measure_at
  if (!Array.isArray(existingMa)) return 'measure_at_missing'
  if (existingMa.length !== input.measureAt.length) return 'measure_at_length_mismatch'
  const norm = (xs: { hours: number; at: string }[]) =>
    JSON.stringify([...xs].sort((x, y) => x.hours - y.hours))
  if (norm(existingMa as { hours: number; at: string }[]) !== norm(input.measureAt)) {
    return 'measure_at_mismatch'
  }
  return null
}

// ── Inngest fan-out ────────────────────────────────────────────────────────

type RefusalStep = { run: (id: string, fn: () => Promise<void>) => Promise<unknown> }

/** 开关关着时什么都不写。打开后同一轮只记一次，重放命中 step 缓存不再插第二行。 */
async function recordReelReadbackRefusal(
  step: RefusalStep,
  supabase: SupabaseClient,
  input: { clientId: string; subjectRef: string; reason: string },
): Promise<void> {
  if (!socialReadbackOutcomeEnabled()) return
  await step.run('record-readback-refusal', () =>
    writeReadbackOutcome(supabase, {
      clientId: input.clientId,
      subjectKind: 'reel',
      subjectRef: input.subjectRef,
      outcome: `reel_rebind_refused:${input.reason}`,
      reason: input.reason,
    }),
  )
}

export function createFactoryReelMeasurementAdapter(deps: { supabase: SupabaseClient }) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}factory-reel-measurement-adapter`,
      name: 'Factory Reel: adapt to measurement fan-out',
      concurrency: { limit: 4, key: 'event.data.page_id' },
    },
    { event: FACTORY_REEL_PUBLISHED_EVENT },
    async ({ event, step }) => {
      const parsed = FactoryReelPublishedEventSchema.safeParse(event.data)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid_payload', issues: parsed.error.issues.slice(0, 5) }
      }
      const d = parsed.data
      const postId = reelPostId(d.page_id, d.video_id)

      const refusal = (reason: string) => recordReelReadbackRefusal(step, deps.supabase, {
        clientId: d.client_id,
        subjectRef: postId,
        reason,
      })

      const isolation = await step.run('isolation-check', async () => {
        const registered = await readRegisteredPageId(deps.supabase, d.client_id)
        return checkIsolation(registered, { page_id: d.page_id, post_id: postId })
      })
      if (!isolation.ok) {
        await refusal(isolation.reason)
        return { ok: false, reason: isolation.reason }
      }

      const rebind = await step.run('rebind-factory-action-v2', () =>
        rebindFactoryReelAction(deps.supabase, {
          clientId: d.client_id,
          workOrderId: d.work_order_id,
          pageId: d.page_id,
          videoId: d.video_id,
          publishedAt: d.published_at,
        }),
      )
      if (!rebind.ok) {
        await refusal(rebind.reason)
        return { ok: false, reason: rebind.reason }
      }

      const idempotencyKey = reelMeasurementIdempotencyKey(d.work_order_id, d.video_id)
      const measureAt = reelMeasureAt(d.published_at)
      const registration = await step.run('register-publish-action', () =>
        registerReelPublishAction(deps.supabase, {
          clientId: d.client_id,
          idempotencyKey,
          postId,
          pageId: d.page_id,
          permalink: rebind.permalink ?? d.permalink ?? null,
          publishedAt: d.published_at,
          measureAt,
        }),
      )
      if (!registration.ok) {
        const reason = registration.field
          ? `${registration.reason}:${registration.field}`
          : registration.reason
        await refusal(reason)
        return { ok: false, reason: registration.reason, field: registration.field }
      }

      const eventIds = await step.run('fan-out-windows', async () => {
        const ids: string[] = []
        for (const w of measureAt) {
          const sent = await sendInngestEvent<Record<string, unknown>>({
            id: measurementEventId(idempotencyKey, w.hours),
            name: DAILY_PLAN_POST_MEASURE_EVENT,
            data: {
              client_id: d.client_id,
              action_id: registration.actionId,
              idempotency_key: idempotencyKey,
              post_id: postId,
              page_id: d.page_id,
              window_hours: w.hours,
              target_at: w.at,
            } satisfies MeasureDueData,
          })
          ids.push(...sent.event_ids)
        }
        return ids
      })

      return {
        ok: true,
        action_id: registration.actionId,
        created: registration.created,
        windows: measureAt.length,
        event_ids: eventIds,
      }
    },
  )
}

export const factoryReelMeasurementAdapter = createFactoryReelMeasurementAdapter({ supabase: supabaseAdmin })
