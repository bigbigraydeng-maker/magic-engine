import { z } from 'zod'

export const metadataSchema = z.object({
  domain: z.string().min(3).max(253),
  tier: z.enum(['core', 'secondary', 'benchmark', 'watch']),
  status: z.enum(['active', 'emerging', 'archive']),
  sources: z.array(z.enum(['manual', 'google_serp', 'meta_ads', 'ai_visibility', 'me_discovery', 'brief', 'auto', 'industry_baseline'])).max(12),
  tags: z.array(z.string().trim().min(1).max(60)).max(20),
  urls: z.array(z.string().url().max(2048)).max(3),
  interval_hours: z.number().int().min(24).max(720),
}).strict()
export type MonitorCompetitor = z.infer<typeof metadataSchema>
export const settingsSchema = z.object({
  enabled: z.boolean(), entitled: z.boolean(), entitlement_price: z.literal(499),
  entitlement_currency: z.enum(['NZD', 'AUD', 'USD']).nullable(),
  target_nzd: z.number().finite().positive().max(30),
  hard_stop_nzd: z.number().finite().positive().max(50),
  usd_to_nzd: z.number().finite().positive().lt(10),
  fx_as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  actor_build: z.string().regex(/^\d+\.\d+\.\d+$/),
  capture_limit_usd: z.number().finite().min(0.01).max(1),
  overhead_nzd: z.number().finite().min(0.02).max(1),
  context: z.string().max(2000),
}).strict().refine(s => s.hard_stop_nzd >= s.target_nzd, 'Hard stop must cover target')
export type Settings = z.infer<typeof settingsSchema>
export const requestSchema = z.object({ client_id: z.string().guid(), request_id: z.string().uuid(), domain: z.string().max(253), url: z.string().url().max(2048) }).strict()
export type CaptureRequest = z.infer<typeof requestSchema>

/** Shared vocabulary for website, media, jobs and other external intelligence feeds. */
export const externalSourceTypeSchema = z.enum([
  'website', 'mainstream_news', 'industry_news', 'industry_media', 'jobs',
  'facebook_group', 'serp', 'public_ads', 'ai_visibility', 'reputation',
])
export type ExternalSourceType = z.infer<typeof externalSourceTypeSchema>
export const externalSourceTierSchema = z.enum(['A', 'B', 'C'])
export type ExternalSourceTier = z.infer<typeof externalSourceTierSchema>
export const externalObservationStatusSchema = z.enum(['observed', 'stale', 'unavailable', 'rejected'])
export type ExternalObservationStatus = z.infer<typeof externalObservationStatusSchema>
export const externalObservationSchema = z.object({
  client_id: z.string().guid(), source_type: externalSourceTypeSchema,
  source_tier: externalSourceTierSchema, source_name: z.string().trim().min(1).max(120),
  source_url: z.string().url().max(2048), canonical_url: z.string().url().max(2048),
  title: z.string().trim().max(500), excerpt: z.string().trim().max(5000),
  competitor_domain: z.string().trim().max(253).nullable(),
  published_at: z.string().datetime({ offset: true }).nullable(),
  observed_at: z.string().datetime({ offset: true }),
  valid_until: z.string().datetime({ offset: true }).nullable(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/), status: externalObservationStatusSchema,
}).strict()
export type ExternalObservation = z.infer<typeof externalObservationSchema>
export const externalEventSchema = z.object({
  client_id: z.string().guid(), event_type: z.string().trim().min(1).max(80),
  subject: z.string().trim().min(1).max(240), competitor_domain: z.string().trim().max(253).nullable(),
  market: z.string().trim().max(120).nullable(), related_product: z.string().trim().max(240).nullable(),
  observation_ids: z.array(z.string().uuid()).min(1).max(20),
  fact_status: z.enum(['fact', 'inference', 'unknown']), confidence: z.number().finite().min(0).max(1),
}).strict()
export type ExternalEvent = z.infer<typeof externalEventSchema>

export function sourceMayStandAlone(tier: ExternalSourceTier): boolean {
  return tier === 'A' || tier === 'B'
}

export interface Run {
  id: string; client_id: string; domain: string; url: string; period_key: string
  status: string; capture_claimed: boolean; interpretation_claimed: boolean
  provider_run_id: string | null; provider_dataset_id: string | null; provider_status: string | null
  capture_cost_usd: number | null; interpretation_cost_usd: number | null
  reserved_nzd: number; accounted_nzd: number | null; fx_rate: number
  capture_limit_usd: number; overhead_nzd: number; actor_build: string
  created_at: string; error_code: string | null
}
export interface Evidence { id: string; client_id: string; snapshot_id: string; source_url: string; excerpt: string; content_hash: string; observed_at: string }
export interface Signal {
  id: string; client_id: string; run_id: string; domain: string; kind: string
  before_evidence_id: string; after_evidence_id: string; interpretation_status: string
  classification: string | null; interpretation: Interpretation | null; recommended_action: string | null; created_at: string
}
export const interpretationSchema = z.object({
  classification: z.enum(['threat', 'opportunity', 'ignore']),
  summary: z.string().min(1).max(1200), confidence: z.number().finite().min(0).max(1),
  evidence_ids: z.array(z.string().uuid()).length(2), recommended_action: z.string().min(1).max(1000),
}).strict()
export type Interpretation = z.infer<typeof interpretationSchema>
export function periodKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit' }).formatToParts(now)
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`
}
/** Empty or absent rollout configuration cannot enable any client. */
export function allowedClient(clientId: string): boolean {
  return (process.env.WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(clientId)
}
