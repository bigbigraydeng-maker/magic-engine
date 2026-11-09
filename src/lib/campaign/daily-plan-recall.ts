/**
 * Campaign Daily Plan — Facebook recall (undo publish) contract.
 *
 * Sibling of `daily-plan-publish.ts`, same shape and same fail-closed rules.
 * Owned by this module: the command schema, the receipt schema, and the
 * partition helper that decides which of the requested dates still exist on
 * the Page (and are therefore recallable). Route glue and Graph calls live
 * elsewhere — this file is provider-free so its guarantees can be unit-tested
 * without a network or a Supabase stub.
 *
 * ## Why recall belongs in its own contract, not as a flag on publish
 *
 * Recall is an unrelated action against the same object. Folding it into the
 * publish command means every failure branch, every idempotency test, and
 * every dry-run/live gate would have to consider both directions and the
 * conditions under which one implies the other. Keeping them separate lets the
 * publish contract stay a single-purpose "add" and this one a single-purpose
 * "remove", and lets the review-and-approval story for each be independent.
 *
 * ## The rule that keeps a recall from destroying the receipt
 *
 * A recall does not delete the receipt row. It *marks* each recalled post
 * with `recalled_at`, and moves it out of `published[]` into `recalled[]` (a
 * new field on the receipt). The idempotency key is preserved, so a re-publish
 * of the same content (same plan_revision + review_revision + date) still hits
 * the same key and can decide whether that key means "don't publish, we have
 * it" or "we recalled it, please publish again".
 *
 * ## Fail-closed authorisation, same as publish
 *
 * Every authorisation field is `z.literal(true)`; a caller that omits one or
 * sends `false` is rejected at parse time, before any read, any token lookup,
 * and any Graph call. `no_recall` defaults to `true`: silence is a dry run.
 */
import { z } from 'zod'

export const DAILY_PLAN_POST_RECALLED_EVENT = 'daily_plan.post.recalled' as const

const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const pageIdSchema = z.string().regex(/^\d{5,25}$/, 'page_id must be a numeric Meta Page id')

/**
 * Inbound recall command.
 *
 * `dates` is required and non-empty: recall is always scoped to explicitly
 * chosen dates, never "recall everything we ever published for this plan".
 * That would be a foot-cannon — the receipt spans the plan's whole life and a
 * typo could wipe months of legitimate posts.
 */
export const CampaignDailyRecallCommandSchema = z.object({
  client_id: uuidLike,
  campaign_id: uuidLike,
  plan_id: uuidLike,
  plan_revision: z.string().datetime(),
  review_revision: uuidLike,
  page_id: pageIdSchema,
  approved: z.literal(true),
  publish_authorization: z.literal(true),
  no_recall: z.boolean().default(true),
  dates: z.array(dateStringSchema).min(1),
})

export type CampaignDailyRecallCommand = z.infer<typeof CampaignDailyRecallCommandSchema>

export interface CampaignDailyRecalledPost {
  date: string
  idempotency_key: string
  post_id: string
  page_id: string
  recalled_at: string
  /** true when Meta reported the post was already gone before we tried; the
   *  recall is still recorded, so a duplicate request is a no-op instead of an
   *  error. */
  already_gone: boolean
  provider_response: Record<string, unknown>
}

export interface CampaignDailyRecallFailure {
  date: string
  idempotency_key: string
  error: string
  failed_at: string
}

export const CampaignDailyRecalledPostSchema = z.object({
  date: dateStringSchema,
  idempotency_key: z.string().min(1),
  post_id: z.string().min(1),
  page_id: pageIdSchema,
  recalled_at: z.string().datetime(),
  already_gone: z.boolean(),
  provider_response: z.record(z.string(), z.unknown()),
})

/**
 * Split the requested dates into three groups:
 *   1. `pending`: date is in the receipt's `published[]` — we can call
 *      Graph DELETE for it now.
 *   2. `already_recalled`: date is already in `recalled[]` — no-op.
 *   3. `not_published`: date was never in `published[]` — reject; a recall
 *      that names a date we never published is almost certainly a mistake
 *      the caller should see, not a silent pass.
 */
export function partitionRecallCandidates(
  requestedDates: string[],
  receipt: {
    published: Array<{ date: string; idempotency_key: string; post_id: string; page_id: string }>
    recalled?: Array<{ date: string; idempotency_key: string; post_id: string }>
  },
): {
  pending: Array<{ date: string; idempotency_key: string; post_id: string; page_id: string }>
  already_recalled: Array<{ date: string; idempotency_key: string }>
  not_published: string[]
} {
  const publishedByDate = new Map(receipt.published.map((p) => [p.date, p]))
  const recalledByDate = new Map((receipt.recalled ?? []).map((p) => [p.date, p]))

  const pending: Array<{ date: string; idempotency_key: string; post_id: string; page_id: string }> = []
  const already_recalled: Array<{ date: string; idempotency_key: string }> = []
  const not_published: string[] = []

  for (const date of requestedDates) {
    if (recalledByDate.has(date)) {
      const r = recalledByDate.get(date)!
      already_recalled.push({ date, idempotency_key: r.idempotency_key })
      continue
    }
    if (publishedByDate.has(date)) {
      pending.push(publishedByDate.get(date)!)
      continue
    }
    not_published.push(date)
  }

  return { pending, already_recalled, not_published }
}
