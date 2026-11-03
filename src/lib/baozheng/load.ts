/**
 * Server-side, read-only loaders for the baozheng weekly run.
 * Every function takes a SupabaseClient so callers control the connection.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { parseBaozhengConfig, type BaozhengClientConfig } from './config'
import type { StageEvent } from './outcome'
import type { ReviewStageOption } from './prompts'
import type { Ruling } from './accuracy'
import { RULING_SEGMENT_PREFIX, RULINGS, type StoredReview, type ReviewKind } from './types'

const ID_CHUNK = 100

interface StageRow {
  stage_key: string | null
  label: string | null
}

interface EventRow {
  id: string
  contact_id: string
  from_stage: string | null
  to_stage: string
  changed_by: string | null
  note: string | null
  created_at: string
}

interface TouchRow {
  id: string
  contact_id: string
  metadata: Record<string, unknown> | null
  occurred_at: string
  created_at: string
}

interface RewriteRow {
  occurred_at: string
  created_at: string
}

interface RulingRow {
  segment: string
  note: string | null
  created_at: string
}

interface RunLogRow {
  summary: unknown
  started_at: string
}

export interface SentMail {
  contactId: string
  subject: string
  occurredAt: string
  createdAt: string
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function loadClientConfig(
  db: SupabaseClient,
  clientId: string,
): Promise<BaozhengClientConfig> {
  const { data, error } = await db
    .from('clients')
    .select('leads_config')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw new Error('loadClientConfig failed: ' + error.message)
  const raw = isRecord(data) ? data.leads_config : null
  return parseBaozhengConfig(raw ?? null)
}

export async function loadStageOptions(
  db: SupabaseClient,
  clientId: string,
  config: BaozhengClientConfig,
): Promise<ReviewStageOption[]> {
  const { data, error } = await db
    .from('client_pipeline_stages')
    .select('stage_key, label')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true })
  if (error) throw new Error('loadStageOptions failed: ' + error.message)
  const rows = (data ?? []) as StageRow[]
  const out: ReviewStageOption[] = []
  for (const row of rows) {
    const key = row.stage_key
    if (typeof key !== 'string' || key.length === 0) continue
    if (!Object.prototype.hasOwnProperty.call(config.stageCategories, key)) continue
    const category = config.stageCategories[key]
    if (category === undefined) continue
    const label = typeof row.label === 'string' && row.label.length > 0 ? row.label : key
    out.push({ key, label, category })
  }
  return out
}

export async function loadStageEvents(
  db: SupabaseClient,
  clientId: string,
): Promise<StageEvent[]> {
  const rows = await fetchAll<EventRow>((from, to) =>
    db
      .from('contact_stage_events')
      .select('id, contact_id, from_stage, to_stage, changed_by, note, created_at')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(from, to),
  )
  return rows.map(r => ({
    id: r.id,
    contactId: r.contact_id,
    fromStage: r.from_stage,
    toStage: r.to_stage,
    changedBy: r.changed_by,
    note: r.note,
    createdAt: r.created_at,
  }))
}

export async function loadSentMails(
  db: SupabaseClient,
  clientId: string,
  contactIds: readonly string[],
): Promise<SentMail[]> {
  if (contactIds.length === 0) return []
  const out: SentMail[] = []
  for (const ids of chunk(contactIds, ID_CHUNK)) {
    const rows = await fetchAll<TouchRow>((from, to) =>
      db
        .from('contact_touchpoints')
        .select('id, contact_id, metadata, occurred_at, created_at')
        .eq('client_id', clientId)
        .in('contact_id', ids)
        .eq('direction', 'outbound')
        .eq('channel', 'email')
        .order('id', { ascending: true })
        .range(from, to),
    )
    for (const r of rows) {
      const meta = r.metadata
      if (!isRecord(meta)) continue
      const subject = meta.subject
      if (typeof subject !== 'string' || subject.trim().length === 0) continue
      out.push({
        contactId: r.contact_id,
        subject,
        occurredAt: r.occurred_at,
        createdAt: r.created_at,
      })
    }
  }
  return out
}

function extractSubject(note: string | null): string | null {
  if (typeof note !== 'string') return null
  const open = note.indexOf('「')
  if (open < 0) return null
  const close = note.indexOf('」', open + 1)
  if (close < 0) return null
  return note.slice(open + 1, close)
}

export function resolveMailIngestedAt(
  e: StageEvent,
  mails: readonly SentMail[],
): string | null {
  const subject = extractSubject(e.note)
  if (subject === null) return null
  const wanted = subject.trim()
  if (wanted.length === 0) return null
  const eventMs = Date.parse(e.createdAt)
  if (Number.isNaN(eventMs)) return null

  let best: SentMail | null = null
  let bestMs = Number.NEGATIVE_INFINITY
  for (const m of mails) {
    if (m.contactId !== e.contactId) continue
    if (!m.subject.trim().startsWith(wanted)) continue
    const occurredMs = Date.parse(m.occurredAt)
    if (Number.isNaN(occurredMs) || occurredMs > eventMs) continue
    if (occurredMs > bestMs) {
      bestMs = occurredMs
      best = m
    }
  }
  return best ? best.createdAt : null
}

export async function hasRewrittenTouchpoints(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
  beforeIso: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('contact_touchpoints')
    .select('occurred_at, created_at')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .neq('channel', 'messenger')
    .lte('created_at', beforeIso)
    .limit(500)
  if (error) throw new Error('hasRewrittenTouchpoints failed: ' + error.message)
  const rows = (data ?? []) as RewriteRow[]
  for (const r of rows) {
    const occurredMs = Date.parse(r.occurred_at)
    const createdMs = Date.parse(r.created_at)
    if (Number.isNaN(occurredMs) || Number.isNaN(createdMs)) continue
    if (occurredMs > createdMs + 60_000) return true
  }
  return false
}

export async function loadRulings(
  db: SupabaseClient,
  clientId: string,
): Promise<Map<string, Ruling>> {
  const { data, error } = await db
    .from('crm_segment_feedback')
    .select('segment, note, created_at')
    .eq('client_id', clientId)
    .like('segment', `${RULING_SEGMENT_PREFIX}%`)
    .order('created_at', { ascending: true })
    .limit(5000)
  if (error) throw new Error('loadRulings failed: ' + error.message)
  const rows = (data ?? []) as RulingRow[]
  const out = new Map<string, Ruling>()
  for (const r of rows) {
    const note = r.note
    if (typeof note !== 'string') continue
    const ruling = RULINGS.find(x => x === note)
    if (!ruling) continue
    out.set(r.segment.slice(RULING_SEGMENT_PREFIX.length), ruling)
  }
  return out
}

const REVIEW_KINDS: readonly ReviewKind[] = ['sample', 'disagreement', 'pool']
const REVIEW_RESULTS: readonly StoredReview['result'][] = [
  'agree',
  'disagree',
  'review_unclear',
  'not_reviewed',
]

function isReviewKind(v: unknown): v is ReviewKind {
  return typeof v === 'string' && (REVIEW_KINDS as readonly string[]).includes(v)
}

function isReviewResult(v: unknown): v is StoredReview['result'] {
  return typeof v === 'string' && (REVIEW_RESULTS as readonly string[]).includes(v)
}

export function isStoredReview(v: unknown): v is StoredReview {
  if (!isRecord(v)) return false
  if (typeof v.judgment_id !== 'string') return false
  if (typeof v.contact_id !== 'string') return false
  if (typeof v.ai_stage !== 'string') return false
  if (typeof v.judged_at !== 'string') return false
  if (typeof v.reviewed_at !== 'string') return false
  if (!isReviewKind(v.kind)) return false
  if (!(typeof v.review_stage === 'string' || v.review_stage === null)) return false
  if (!isReviewResult(v.result)) return false
  if (!(typeof v.reason === 'string' || v.reason === null)) return false
  return true
}

/** The `reviews` array of one client inside a run summary, still unvalidated. */
function pickClientReviews(summary: unknown, clientId: string): unknown[] {
  if (!isRecord(summary)) return []
  const clients = summary.clients
  if (!Array.isArray(clients)) return []
  for (const entry of clients) {
    if (!isRecord(entry) || entry.client_id !== clientId) continue
    return Array.isArray(entry.reviews) ? entry.reviews : []
  }
  return []
}

export async function loadPastReviews(
  db: SupabaseClient,
  jobName: string,
  clientId: string,
  sinceIso: string,
): Promise<StoredReview[]> {
  const { data, error } = await db
    .from('cron_run_logs')
    .select('summary, started_at')
    .eq('job_name', jobName)
    // 'partial' = one client failed; the other clients' reviews in that run are still real
    .in('status', ['completed', 'partial'])
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: true })
    .limit(100)
  if (error) throw new Error('loadPastReviews failed: ' + error.message)
  const rows = (data ?? []) as RunLogRow[]
  const out: StoredReview[] = []
  for (const row of rows) {
    for (const r of pickClientReviews(row.summary, clientId)) {
      if (isStoredReview(r)) out.push(r)
    }
  }
  return out
}
