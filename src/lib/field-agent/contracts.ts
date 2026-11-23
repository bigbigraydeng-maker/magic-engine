import { createHash } from 'node:crypto'
import { z } from 'zod'

export const FIELD_AGENT_TASKS_TABLE = 'field_agent_tasks'
export const FIELD_AGENT_OBSERVATIONS_TABLE = 'web_intelligence_external_observations'
export const FIELD_AGENT_SCREENSHOT_BUCKET = 'field-agent-screenshots'

export const fieldAgentTaskTypeSchema = z.enum([
  'competitor_ads_scan', 'google_maps_rating', 'tripadvisor_scan', 'ai_answer_scan',
])
export type FieldAgentTaskType = z.infer<typeof fieldAgentTaskTypeSchema>

export const fieldAgentTaskStatusSchema = z.enum(['queued', 'running', 'done', 'failed'])
export const fieldObservationReviewSchema = z.enum(['not_required', 'pending', 'approved', 'rejected'])
export const adPlatformSchema = z.enum(['facebook', 'instagram', 'messenger', 'audience_network', 'threads'])
export const aiAnswerEngineSchema = z.enum(['google_ai_overview', 'chatgpt', 'perplexity', 'gemini', 'copilot', 'other'])

/** Exact JSON the dashboard button sends. The server adds competitors before dispatch. */
export const DASHBOARD_COMPETITOR_ADS_REQUEST = {
  task_type: 'competitor_ads_scan',
  params: { channel: 'meta_ad_library', active_only: true },
} as const

export const dashboardCompetitorAdsRequestSchema = z.object({
  task_type: z.literal('competitor_ads_scan'),
  params: z.object({
    channel: z.literal('meta_ad_library'),
    active_only: z.literal(true),
  }).strict(),
}).strict()

export const fieldAgentWriteTargets = {
  tasks_table: FIELD_AGENT_TASKS_TABLE,
  observations_table: FIELD_AGENT_OBSERVATIONS_TABLE,
  screenshot_bucket: FIELD_AGENT_SCREENSHOT_BUCKET,
} as const

export type FieldAgentWebhookBody = {
  task_id: string
  client_id: string
  task_type: 'competitor_ads_scan'
  params: {
    channel: 'meta_ad_library'
    active_only: true
    competitors: Array<{ domain: string; tier: string; urls: string[] }>
  }
  write_targets: typeof fieldAgentWriteTargets
}

const httpsUrl = z.string().url().max(2048).refine(value => value.startsWith('https://'), 'https_required')

const metaAdLibraryObject = z.object({
  competitor_name: z.string().trim().min(1).max(200),
  ad_library_id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,80}$/),
  platforms: z.array(adPlatformSchema).min(1).max(8),
  primary_text: z.string().max(5000).optional(),
  headline: z.string().max(500).optional(),
  cta: z.string().max(80).optional(),
  offer_text: z.string().max(500).optional(),
  landing_url: httpsUrl.optional(),
  facebook_page_id: z.string().max(64).optional(),
  facebook_page_url: httpsUrl.optional(),
  started_running_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict()
export const metaAdLibraryPayloadSchema = metaAdLibraryObject.refine(
  payload => [payload.primary_text, payload.headline, payload.offer_text].some(value => value?.trim()),
  'ad_text_required',
)

export const ratingPayloadSchema = z.object({
  competitor_name: z.string().trim().min(1).max(200),
  rating: z.number().min(0).max(5),
  review_count: z.number().int().min(0).max(100_000_000),
}).strict()

export const googleMapsRatingPayloadSchema = ratingPayloadSchema.extend({
  maps_url: httpsUrl,
}).strict()

export const tripadvisorPayloadSchema = ratingPayloadSchema.extend({
  location_url: httpsUrl,
}).strict()

export const aiAnswerPayloadSchema = z.object({
  query: z.string().trim().min(1).max(500),
  engine: aiAnswerEngineSchema,
  mentioned: z.boolean(),
  citation_urls: z.array(httpsUrl).max(8).optional(),
}).strict()

export function metaAdLibraryCanonicalUrl(adLibraryId: string): string {
  const id = metaAdLibraryObject.shape.ad_library_id.parse(adLibraryId)
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`
}

/** sha256 of the exact newline-joined string the agent must hash. */
export function metaAdContentHash(input: { ad_library_id: string; primary_text?: string; headline?: string; landing_url?: string }): string {
  const material = ['meta_ad_library', input.ad_library_id, input.primary_text ?? '', input.headline ?? '', input.landing_url ?? ''].join('\n')
  return createHash('sha256').update(material).digest('hex')
}

export function fieldAgentScreenshotPath(clientId: string, taskId: string, fileName: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clientId)) throw new Error('invalid_client_id')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(taskId)) throw new Error('invalid_task_id')
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(fileName)) throw new Error('invalid_screenshot_name')
  return `${clientId}/${taskId}/${fileName}`
}

export type ScanCompetitor = { domain: string; tier: string; status: string; urls: string[] }

export function buildCompetitorAdsParams(competitors: ScanCompetitor[]): FieldAgentWebhookBody['params'] {
  return {
    channel: 'meta_ad_library',
    active_only: true,
    competitors: competitors
      .filter(item => item.status !== 'archive')
      .slice(0, 20)
      .map(item => ({ domain: item.domain, tier: item.tier, urls: item.urls.slice(0, 3) })),
  }
}
