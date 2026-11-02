/**
 * Append-only social verification verdicts.
 *
 * Nothing in the publish path calls this. Writes stay off unless
 * SOCIAL_VERIFICATION_VERDICTS_ENABLED is exactly "true".
 * A unique conflict reuses writeReadbackOutcome and never updates the row.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SOCIAL_READBACK_SUBJECT_KINDS,
  type SocialReadbackSubjectKind,
  writeReadbackOutcome,
} from '@/lib/social/readback-outcome-record'
import {
  isSocialVerificationRecordType,
  type SocialVerificationRecordType,
} from '@/lib/social/verification-verdict-id'

export { socialVerificationRequestId } from '@/lib/social/verification-verdict-id'

export const SOCIAL_VERIFICATION_VERDICTS_ENV = 'SOCIAL_VERIFICATION_VERDICTS_ENABLED'
const TABLE = 'social_verification_verdicts'

export interface VerdictInsertInput {
  requestId: string
  clientId: string
  recordType: SocialVerificationRecordType
  contentActionId: string | null
  periodKey: string | null
  platform: 'facebook' | 'instagram'
  verdict: string
  readPoint: string
  windowHours: number | null
  boostStatus: 'not_boosted' | 'boosted' | 'boost_unknown' | null
  sampleSize: number | null
  observedValue: number | null
  evidenceReceiptIds: readonly string[]
  evidenceVerdictIds: readonly string[]
  cohortDefinition: Record<string, unknown> | null
  baselineValue: number | null
  notComparableReasons: readonly string[] | null
  reason: string | null
  logicVersion: string
  subjectKind: SocialReadbackSubjectKind
  subjectRef: string
}

export interface VerdictIdentity {
  clientId: string
  recordType: SocialVerificationRecordType
  subjectKey: string
  readPoint: string
  logicVersion: string
}

export interface SocialVerificationVerdictRecord {
  id: string
  request_id: string
  client_id: string
  record_type: string
  subject_key: string
  read_point: string
  logic_version: string
  verdict: string
  created_at: string
  evidence_receipt_ids: string[]
  evidence_verdict_ids: string[]
}

export type VerdictWriteResult =
  | { status: 'disabled' }
  | { status: 'inserted' }
  | { status: 'already_written' }
  | { status: 'conflict' }

interface StoredVerdict {
  verdict?: unknown
  evidence_receipt_ids?: unknown
  evidence_verdict_ids?: unknown
}

interface UniqueError {
  code?: string
  message?: string
}

/** Strict opt-in. Missing, `1`, `TRUE`, and `yes` all stay off. */
export function socialVerificationVerdictsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SOCIAL_VERIFICATION_VERDICTS_ENV] === 'true'
}

function requireBoostStatus(input: VerdictInsertInput): void {
  if (input.recordType === 'boost_check' && input.boostStatus == null) {
    throw new Error('insertSocialVerificationVerdict: boost_check requires boostStatus')
  }
}

function requireSubject(input: VerdictInsertInput): void {
  if (!input.clientId || !input.requestId || !input.subjectRef) {
    throw new Error('insertSocialVerificationVerdict: clientId, requestId, and subjectRef are required')
  }
  if (!(SOCIAL_READBACK_SUBJECT_KINDS as readonly string[]).includes(input.subjectKind)) {
    throw new Error('insertSocialVerificationVerdict: subjectKind is not a read-back subject')
  }
  if (!isSocialVerificationRecordType(input.recordType)) {
    throw new Error('insertSocialVerificationVerdict: recordType is not a verdict record type')
  }
}

function toVerdictInsert(input: VerdictInsertInput): Record<string, unknown> {
  return {
    request_id: input.requestId,
    client_id: input.clientId,
    record_type: input.recordType,
    content_action_id: input.contentActionId,
    period_key: input.periodKey,
    platform: input.platform,
    verdict: input.verdict,
    read_point: input.readPoint,
    window_hours: input.windowHours,
    boost_status: input.boostStatus,
    sample_size: input.sampleSize,
    observed_value: input.observedValue,
    evidence_receipt_ids: [...input.evidenceReceiptIds],
    evidence_verdict_ids: [...input.evidenceVerdictIds],
    cohort_definition: input.cohortDefinition,
    baseline_value: input.baselineValue,
    not_comparable_reasons: input.notComparableReasons ? [...input.notComparableReasons] : null,
    reason: input.reason,
    logic_version: input.logicVersion,
  }
}

function sameList(stored: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(stored) || stored.length !== expected.length) return false
  const left = stored.map((item) => String(item)).sort()
  const right = [...expected].map((item) => String(item)).sort()
  return left.every((item, index) => item === right[index])
}

function sameVerdict(stored: StoredVerdict, input: VerdictInsertInput): boolean {
  return stored.verdict === input.verdict
    && sameList(stored.evidence_receipt_ids, input.evidenceReceiptIds)
    && sameList(stored.evidence_verdict_ids, input.evidenceVerdictIds)
}

async function readByRequestId(supabase: SupabaseClient, requestId: string): Promise<StoredVerdict | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('verdict, evidence_receipt_ids, evidence_verdict_ids')
    .eq('request_id', requestId)
    .maybeSingle()
  if (error) throw new Error(`insertSocialVerificationVerdict: ${error.message}`)
  return data
}

async function reportConflict(supabase: SupabaseClient, input: VerdictInsertInput, stored: StoredVerdict | null): Promise<VerdictWriteResult> {
  await writeReadbackOutcome(supabase, {
    clientId: input.clientId,
    subjectKind: input.subjectKind,
    subjectRef: input.subjectRef,
    outcome: 'verdict_conflict',
    reason: stored ? 'request_replay_differs' : 'identity_occupied',
  })
  return { status: 'conflict' }
}

async function resolveUniqueViolation(
  supabase: SupabaseClient,
  input: VerdictInsertInput,
): Promise<VerdictWriteResult> {
  const stored = await readByRequestId(supabase, input.requestId)
  if (stored && sameVerdict(stored, input)) return { status: 'already_written' }
  return reportConflict(supabase, input, stored)
}

/** Insert one verdict. 23505 with the same verdict and evidence is a replay; a difference is conflict. */
export async function insertSocialVerificationVerdict(
  supabase: SupabaseClient,
  input: VerdictInsertInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VerdictWriteResult> {
  if (!socialVerificationVerdictsEnabled(env)) return { status: 'disabled' }
  requireSubject(input)
  requireBoostStatus(input)
  const row = toVerdictInsert(input)
  const { error } = await supabase.from(TABLE).insert(row)
  if (!error) return { status: 'inserted' }
  const unique = error as UniqueError
  if (unique.code !== '23505') {
    throw new Error(`insertSocialVerificationVerdict: ${unique.message ?? 'insert failed'}`)
  }
  return resolveUniqueViolation(supabase, input)
}

function firstRecord(data: unknown): SocialVerificationVerdictRecord | null {
  if (!Array.isArray(data) || data.length === 0) return null
  const row = data[0]
  if (!row || typeof row !== 'object') return null
  const record = row as SocialVerificationVerdictRecord
  if (typeof record.created_at !== 'string' || typeof record.id !== 'string') return null
  return record
}

/**
 * Earliest row for one judgement identity.
 * The unique index already allows only one row; ordering still prefers the earliest
 * if that index is later relaxed.
 */
export async function readEarliestSocialVerificationVerdict(
  supabase: SupabaseClient,
  key: VerdictIdentity,
): Promise<SocialVerificationVerdictRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('client_id', key.clientId)
    .eq('record_type', key.recordType)
    .eq('subject_key', key.subjectKey)
    .eq('read_point', key.readPoint)
    .eq('logic_version', key.logicVersion)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(`readEarliestSocialVerificationVerdict: ${error.message}`)
  return firstRecord(data)
}
