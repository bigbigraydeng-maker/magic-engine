/**
 * Factory Instagram Reel publish signal — the upstream→downstream alignment
 * contract for the Instagram/Publer path (CTS daily video Reel → Publer draft
 * or scheduled post).
 *
 * This module owns the *contract* only: the event name, the payload schema,
 * the deterministic idempotency id, and the pure event builder. It never talks
 * to Inngest or the database — the publish worker does the actual
 * `sendInngestEvent` so these fail-closed rules stay unit-testable without a
 * network.
 *
 * Why a new event and not `me/factory.reel.published`: that event is hard-bound
 * to Facebook — its schema forces `platform: 'facebook'` and its `page_id` +
 * `video_id` are consumed to build a Facebook ad creative and Facebook
 * measurement. Feeding an Instagram/Publer id into it would corrupt those
 * consumers. Instagram therefore gets its own event, in the same
 * `me/factory.*` namespace as the other factory events.
 *
 * 🔴 Semantics the downstream consumer must rely on:
 *  - `provider_state` is authoritative for what actually happened upstream:
 *    Publer accepting a post as a *draft* or *scheduled* is NOT the same as it
 *    being public, hence the event name says "submitted", not "published".
 *  - `no_publish` and `authorization` are DERIVED from `provider_state` by the
 *    builder — a caller cannot pass them, so a draft can never masquerade as an
 *    authorized publish (or vice versa).
 *  - `id` (below) is the Inngest de-dup key — one logical submit emits one
 *    event even if the worker's reconcile path resends it.
 */
import { z } from 'zod'

export const FACTORY_REEL_INSTAGRAM_SUBMITTED_EVENT =
  'me/factory.reel.instagram.submitted' as const

// Loose UUID *shape* check — this repo's seeded client ids (e.g. CTS
// `c0000000-…`) are not RFC4122-valid, so `z.uuid()` rejects them.
const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

/** Publer account ids and media ids are opaque provider tokens. */
const providerId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)

/**
 * `me/factory.reel.instagram.submitted` payload — ONE event per Reel submitted
 * to Publer (as a draft or a scheduled post).
 *
 * `publer_account_id` + `media_id` are what a downstream consumer needs to
 * reference the submitted media without re-uploading it. `work_order_id` lets
 * the attribution layer tie the resulting post back to this Reel. The
 * no_publish/authorization/status/cost fields make it a machine-readable
 * receipt per the repo's Inngest side-effect contract.
 */
export const FactoryReelInstagramSubmittedEventSchema = z
  .object({
    schema_version: z.literal(1),
    request_id: uuidLike,
    work_order_id: uuidLike,
    client_id: uuidLike,
    platform: z.literal('instagram'),
    channel: z.literal('publer'),
    publer_account_id: providerId,
    /** Authoritative submitted media id. */
    media_id: providerId,
    /** Optional provider post id, once Publer assigns one. */
    post_id: providerId.optional(),
    media_type: z.literal('reel'),
    provider_state: z.enum(['draft', 'scheduled']),
    scheduled_at: z.string().datetime().optional(),
    no_publish: z.boolean(),
    authorization: z.enum(['DRAFT_ONLY', 'AUTHORIZED']),
    first_comment_requested: z.boolean(),
    cost_usd: z.literal(0),
    created_at: z.string().datetime(),
  })
  .superRefine((data, ctx) => {
    if (data.provider_state === 'draft') {
      if (data.no_publish !== true) {
        ctx.addIssue({
          code: 'custom',
          path: ['no_publish'],
          message: 'draft submissions must set no_publish=true',
        })
      }
      if (data.authorization !== 'DRAFT_ONLY') {
        ctx.addIssue({
          code: 'custom',
          path: ['authorization'],
          message: "draft submissions must set authorization='DRAFT_ONLY'",
        })
      }
      if (data.scheduled_at !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['scheduled_at'],
          message: 'draft submissions must not carry scheduled_at',
        })
      }
    } else {
      if (data.no_publish !== false) {
        ctx.addIssue({
          code: 'custom',
          path: ['no_publish'],
          message: 'scheduled submissions must set no_publish=false',
        })
      }
      if (data.authorization !== 'AUTHORIZED') {
        ctx.addIssue({
          code: 'custom',
          path: ['authorization'],
          message: "scheduled submissions must set authorization='AUTHORIZED'",
        })
      }
      if (data.scheduled_at === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['scheduled_at'],
          message: 'scheduled submissions must carry scheduled_at',
        })
      }
    }
  })

export type FactoryReelInstagramSubmittedEvent = z.infer<
  typeof FactoryReelInstagramSubmittedEventSchema
>

/**
 * Deterministic Inngest event id (the de-dup key).
 *
 * Derived from the content identity (work order + submitted media), not the
 * attempt: the normal submit path and the reconcile resend path produce the
 * same id, so Inngest collapses them to one delivery instead of processing the
 * submission twice.
 */
export function instagramReelSubmittedEventId(workOrderId: string, mediaId: string): string {
  return `me-factory-ig-reel-${workOrderId}-${mediaId}`
}

export interface BuildInstagramReelSubmittedEventInput {
  workOrderId: string
  clientId: string
  publerAccountId: string
  mediaId: string
  postId?: string
  providerState: 'draft' | 'scheduled'
  scheduledAt?: string
  firstCommentRequested: boolean
  requestId: string
  createdAt: string
}

/**
 * Pure builder — returns the exact `{ id, name, data }` shape sendInngestEvent
 * expects. `no_publish` and `authorization` are derived from `providerState`
 * (callers cannot pass them), and the assembled payload is parsed with its own
 * schema, so a malformed event can never be sent (fail-closed at the boundary,
 * not by a caller's `if`).
 */
export function buildInstagramReelSubmittedEvent(
  input: BuildInstagramReelSubmittedEventInput,
): {
  id: string
  name: typeof FACTORY_REEL_INSTAGRAM_SUBMITTED_EVENT
  data: FactoryReelInstagramSubmittedEvent
} {
  const isDraft = input.providerState === 'draft'
  const data: FactoryReelInstagramSubmittedEvent =
    FactoryReelInstagramSubmittedEventSchema.parse({
      schema_version: 1,
      request_id: input.requestId,
      work_order_id: input.workOrderId,
      client_id: input.clientId,
      platform: 'instagram',
      channel: 'publer',
      publer_account_id: input.publerAccountId,
      media_id: input.mediaId,
      ...(input.postId !== undefined ? { post_id: input.postId } : {}),
      media_type: 'reel',
      provider_state: input.providerState,
      ...(input.scheduledAt !== undefined ? { scheduled_at: input.scheduledAt } : {}),
      no_publish: isDraft,
      authorization: isDraft ? 'DRAFT_ONLY' : 'AUTHORIZED',
      first_comment_requested: input.firstCommentRequested,
      cost_usd: 0,
      created_at: input.createdAt,
    })
  return {
    id: instagramReelSubmittedEventId(input.workOrderId, input.mediaId),
    name: FACTORY_REEL_INSTAGRAM_SUBMITTED_EVENT,
    data,
  }
}
