/**
 * Factory Reel publish signal — the upstream→downstream alignment contract
 * (CTS daily video Reel → me_ad_launch auto ad-draft).
 *
 * This module owns the *contract* only: the event name, the payload schema,
 * the deterministic idempotency id, and the pure event builder. It never talks
 * to Inngest or the database — publish-worker does the actual `sendInngestEvent`
 * so these fail-closed rules stay unit-testable without a network.
 *
 * Why a new event and not `daily_plan.post.published`: that event is hard-bound
 * to the campaign daily-plan (image) pipeline — its schema forces
 * campaign_id/plan_id/plan_revision/review_revision/measure_at and its `post_id`
 * regex is `<page>_<post>`. A Reel carries a bare `video_id` and has no
 * campaign/plan concept, so reusing that event would mean fabricating ids. This
 * event is the Reel-native equivalent, in the same `me/factory.*` namespace as
 * the other factory events.
 *
 * 🔴 Semantics the downstream consumer must rely on:
 *  - `video_id` is authoritative — it is the published Reel's media id.
 *  - `post_id` equals `video_id` for a Reel (there is no separate feed story id).
 *    Downstream builds a zero-retransmit ad creative as
 *    `object_story_id = "<page_id>_<video_id>"` — the same shape winner-reel-sync
 *    already promotes successfully in production.
 *  - The event fires ONLY for a real live (video_state=PUBLISHED) Reel. A DRAFT
 *    Reel is never promotable and never emits.
 *  - `id` (below) is the Inngest de-dup key — one logical publish emits one
 *    event even if the worker's reconcile path resends it.
 */
import { z } from 'zod'

export const FACTORY_REEL_PUBLISHED_EVENT = 'me/factory.reel.published' as const

// Loose UUID *shape* check — this repo's seeded client ids (e.g. CTS
// `c0000000-…`) are not RFC4122-valid, so `z.uuid()` rejects them.
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

/** Meta Page ids and video ids are numeric strings. */
const numericId = z.string().regex(/^\d{5,25}$/)

/**
 * `me/factory.reel.published` payload — ONE event per live-published Reel.
 *
 * Every field a downstream ad builder needs to construct the creative without
 * re-uploading the video: `page_id` + `video_id`. `work_order_id` lets the
 * attribution layer (creative-link.ts) tie the resulting ad back to this Reel.
 * The authorization/no_publish/status/cost fields make it a machine-readable
 * receipt per the repo's Inngest side-effect contract.
 */
export const FactoryReelPublishedEventSchema = z.object({
  schema_version: z.literal(1),
  request_id: uuidLike,
  work_order_id: uuidLike,
  client_id: uuidLike,
  platform: z.literal('facebook'),
  page_id: numericId,
  /** Authoritative published Reel media id. */
  video_id: numericId,
  /** Equals `video_id` for a Reel — kept explicit so a downstream reader never
   *  has to know that identity. Used to build `<page_id>_<video_id>`. */
  post_id: numericId,
  media_type: z.literal('reel'),
  permalink: z.string().url().optional(),
  published_at: z.string().datetime(),
  status: z.literal('PUBLISHED'),
  no_publish: z.literal(false),
  authorization: z.literal('AUTHORIZED'),
  cost_usd: z.literal(0),
  created_at: z.string().datetime(),
})

export type FactoryReelPublishedEvent = z.infer<typeof FactoryReelPublishedEventSchema>

/**
 * Deterministic Inngest event id (the de-dup key).
 *
 * Derived from the content identity (work order + published video), not the
 * attempt: the normal publish path and the reconcile resend path produce the
 * same id, so Inngest collapses them to one delivery instead of building the
 * ad twice.
 */
export function reelPublishedEventId(workOrderId: string, videoId: string): string {
  return `me-factory-reel-${workOrderId}-${videoId}`
}

export interface BuildReelPublishedEventInput {
  workOrderId: string
  clientId: string
  pageId: string
  videoId: string
  permalink?: string
  publishedAt: string
  requestId: string
  createdAt: string
}

/**
 * Graph 返回的 Reel `permalink_url` 是**相对路径**(如 `/reel/123/`),不是完整网址。
 * schema 的 `.url()` 会拒相对路径 —— 2026-09-07 首发实测:一条真发出去的 Reel 因此
 * 让整个发布信号发不出(且会让补发对账每轮重撞同一个 schema 错)。这里补全成绝对网址,
 * 相对路径拼 facebook.com,已是绝对的原样返回,拼不出合法网址就丢弃(permalink 非关键)。
 */
function normalisePermalink(raw?: string): string | undefined {
  if (!raw) return undefined
  const candidate = raw.startsWith('/') ? `https://www.facebook.com${raw}` : raw
  try {
    return new URL(candidate).toString()
  } catch {
    return undefined
  }
}

/**
 * Pure builder — returns the exact `{ id, name, data }` shape sendInngestEvent
 * expects. Throws if the assembled payload fails its own schema, so a malformed
 * event can never be sent (fail-closed at the boundary, not by a caller's `if`).
 */
export function buildReelPublishedEvent(input: BuildReelPublishedEventInput): {
  id: string
  name: typeof FACTORY_REEL_PUBLISHED_EVENT
  data: FactoryReelPublishedEvent
} {
  const data: FactoryReelPublishedEvent = FactoryReelPublishedEventSchema.parse({
    schema_version: 1,
    request_id: input.requestId,
    work_order_id: input.workOrderId,
    client_id: input.clientId,
    platform: 'facebook',
    page_id: input.pageId,
    video_id: input.videoId,
    post_id: input.videoId,
    media_type: 'reel',
    ...((): { permalink?: string } => {
      const p = normalisePermalink(input.permalink)
      return p ? { permalink: p } : {}
    })(),
    published_at: input.publishedAt,
    status: 'PUBLISHED',
    no_publish: false,
    authorization: 'AUTHORIZED',
    cost_usd: 0,
    created_at: input.createdAt,
  })
  return { id: reelPublishedEventId(input.workOrderId, input.videoId), name: FACTORY_REEL_PUBLISHED_EVENT, data }
}
