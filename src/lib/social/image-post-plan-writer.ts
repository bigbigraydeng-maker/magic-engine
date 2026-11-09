/**
 * Writes an auto-drafted image post into `social_plans` as a campaign_daily_v1 row.
 *
 * Each automated draft gets its own row (one date, one post).
 * PM reviews it on the daily plan page; auto-publish picks it up after approval.
 */
import type {
  CampaignDailyPlanData,
  CampaignDailyPostDraft,
} from '@/lib/campaign/daily-plan'
import { CAMPAIGN_DAILY_PLAN_KIND } from '@/lib/campaign/daily-plan'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImagePostPlanWriterInput {
  clientId: string
  campaignId: string
  date: string // YYYY-MM-DD
  draft: CampaignDailyPostDraft
  tourSlug: string
}

export interface ImagePostPlanWriterDeps {
  insertPlan: (row: {
    client_id: string
    campaign_id: string
    platform: string
    wave_number: number
    plan_data: CampaignDailyPlanData
  }) => Promise<{ id: string }>
}

export type ImagePostPlanWriteResult =
  | { ok: true; planId: string }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Build the plan_data envelope
// ---------------------------------------------------------------------------

export function buildImagePostPlanData(
  input: Pick<ImagePostPlanWriterInput, 'campaignId' | 'date' | 'draft' | 'tourSlug'>,
): CampaignDailyPlanData {
  const now = new Date().toISOString()
  return {
    plan_kind: CAMPAIGN_DAILY_PLAN_KIND,
    campaign_id: input.campaignId,
    master_brief_ref: null,
    days: [
      {
        date: input.date,
        slots: { post: 'PLANNED', story: 'NOT_PLANNED', reel: 'NOT_PLANNED' },
      },
    ],
    bundles: [
      {
        date: input.date,
        post: input.draft,
        story: null,
        reel: null,
      },
    ],
    command_meta: {
      source: 'auto_image_post',
      received_at: now,
      raw_summary: `Auto-drafted image post for tour "${input.tourSlug}" on ${input.date}`,
    },
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function writeImagePostPlan(
  input: ImagePostPlanWriterInput,
  deps: ImagePostPlanWriterDeps,
): Promise<ImagePostPlanWriteResult> {
  const planData = buildImagePostPlanData(input)
  try {
    const { id } = await deps.insertPlan({
      client_id: input.clientId,
      campaign_id: input.campaignId,
      platform: 'facebook',
      wave_number: 1,
      plan_data: planData,
    })
    return { ok: true, planId: id }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message.slice(0, 300) }
  }
}
