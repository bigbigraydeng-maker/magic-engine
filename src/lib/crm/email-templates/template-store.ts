import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FACT_SOURCES,
  type AppendResult,
  type EmailTemplateVersion,
  type FactSource,
  type NewTemplateVersionInput,
  type PickFilter,
  type PickMode,
  type TemplateStatus,
} from './types'

export const TEMPLATE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/

const TABLE = 'crm_email_templates'
const UNREADABLE = 'crm_email_templates: unreadable row'
const PICK_MODES: readonly PickMode[] = ['none', 'one', 'many']
const STATUSES: readonly TemplateStatus[] = ['active', 'disabled']

const CONFLICT_EXISTS = '这个模板键已经存在，请直接编辑它'
const CONFLICT_STALE = '模板刚被别人改过，请刷新后再改'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}

function isFactSource(value: unknown): value is FactSource {
  return typeof value === 'string' && (FACT_SOURCES as readonly string[]).includes(value)
}

function isPickMode(value: unknown): value is PickMode {
  return typeof value === 'string' && (PICK_MODES as readonly string[]).includes(value)
}

function isStatus(value: unknown): value is TemplateStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

function mapPickFilter(value: unknown): PickFilter | null {
  if (value === null || value === undefined) return {}
  if (!isRecord(value)) return null
  const filter: PickFilter = {}
  if (value.destinations !== undefined) {
    if (!isStringArray(value.destinations)) return null
    filter.destinations = value.destinations
  }
  if (value.tiers !== undefined) {
    if (!isStringArray(value.tiers)) return null
    filter.tiers = value.tiers
  }
  if (value.departure_months !== undefined) {
    if (!isNumberArray(value.departure_months)) return null
    filter.departureMonths = value.departure_months
  }
  return filter
}

export function mapTemplateRow(row: unknown): EmailTemplateVersion | null {
  if (!isRecord(row)) return null
  const pickFilter = mapPickFilter(row.pick_filter)
  if (pickFilter === null) return null
  if (
    !isNonEmptyString(row.id) ||
    !isNonEmptyString(row.client_id) ||
    !isNonEmptyString(row.template_key) ||
    typeof row.version !== 'number' ||
    !Number.isInteger(row.version) ||
    typeof row.name !== 'string' ||
    typeof row.subject !== 'string' ||
    typeof row.body !== 'string' ||
    !isFactSource(row.fact_source) ||
    !isPickMode(row.pick_mode) ||
    !isStatus(row.status) ||
    !isNonEmptyString(row.created_by) ||
    !isNonEmptyString(row.created_at)
  ) {
    return null
  }
  if (row.change_note !== null && typeof row.change_note !== 'string') return null
  return {
    id: row.id,
    clientId: row.client_id,
    templateKey: row.template_key,
    version: row.version,
    name: row.name,
    subject: row.subject,
    body: row.body,
    factSource: row.fact_source,
    pickMode: row.pick_mode,
    pickFilter,
    status: row.status,
    changeNote: row.change_note ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

function mapRowsOrThrow(rows: unknown): EmailTemplateVersion[] {
  if (!Array.isArray(rows)) throw new Error(UNREADABLE)
  const mapped: EmailTemplateVersion[] = []
  for (const row of rows) {
    const version = mapTemplateRow(row)
    if (version === null) throw new Error(UNREADABLE)
    mapped.push(version)
  }
  return mapped
}

function mapRowOrThrow(row: unknown): EmailTemplateVersion {
  const mapped = mapTemplateRow(row)
  if (mapped === null) throw new Error(UNREADABLE)
  return mapped
}

function queryError(what: string, message: string): Error {
  return new Error(`crm_email_templates: ${what}: ${message}`)
}

function validateKey(key: string): string | null {
  if (!TEMPLATE_KEY_RE.test(key)) return '模板键格式不正确（小写字母、数字、连字符，2-63 位）'
  return null
}

function validateText(value: string, min: number, max: number, label: string): string | null {
  // min is checked on the trimmed text; max on the raw text, because the raw text is what the database stores
  if (value.trim().length < min || value.length > max) return `${label}长度需在 ${min}-${max} 之间`
  return null
}

function validateChangeNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null
  if (note.length > 300) return '变更说明不能超过 300 个字符'
  return null
}

function validateCreatedBy(createdBy: string): string | null {
  if (createdBy.length < 3 || createdBy.length > 254 || !createdBy.includes('@')) {
    return '创建人邮箱格式不正确'
  }
  return null
}

function validateConsistency(factSource: FactSource, pickMode: PickMode): string | null {
  if (factSource === 'none' && pickMode !== 'none') return '未启用事实来源时不能选择挑选模式'
  if (pickMode === 'none' && factSource !== 'none') return '启用事实来源时必须选择挑选模式'
  return null
}

function validateStringList(list: unknown, maxEntries: number, maxLen: number, label: string): string | null {
  if (list === undefined) return null
  if (!Array.isArray(list)) return `${label}格式不正确`
  if (list.length > maxEntries) return `${label}最多 ${maxEntries} 项`
  for (const item of list) {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxLen) {
      return `${label}包含无效项`
    }
  }
  return null
}

function validateMonths(months: unknown): string | null {
  if (months === undefined) return null
  if (!Array.isArray(months)) return '出发月份格式不正确'
  if (months.length > 12) return '出发月份最多 12 项'
  const seen = new Set<number>()
  for (const item of months) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > 12) {
      return '出发月份需为 1-12 的整数'
    }
    if (seen.has(item)) return '出发月份不能重复'
    seen.add(item)
  }
  return null
}

function validatePickFilter(filter: PickFilter): string | null {
  return (
    validateStringList(filter.destinations, 20, 60, '目的地') ??
    validateStringList(filter.tiers, 20, 60, '档位') ??
    validateMonths(filter.departureMonths)
  )
}

export function validateNewTemplateInput(input: NewTemplateVersionInput): string | null {
  // runtime guard: callers parse JSON, so do not trust the static types
  const texts: unknown[] = [input.clientId, input.templateKey, input.name, input.subject, input.body, input.createdBy]
  if (!texts.every((t) => typeof t === 'string')) return '模板字段类型不正确'
  if (!isNonEmptyString(input.clientId)) return '客户 ID 不能为空'
  const keyError = validateKey(input.templateKey)
  if (keyError !== null) return keyError
  const nameError = validateText(input.name, 1, 120, '模板名称')
  if (nameError !== null) return nameError
  const subjectError = validateText(input.subject, 1, 400, '邮件主题')
  if (subjectError !== null) return subjectError
  const bodyError = validateText(input.body, 1, 10000, '邮件正文')
  if (bodyError !== null) return bodyError
  const noteError = validateChangeNote(input.changeNote)
  if (noteError !== null) return noteError
  const createdByError = validateCreatedBy(input.createdBy)
  if (createdByError !== null) return createdByError
  if (!isFactSource(input.factSource)) return '事实来源无效'
  if (!isPickMode(input.pickMode)) return '挑选模式无效'
  if (!isStatus(input.status)) return '模板状态无效'
  const consistencyError = validateConsistency(input.factSource, input.pickMode)
  if (consistencyError !== null) return consistencyError
  const filterError = validatePickFilter(input.pickFilter)
  if (filterError !== null) return filterError
  if (input.baseVersion !== null) {
    if (typeof input.baseVersion !== 'number' || !Number.isInteger(input.baseVersion) || input.baseVersion < 1) {
      return '基础版本号无效'
    }
  }
  return null
}

export async function listCurrentTemplates(
  db: SupabaseClient,
  clientId: string,
): Promise<EmailTemplateVersion[]> {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .order('version', { ascending: false })
  if (error) throw queryError('list current templates', error.message)
  const rows = mapRowsOrThrow(data)
  const latest = new Map<string, EmailTemplateVersion>()
  for (const row of rows) {
    if (!latest.has(row.templateKey)) latest.set(row.templateKey, row)
  }
  return Array.from(latest.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCurrentTemplate(
  db: SupabaseClient,
  clientId: string,
  key: string,
): Promise<EmailTemplateVersion | null> {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .eq('template_key', key)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw queryError('get current template', error.message)
  const rows = mapRowsOrThrow(data)
  return rows.length > 0 ? rows[0] : null
}

export async function getTemplateVersion(
  db: SupabaseClient,
  clientId: string,
  key: string,
  version: number,
): Promise<EmailTemplateVersion | null> {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .eq('template_key', key)
    .eq('version', version)
    .maybeSingle()
  if (error) throw queryError('get template version', error.message)
  if (data === null || data === undefined) return null
  return mapRowOrThrow(data)
}

export async function listTemplateHistory(
  db: SupabaseClient,
  clientId: string,
  key: string,
): Promise<EmailTemplateVersion[]> {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .eq('template_key', key)
    .order('version', { ascending: false })
  if (error) throw queryError('list template history', error.message)
  return mapRowsOrThrow(data)
}

function toPickFilterJson(filter: PickFilter): Record<string, unknown> {
  const json: Record<string, unknown> = {}
  if (filter.destinations !== undefined) json.destinations = filter.destinations
  if (filter.tiers !== undefined) json.tiers = filter.tiers
  if (filter.departureMonths !== undefined) json.departure_months = filter.departureMonths
  return json
}

function buildInsertRow(input: NewTemplateVersionInput, version: number): Record<string, unknown> {
  return {
    client_id: input.clientId,
    template_key: input.templateKey,
    version,
    name: input.name.trim(),
    subject: input.subject,
    body: input.body,
    fact_source: input.factSource,
    pick_mode: input.pickMode,
    pick_filter: toPickFilterJson(input.pickFilter),
    status: input.status,
    change_note: input.changeNote ?? null,
    created_by: input.createdBy,
  }
}

function resolveNextVersion(
  input: NewTemplateVersionInput,
  current: EmailTemplateVersion | null,
): AppendResult<number> {
  if (input.baseVersion === null) {
    if (current !== null) return { ok: false, reason: 'conflict', message: CONFLICT_EXISTS }
    return { ok: true, value: 1 }
  }
  if (current === null || current.version !== input.baseVersion) {
    return { ok: false, reason: 'conflict', message: CONFLICT_STALE }
  }
  return { ok: true, value: input.baseVersion + 1 }
}

export async function appendTemplateVersion(
  db: SupabaseClient,
  input: NewTemplateVersionInput,
): Promise<AppendResult<EmailTemplateVersion>> {
  const invalid = validateNewTemplateInput(input)
  if (invalid !== null) return { ok: false, reason: 'invalid', message: invalid }

  let current: EmailTemplateVersion | null
  try {
    current = await getCurrentTemplate(db, input.clientId, input.templateKey)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: 'error', message }
  }

  const next = resolveNextVersion(input, current)
  if (!next.ok) return next

  const row = buildInsertRow(input, next.value)
  const { data, error } = await db.from(TABLE).insert(row).select('*').single()
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'conflict', message: CONFLICT_STALE }
    return { ok: false, reason: 'error', message: error.message }
  }
  try {
    return { ok: true, value: mapRowOrThrow(data) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: 'error', message }
  }
}

export type SendableCheck =
  | { ok: true }
  | { ok: false; reason: 'template_unavailable' | 'template_outdated' }

export function checkTemplateSendable(
  current: EmailTemplateVersion | null,
  requestedVersion: number,
): SendableCheck {
  if (current === null) return { ok: false, reason: 'template_unavailable' }
  if (current.status !== 'active') return { ok: false, reason: 'template_unavailable' }
  if (requestedVersion !== current.version) return { ok: false, reason: 'template_outdated' }
  return { ok: true }
}
