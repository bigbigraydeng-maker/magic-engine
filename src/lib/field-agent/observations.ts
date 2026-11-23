import { supabaseAdmin as db } from '@/lib/supabase'
import { FIELD_AGENT_OBSERVATIONS_TABLE, FIELD_AGENT_SCREENSHOT_BUCKET } from './contracts'

const REVIEW_LIST_LIMIT = 50
const SIGNED_URL_SECONDS = 600

export type AdReviewCard = {
  id: string
  competitor_name: string
  competitor_domain: string | null
  ad_library_id: string
  primary_text: string
  headline: string
  cta: string
  landing_url: string
  offer_text: string
  platforms: string[]
  started_running_on: string | null
  facebook_page_url: string
  source_url: string
  observed_at: string
  task_id: string | null
  review_status: 'pending' | 'approved' | 'rejected'
  review_notes: string | null
  screenshot_url: string | null
}

type ObservationRow = {
  id: string
  source_url: string
  competitor_domain: string | null
  observed_at: string
  payload: unknown
  review_status: string
  review_notes: string | null
  task_id: string | null
  screenshot_path: string | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function matchesCompetitor(card: { competitor_name: string; competitor_domain: string | null }, competitor: string): boolean {
  const needle = competitor.trim().toLowerCase()
  if (!needle) return true
  return card.competitor_name.toLowerCase() === needle || (card.competitor_domain ?? '').toLowerCase() === needle
}

export function toAdReviewCard(row: ObservationRow, screenshotUrl: string | null): AdReviewCard | null {
  if (row.review_status !== 'pending' && row.review_status !== 'approved' && row.review_status !== 'rejected') return null
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : {}
  const platforms = Array.isArray(payload.platforms) ? payload.platforms.filter((item): item is string => typeof item === 'string') : []
  return {
    id: row.id,
    competitor_name: text(payload.competitor_name),
    competitor_domain: row.competitor_domain,
    ad_library_id: text(payload.ad_library_id),
    primary_text: text(payload.primary_text),
    headline: text(payload.headline),
    cta: text(payload.cta),
    landing_url: text(payload.landing_url),
    offer_text: text(payload.offer_text),
    platforms,
    started_running_on: typeof payload.started_running_on === 'string' ? payload.started_running_on : null,
    facebook_page_url: text(payload.facebook_page_url),
    source_url: row.source_url,
    observed_at: row.observed_at,
    task_id: row.task_id,
    review_status: row.review_status,
    review_notes: row.review_notes,
    screenshot_url: screenshotUrl,
  }
}

async function signScreenshot(clientId: string, path: string | null): Promise<string | null> {
  if (!path || !path.startsWith(`${clientId}/`)) return null
  const signed = await db.storage.from(FIELD_AGENT_SCREENSHOT_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS)
  if (signed.error || !signed.data?.signedUrl) return null
  return signed.data.signedUrl
}

export async function listAdObservations(clientId: string, reviewStatus: 'pending' | 'approved' | 'rejected', competitor = ''): Promise<AdReviewCard[]> {
  const result = await db.from(FIELD_AGENT_OBSERVATIONS_TABLE)
    .select('id,source_url,competitor_domain,observed_at,payload,review_status,review_notes,task_id,screenshot_path')
    .eq('client_id', clientId)
    .eq('source_type', 'meta_ad_library')
    .eq('review_status', reviewStatus)
    .order('observed_at', { ascending: false })
    .limit(REVIEW_LIST_LIMIT)
  if (result.error) throw new Error('field_agent_observation_read_failed')
  const cards: AdReviewCard[] = []
  for (const row of (result.data ?? []) as ObservationRow[]) {
    const card = toAdReviewCard(row, await signScreenshot(clientId, row.screenshot_path))
    if (card && matchesCompetitor(card, competitor)) cards.push(card)
  }
  return cards
}

export async function reviewAdObservation(input: {
  clientId: string
  observationId: string
  reviewStatus: 'approved' | 'rejected'
  reviewNotes: string | null
  reviewedBy: string
}): Promise<'updated' | 'missing'> {
  const result = await db.rpc('web_intelligence_review_observation', {
    p_id: input.observationId,
    p_client_id: input.clientId,
    p_status: input.reviewStatus,
    p_reviewer: input.reviewedBy.slice(0, 200),
    p_notes: input.reviewNotes,
  })
  if (!result.error) return 'updated'
  if (result.error.message.includes('observation_not_pending')) return 'missing'
  throw new Error('field_agent_observation_review_failed')
}
