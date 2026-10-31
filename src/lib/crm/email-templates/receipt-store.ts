import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CallBasis,
  ReceiptOutcome,
  SendReceipt,
  StoredReceipt,
} from './types'

const TABLE = 'crm_email_send_receipts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_RE = /^[0-9a-f]{64}$/
const TEMPLATE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/

const OUTCOMES: readonly ReceiptOutcome[] = ['sent', 'blocked', 'failed', 'unknown']
const CALL_BASES: readonly CallBasis[] = ['none', 'system_call', 'staff_attested']

export type InsertReceiptResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; message: string }

export interface ReceiptSummaryRow {
  templateKey: string | null
  sent: number
  blocked: number
  failed: number
  unknown: number
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isSha256OrNull(value: string | null): boolean {
  return value === null || SHA256_RE.test(value)
}

function isIntegerOrNull(value: number | null, min: number): boolean {
  return value === null || (Number.isInteger(value) && value >= min)
}

function validateWarnings(warnings: string[]): string | null {
  if (warnings.length > 20) return '警告数量不能超过 20 条'
  for (const w of warnings) {
    if (typeof w !== 'string' || w.length > 60) return '单条警告不能超过 60 个字符'
  }
  return null
}

export function validateReceipt(receipt: SendReceipt): string | null {
  if (!isNonEmptyString(receipt.clientId)) return '客户 ID 不能为空'
  if (!isUuid(receipt.contactId)) return '联系人 ID 格式无效'
  if (!isUuid(receipt.requestId)) return '请求 ID 格式无效'
  if (
    typeof receipt.actorEmail !== 'string' ||
    receipt.actorEmail.length < 3 ||
    receipt.actorEmail.length > 254 ||
    !receipt.actorEmail.includes('@')
  ) {
    return '操作人邮箱格式无效'
  }
  if (!OUTCOMES.includes(receipt.outcome)) return '发送结果无效'
  if (receipt.outcome === 'blocked') {
    if (!isNonEmptyString(receipt.blockReason)) return '拦截结果必须填写原因'
    if (receipt.blockReason.length > 60) return '拦截原因不能超过 60 个字符'
  } else if (receipt.outcome === 'sent') {
    if (receipt.blockReason !== null) return '已发出的结果不能填写拦截原因'
  } else if (receipt.blockReason !== null && receipt.blockReason.length > 60) {
    // failed / unknown may carry a short reason code such as internal_error
    return '原因代码不能超过 60 个字符'
  }
  if (receipt.blockDetail !== null && receipt.blockDetail.length > 300) {
    return '拦截详情不能超过 300 个字符'
  }
  if (!isSha256OrNull(receipt.renderedSha256)) return '渲染哈希格式无效'
  if (!isSha256OrNull(receipt.finalSha256)) return '最终哈希格式无效'
  if (!isIntegerOrNull(receipt.templateVersion, 1)) return '模板版本号无效'
  if (!isIntegerOrNull(receipt.catalogVersion, 0)) return '目录版本号无效'
  if (receipt.templateKey !== null && !TEMPLATE_KEY_RE.test(receipt.templateKey)) {
    return '模板标识格式无效'
  }
  if (!Array.isArray(receipt.warnings)) return '警告列表格式无效'
  const warningsError = validateWarnings(receipt.warnings)
  if (warningsError !== null) return warningsError
  if (!CALL_BASES.includes(receipt.callBasis)) return '调用依据无效'
  return null
}

function toInsertRow(receipt: SendReceipt): Record<string, unknown> {
  return {
    client_id: receipt.clientId,
    contact_id: receipt.contactId,
    request_id: receipt.requestId,
    actor_email: receipt.actorEmail,
    template_key: receipt.templateKey,
    template_version: receipt.templateVersion,
    catalog_version: receipt.catalogVersion,
    call_basis: receipt.callBasis,
    outcome: receipt.outcome,
    block_reason: receipt.blockReason,
    block_detail: receipt.blockDetail,
    mailbox: receipt.mailbox,
    conversation_id: receipt.conversationId,
    provider_message_id: receipt.providerMessageId,
    edited_after_render: receipt.editedAfterRender,
    warnings: receipt.warnings,
    rendered_sha256: receipt.renderedSha256,
    final_sha256: receipt.finalSha256,
  }
}

export async function insertReceipt(
  db: SupabaseClient,
  receipt: SendReceipt,
): Promise<InsertReceiptResult> {
  const invalid = validateReceipt(receipt)
  if (invalid !== null) return { ok: false, message: invalid }
  const { error } = await db.from(TABLE).insert(toInsertRow(receipt))
  if (error !== null) {
    if (error.code === '23505') return { ok: true, duplicate: true }
    return { ok: false, message: `写入发送回执失败：${error.message}` }
  }
  return { ok: true, duplicate: false }
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function readNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${TABLE}: unreadable row`)
  return value
}

function readNullableNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'number') throw new Error(`${TABLE}: unreadable row`)
  return value
}

function readNullableBoolean(row: Record<string, unknown>, key: string): boolean | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'boolean') throw new Error(`${TABLE}: unreadable row`)
  return value
}

function readWarnings(row: Record<string, unknown>): string[] {
  const value = row.warnings
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${TABLE}: unreadable row`)
  return value.filter((w): w is string => typeof w === 'string')
}

export function mapReceiptRow(row: unknown): StoredReceipt | null {
  if (row === null || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = readString(r, 'id')
  const clientId = readString(r, 'client_id')
  const contactId = readString(r, 'contact_id')
  const requestId = readString(r, 'request_id')
  const actorEmail = readString(r, 'actor_email')
  const outcome = readString(r, 'outcome')
  const callBasis = readString(r, 'call_basis')
  const authBasis = readString(r, 'auth_basis')
  const createdAt = readString(r, 'created_at')
  if (
    id === null ||
    clientId === null ||
    contactId === null ||
    requestId === null ||
    actorEmail === null ||
    outcome === null ||
    callBasis === null ||
    authBasis === null ||
    createdAt === null
  ) {
    return null
  }
  if (!OUTCOMES.includes(outcome as ReceiptOutcome)) return null
  if (!CALL_BASES.includes(callBasis as CallBasis)) return null
  if (authBasis !== 'human_click') return null
  return {
    id,
    clientId,
    contactId,
    requestId,
    actorEmail,
    templateKey: readNullableString(r, 'template_key'),
    templateVersion: readNullableNumber(r, 'template_version'),
    catalogVersion: readNullableNumber(r, 'catalog_version'),
    callBasis: callBasis as CallBasis,
    outcome: outcome as ReceiptOutcome,
    blockReason: readNullableString(r, 'block_reason'),
    blockDetail: readNullableString(r, 'block_detail'),
    mailbox: readNullableString(r, 'mailbox'),
    conversationId: readNullableString(r, 'conversation_id'),
    providerMessageId: readNullableString(r, 'provider_message_id'),
    editedAfterRender: readNullableBoolean(r, 'edited_after_render'),
    warnings: readWarnings(r),
    renderedSha256: readNullableString(r, 'rendered_sha256'),
    finalSha256: readNullableString(r, 'final_sha256'),
    authBasis: 'human_click',
    createdAt,
  }
}

function mapRowsOrThrow(rows: unknown[]): StoredReceipt[] {
  const mapped: StoredReceipt[] = []
  for (const row of rows) {
    const receipt = mapReceiptRow(row)
    if (receipt === null) throw new Error(`${TABLE}: unreadable row`)
    mapped.push(receipt)
  }
  return mapped
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 50
  if (!Number.isFinite(limit)) return 50
  const n = Math.floor(limit)
  if (n < 1) return 1
  if (n > 200) return 200
  return n
}

export async function listRecentReceipts(
  db: SupabaseClient,
  clientId: string,
  limit?: number,
): Promise<StoredReceipt[]> {
  const n = clampLimit(limit)
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(n)
  if (error !== null) throw new Error(`${TABLE}: list recent: ${error.message}`)
  return mapRowsOrThrow(Array.isArray(data) ? data : [])
}

/** The stored receipt of one request with a given outcome (settling an `unknown` send starts from it). */
export async function findReceiptByRequest(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
  requestId: string,
  outcome: ReceiptOutcome,
): Promise<StoredReceipt | null> {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .eq('request_id', requestId)
    .eq('outcome', outcome)
    .limit(1)
  if (error !== null) throw new Error(`${TABLE}: find by request: ${error.message}`)
  const rows = mapRowsOrThrow(Array.isArray(data) ? data : [])
  return rows[0] ?? null
}

/**
 * The template receipts that mean "he may already have this mail": `sent`, and `unknown` (it may well have gone out; the
 * follow-up gate counts it as sent until it is settled).
 *
 * The table is append-only: settling an `unknown` send adds a row and leaves the old one. A request whose `unknown` was
 * later settled as `failed` never went out and must not count, or the guest stays blocked by a mail that does not exist.
 * The `failed` rows are read only to apply that and are not returned.
 */
export async function findSentTemplateReceiptsSince(
  db: SupabaseClient,
  clientId: string,
  contactId: string,
  sinceIso: string,
): Promise<StoredReceipt[]> {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .in('outcome', ['sent', 'unknown', 'failed'])
    .not('template_key', 'is', null)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
  if (error !== null) throw new Error(`${TABLE}: find sent since: ${error.message}`)
  const rows = mapRowsOrThrow(Array.isArray(data) ? data : [])

  const failedAt = new Map<string, number>() // request id -> latest `failed` row
  for (const row of rows) {
    if (row.outcome !== 'failed') continue
    const at = Date.parse(row.createdAt)
    if (Number.isFinite(at) && at > (failedAt.get(row.requestId) ?? -Infinity)) failedAt.set(row.requestId, at)
  }
  return rows.filter((row) => {
    if (row.outcome === 'sent') return true
    if (row.outcome !== 'unknown') return false
    const settledAt = failedAt.get(row.requestId)
    const unknownAt = Date.parse(row.createdAt)
    // Only a `failed` row written at or after the `unknown` one settles it; anything unreadable keeps counting.
    return !(settledAt !== undefined && Number.isFinite(unknownAt) && settledAt >= unknownAt)
  })
}

interface SummaryAccumulator {
  templateKey: string | null
  sent: number
  blocked: number
  failed: number
  unknown: number
}

function emptySummary(templateKey: string | null): SummaryAccumulator {
  return { templateKey, sent: 0, blocked: 0, failed: 0, unknown: 0 }
}

function bumpSummary(acc: SummaryAccumulator, outcome: ReceiptOutcome): void {
  if (outcome === 'sent') acc.sent += 1
  else if (outcome === 'blocked') acc.blocked += 1
  else if (outcome === 'failed') acc.failed += 1
  else acc.unknown += 1
}

function compareSummary(a: ReceiptSummaryRow, b: ReceiptSummaryRow): number {
  if (a.templateKey === null && b.templateKey === null) return 0
  if (a.templateKey === null) return 1
  if (b.templateKey === null) return -1
  return a.templateKey < b.templateKey ? -1 : a.templateKey > b.templateKey ? 1 : 0
}

export async function summariseReceiptsSince(
  db: SupabaseClient,
  clientId: string,
  sinceIso: string,
): Promise<ReceiptSummaryRow[]> {
  const { data, error } = await db
    .from(TABLE)
    .select('template_key, outcome')
    .eq('client_id', clientId)
    .gte('created_at', sinceIso)
  if (error !== null) throw new Error(`${TABLE}: summarise since: ${error.message}`)
  const rows = Array.isArray(data) ? data : []
  const groups = new Map<string | null, SummaryAccumulator>()
  for (const raw of rows) {
    if (raw === null || typeof raw !== 'object') {
      throw new Error(`${TABLE}: unreadable row`)
    }
    const r = raw as Record<string, unknown>
    const outcome = r.outcome
    if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as ReceiptOutcome)) {
      throw new Error(`${TABLE}: unreadable row`)
    }
    const keyRaw = r.template_key
    if (keyRaw !== null && keyRaw !== undefined && typeof keyRaw !== 'string') {
      throw new Error(`${TABLE}: unreadable row`)
    }
    const key = typeof keyRaw === 'string' ? keyRaw : null
    const acc = groups.get(key) ?? emptySummary(key)
    bumpSummary(acc, outcome as ReceiptOutcome)
    groups.set(key, acc)
  }
  return Array.from(groups.values()).sort(compareSummary)
}
