/**
 * Whitelist for an unapproved ads-agent draft.
 * Approval fields are rejected outright. They are not stripped and saved.
 */

import { parsePromoSpec, type PromoSpec } from '@/lib/marketing-plan/promo/spec'

const ALLOWED = new Set([
  'prescription_id',
  'plan_id',
  'title',
  'start_date',
  'end_date',
  'expected_updated_at',
  'promo',
])
const PROMO_KEYS = new Set(['schema', 'goal_id', 'phases', 'sales_handover'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TITLE = 120

export interface AgentDraftRequest {
  prescriptionId: string
  planId: string | null
  title: string | undefined
  startDate: string | null | undefined
  endDate: string | null | undefined
  expectedUpdatedAt: string | null
  spec: PromoSpec
}

export interface DraftParseFailure {
  ok: false
  status: 400
  code: string
  error: string
}

export function parseAgentDraftBody(body: unknown): { ok: true; request: AgentDraftRequest } | DraftParseFailure {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid_body', '请求体不正确')
  const record = body as Record<string, unknown>
  const unknownKey = Object.keys(record).find(key => !ALLOWED.has(key))
  if (unknownKey) return fail('forbidden_field', '只能保存未批准的草稿字段')
  const prescriptionId = readUuid(record.prescription_id)
  if (!prescriptionId) return fail('invalid_prescription', '处方编号不正确')
  const planId = readOptionalUuid(record, 'plan_id')
  if (planId === 'bad') return fail('invalid_plan', '计划编号不正确')
  const title = readTitle(record)
  if (title === 'bad') return fail('invalid_title', '标题不正确')
  const startDate = readDate(record, 'start_date')
  if (startDate === 'bad') return fail('invalid_dates', '开始日不正确')
  const endDate = readDate(record, 'end_date')
  if (endDate === 'bad') return fail('invalid_dates', '结束日不正确')
  if (typeof startDate === 'string' && typeof endDate === 'string' && endDate < startDate) {
    return fail('invalid_dates', '结束日早于开始日')
  }
  const expected = readExpected(record, planId)
  if (expected === 'bad') return fail('missing_version', '更新草稿要带上读到的版本时间')
  const spec = readPromo(record.promo)
  if (!spec.ok) return spec
  return {
    ok: true,
    request: {
      prescriptionId,
      planId,
      title,
      startDate,
      endDate,
      expectedUpdatedAt: expected,
      spec: spec.spec,
    },
  }
}

export function prescriptionResourceId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = (body as { prescription_id?: unknown }).prescription_id
  return typeof value === 'string' ? value : null
}

function readPromo(raw: unknown): { ok: true; spec: PromoSpec } | DraftParseFailure {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid_promo', '推广结构不正确')
  const record = raw as Record<string, unknown>
  if ('gate_snapshot' in record || 'checks' in record) return fail('forbidden_field', '不能写入批准或核实记录')
  const extra = Object.keys(record).find(key => !PROMO_KEYS.has(key))
  if (extra) return fail('forbidden_field', '只能保存未批准的草稿字段')
  const parsed = parsePromoSpec(raw)
  if (!parsed.ok) return fail('invalid_promo', '推广结构不正确')
  return { ok: true, spec: { ...parsed.spec, checks: [], gate_snapshot: undefined } }
}

function readUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null
}

function readOptionalUuid(record: Record<string, unknown>, key: string): string | null | 'bad' {
  if (!(key in record) || record[key] === null) return null
  const value = readUuid(record[key])
  return value ?? 'bad'
}

function readTitle(record: Record<string, unknown>): string | undefined | 'bad' {
  if (!('title' in record)) return undefined
  if (typeof record.title !== 'string') return 'bad'
  const title = record.title.replace(/\p{C}/gu, '').trim()
  if (title.length === 0 || title.length > MAX_TITLE) return 'bad'
  return title
}

function readDate(record: Record<string, unknown>, key: string): string | null | undefined | 'bad' {
  if (!(key in record)) return undefined
  if (record[key] === null) return null
  if (typeof record[key] !== 'string' || !DATE_RE.test(record[key])) return 'bad'
  return record[key]
}

function readExpected(record: Record<string, unknown>, planId: string | null): string | null | 'bad' {
  if (!planId) return null
  const value = record.expected_updated_at
  if (typeof value !== 'string' || value.trim() === '') return 'bad'
  return value
}

function fail(code: string, error: string): DraftParseFailure {
  return { ok: false, status: 400, code, error }
}
