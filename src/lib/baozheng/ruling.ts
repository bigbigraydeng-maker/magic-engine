/**
 * Server-side helpers for the internal ruling page: load one AI judgment with its
 * transcript, and record a human ruling. The db client is always passed in.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { STAGE_INFER_ACTOR } from '@/lib/crm/actors'
import type { TranscriptLine } from '@/lib/crm/stage-from-conversation'
import type { Ruling } from './accuracy'
import { loadPastReviews, loadRulings } from './load'
import { BAOZHENG_JOB, RULINGS, RULING_SEGMENT_PREFIX, type StoredReview } from './types'

export const RULING_LOOKBACK_DAYS = 70
const MS_PER_DAY = 86_400_000
const LINE_MAX = 1200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface RulingLine {
  at: string
  who: 'customer' | 'us'
  channel: string
  body: string
}

export interface RulingView {
  judgmentId: string
  contactId: string
  judgedAt: string
  aiStage: string
  aiStageLabel: string
  /** the AI's own note (reason + quote), shown on this internal page only */
  aiNote: string | null
  review: StoredReview | null
  reviewStageLabel: string | null
  lines: RulingLine[]
  ruling: Ruling | null
}

export function isRuling(v: unknown): v is Ruling {
  return typeof v === 'string' && (RULINGS as readonly string[]).includes(v)
}

export type TranscriptLoader = (
  clientId: string,
  contactId: string,
  ingestedBefore: string,
) => Promise<TranscriptLine[]>

interface JudgmentRow {
  id: string
  contact_id: string
  to_stage: string
  changed_by: string | null
  note: string | null
  created_at: string
}

interface StageLabelRow {
  stage_key: string | null
  label: string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

async function loadJudgmentEvent(
  db: SupabaseClient,
  clientId: string,
  judgmentId: string,
): Promise<JudgmentRow | null> {
  // A malformed id would make Postgres throw (uuid column) and surface as a 500; it is simply "not found".
  if (!UUID_RE.test(judgmentId)) return null
  const { data, error } = await db
    .from('contact_stage_events')
    .select('id, contact_id, to_stage, changed_by, note, created_at')
    .eq('id', judgmentId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error('load judgment failed: ' + error.message)
  if (!isRecord(data)) return null
  if (data.changed_by !== STAGE_INFER_ACTOR) return null
  if (typeof data.id !== 'string') return null
  if (typeof data.contact_id !== 'string') return null
  if (typeof data.to_stage !== 'string') return null
  if (typeof data.created_at !== 'string') return null
  const note = typeof data.note === 'string' ? data.note : null
  return {
    id: data.id,
    contact_id: data.contact_id,
    to_stage: data.to_stage,
    changed_by: STAGE_INFER_ACTOR,
    note,
    created_at: data.created_at,
  }
}

async function loadStageLabels(
  db: SupabaseClient,
  clientId: string,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('client_pipeline_stages')
    .select('stage_key, label')
    .eq('client_id', clientId)
  if (error) throw new Error('load stage labels failed: ' + error.message)
  const rows = (data ?? []) as StageLabelRow[]
  const out = new Map<string, string>()
  for (const row of rows) {
    const key = row.stage_key
    if (typeof key !== 'string' || key.length === 0) continue
    const label = typeof row.label === 'string' && row.label.length > 0 ? row.label : key
    out.set(key, label)
  }
  return out
}

function pickReview(reviews: readonly StoredReview[], judgmentId: string): StoredReview | null {
  let found: StoredReview | null = null
  for (const r of reviews) {
    if (r.judgment_id === judgmentId) found = r
  }
  return found
}

function toRulingLine(line: TranscriptLine): RulingLine {
  const body = Array.from(line.body.trim()).slice(0, LINE_MAX).join('')
  return {
    at: line.at,
    who: line.direction === 'inbound' ? 'customer' : 'us',
    channel: line.channel,
    body,
  }
}

function sortLines(lines: readonly TranscriptLine[]): TranscriptLine[] {
  return [...lines].sort((a, b) => {
    const am = Date.parse(a.at)
    const bm = Date.parse(b.at)
    if (Number.isNaN(am) && Number.isNaN(bm)) return 0
    if (Number.isNaN(am)) return 1
    if (Number.isNaN(bm)) return -1
    return am - bm
  })
}

export async function loadRulingView(
  db: SupabaseClient,
  clientId: string,
  judgmentId: string,
  loadTranscript: TranscriptLoader,
  nowMs: number,
): Promise<RulingView | null> {
  const row = await loadJudgmentEvent(db, clientId, judgmentId)
  if (row === null) return null

  const sinceIso = new Date(nowMs - RULING_LOOKBACK_DAYS * MS_PER_DAY).toISOString()
  const reviews = await loadPastReviews(db, BAOZHENG_JOB, clientId, sinceIso)
  const review = pickReview(reviews, judgmentId)

  const labels = await loadStageLabels(db, clientId)

  const raw = await loadTranscript(clientId, row.contact_id, row.created_at)
  const lines = sortLines(raw).map(toRulingLine)

  const ruling = (await loadRulings(db, clientId)).get(judgmentId) ?? null

  const aiStageLabel = labels.get(row.to_stage) ?? row.to_stage
  const reviewStageLabel =
    review !== null && review.review_stage !== null
      ? labels.get(review.review_stage) ?? review.review_stage
      : null

  return {
    judgmentId: row.id,
    contactId: row.contact_id,
    judgedAt: row.created_at,
    aiStage: row.to_stage,
    aiStageLabel,
    aiNote: row.note,
    review,
    reviewStageLabel,
    lines,
    ruling,
  }
}

/**
 * Records the human ruling only. Never touches contacts or contact_stage_events —
 * the ruling must not look like a human follow-up.
 */
export async function saveRuling(
  db: SupabaseClient,
  clientId: string,
  judgmentId: string,
  ruling: Ruling,
  reportedBy: string | null,
): Promise<'saved' | 'not_found'> {
  const row = await loadJudgmentEvent(db, clientId, judgmentId)
  if (row === null) return 'not_found'

  const { error } = await db.from('crm_segment_feedback').insert({
    client_id: clientId,
    contact_id: row.contact_id,
    segment: RULING_SEGMENT_PREFIX + judgmentId,
    reason: 'baozheng ruling',
    note: ruling,
    reported_by: reportedBy,
  })
  if (error) throw new Error('save ruling failed: ' + error.message)
  return 'saved'
}
