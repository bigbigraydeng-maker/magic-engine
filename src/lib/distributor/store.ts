/**
 * Database access for the distributor admin pages. Server-only (service role).
 * Every write re-checks the state it depends on; DB triggers are the last line of defence.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { AI_STEWARD_RULES_V1 } from './config'
import type { CreateDistributorInput, Decision, DistributorStatus, RefundInput, SaleInput } from './admin-input'
import { nextStatus } from './admin-input'
import type { DistributorLevel } from './types'

export class DistributorStoreError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 500) {
    super(message)
  }
}

export interface DistributorRow {
  id: string
  parent_id: string | null
  display_name: string
  contact_email: string | null
  contact_phone: string | null
  status: DistributorStatus
  approved_by: string | null
  approved_at: string | null
  created_at: string
}

export interface DistributorSummary extends DistributorRow {
  level: DistributorLevel | null
  parent_name: string | null
  net_sales_cents: number
}

const DISTRIBUTOR_COLUMNS = 'id, parent_id, display_name, contact_email, contact_phone, status, approved_by, approved_at, created_at'
const SALE_COLUMNS = 'id, distributor_id, kind, order_ref, plan_code, months, extra_avatars, amount_cents, currency, paid_at, is_self_purchase, refund_of_sale_id, recorded_by, created_at'

type DbError = { message: string; code?: string } | null

export function fail(context: string, error: DbError): never {
  // Errors raised by our own guard triggers (refund over-limit, settled-sale edits) are conflicts, not outages.
  if (error?.code === 'P0001') throw new DistributorStoreError(error.message, 409)
  console.error(`[distributor-store] ${context}:`, error?.message)
  throw new DistributorStoreError(`${context} failed`, 500)
}

const PAGE = 1000

/** Reads every row of a table page by page (PostgREST caps a single response). `orderBy` must be unique. */
export async function selectAll<T>(table: string, columns: string, orderBy: readonly string[] = ['id']): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin.from(table).select(columns)
    for (const column of orderBy) query = query.order(column)
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error) fail(`list ${table}`, error)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

export async function listDistributors(): Promise<DistributorSummary[]> {
  const [rows, levels, saleRows] = await Promise.all([
    selectAll<DistributorRow>('distributors', DISTRIBUTOR_COLUMNS),
    selectAll<{ distributor_id: string; level: DistributorLevel; effective_from: string }>('distributor_level_history', 'id, distributor_id, level, effective_from'),
    selectAll<{ distributor_id: string; amount_cents: number }>('distributor_sales', 'id, distributor_id, amount_cents'),
  ])
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
  const latest = new Map<string, { level: DistributorLevel; at: number }>()
  for (const h of levels) {
    const at = Date.parse(h.effective_from)
    const prev = latest.get(h.distributor_id)
    if (!prev || at >= prev.at) latest.set(h.distributor_id, { level: h.level, at })
  }
  const sales = new Map<string, number>()
  for (const r of saleRows) {
    sales.set(r.distributor_id, (sales.get(r.distributor_id) ?? 0) + r.amount_cents)
  }
  const names = new Map(rows.map((r) => [r.id, r.display_name]))
  return rows.map((r) => ({
    ...r,
    level: latest.get(r.id)?.level ?? null,
    parent_name: r.parent_id ? names.get(r.parent_id) ?? null : null,
    net_sales_cents: sales.get(r.id) ?? 0,
  }))
}

async function getDistributor(id: string): Promise<DistributorRow> {
  const { data, error } = await supabaseAdmin.from('distributors').select(DISTRIBUTOR_COLUMNS).eq('id', id).maybeSingle()
  if (error) fail('load distributor', error)
  if (!data) throw new DistributorStoreError('distributor not found', 404)
  return data as DistributorRow
}

export async function createDistributor(input: CreateDistributorInput): Promise<DistributorRow> {
  if (input.parentId) {
    const parent = await getDistributor(input.parentId)
    if (parent.status !== 'approved') throw new DistributorStoreError('the upline must be an approved distributor', 409)
  }
  const { data, error } = await supabaseAdmin
    .from('distributors')
    .insert({
      display_name: input.displayName,
      contact_email: input.contactEmail,
      contact_phone: input.contactPhone,
      parent_id: input.parentId,
    })
    .select(DISTRIBUTOR_COLUMNS)
    .single()
  if (error || !data) fail('create distributor', error)
  return data as DistributorRow
}

/** JSON with object keys sorted, so a jsonb round-trip compares equal to the source object. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Registers the active rule version; refuses if the stored config differs (rules changed without a new version). */
async function ensureRuleVersion(): Promise<void> {
  const rules = AI_STEWARD_RULES_V1
  const version = await supabaseAdmin
    .from('distributor_rule_versions')
    .upsert(
      { version: rules.version, config: rules, effective_from: '2026-11-10T00:00:00+13:00', created_by: 'system' },
      { onConflict: 'version', ignoreDuplicates: true },
    )
  if (version.error) fail('register rule version', version.error)
  const stored = await supabaseAdmin.from('distributor_rule_versions').select('config').eq('version', rules.version).maybeSingle()
  if (stored.error) fail('load rule version', stored.error)
  if (!stored.data || canonicalJson((stored.data as { config: unknown }).config) !== canonicalJson(rules)) {
    console.error(`[distributor-store] rule version ${rules.version} in the database differs from the code`)
    throw new DistributorStoreError('rule version mismatch: the rules changed without a new version number', 500)
  }
}

/**
 * Makes sure the distributor has a starting level and returns the earliest level start (ISO).
 * Idempotent; a concurrent duplicate insert is treated as success.
 */
async function ensureStartingLevel(distributorId: string, at: string): Promise<string> {
  await ensureRuleVersion()
  const existing = await supabaseAdmin
    .from('distributor_level_history').select('effective_from').eq('distributor_id', distributorId)
    .order('effective_from', { ascending: true }).limit(1)
  if (existing.error) fail('load level history', existing.error)
  const first = (existing.data ?? []) as Array<{ effective_from: string }>
  if (first.length > 0) return first[0].effective_from
  const inserted = await supabaseAdmin.from('distributor_level_history').insert({
    distributor_id: distributorId, level: 'standard', effective_from: at, reason: 'approved', rule_version: AI_STEWARD_RULES_V1.version,
  })
  if (inserted.error && inserted.error.code !== '23505') fail('insert starting level', inserted.error)
  return at
}

/**
 * Applies an approve / reject / suspend / reinstate decision. The status update is conditional on the
 * status we read, so two admins clicking at once cannot both win.
 */
export async function decideDistributor(id: string, decision: Decision, actorEmail: string): Promise<DistributorRow> {
  const current = await getDistributor(id)
  const to = nextStatus(current.status, decision)
  if (!to) throw new DistributorStoreError(`cannot ${decision} a distributor that is ${current.status}`, 409)
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { status: to }
  if (decision === 'approve') Object.assign(patch, { approved_by: actorEmail, approved_at: now })
  const { data, error } = await supabaseAdmin
    .from('distributors').update(patch).eq('id', id).eq('status', current.status).select(DISTRIBUTOR_COLUMNS).maybeSingle()
  if (error) fail('update distributor status', error)
  if (!data) throw new DistributorStoreError('the distributor changed meanwhile; reload and try again', 409)
  if (to === 'approved') await ensureStartingLevel(id, current.approved_at ?? now)
  return data as DistributorRow
}

export async function listSales(limit = 200): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabaseAdmin
    .from('distributor_sales').select(SALE_COLUMNS).order('paid_at', { ascending: false }).limit(limit)
  if (error) fail('list sales', error)
  return (data ?? []) as Array<Record<string, unknown>>
}

export async function recordSale(input: SaleInput, actorEmail: string): Promise<Record<string, unknown>> {
  const seller = await getDistributor(input.distributorId)
  if (seller.status !== 'approved') throw new DistributorStoreError('sales can only be recorded for approved distributors', 409)
  // Self-heal an approval whose level insert failed half-way; the engine refuses distributors without a level.
  const levelStart = await ensureStartingLevel(seller.id, seller.approved_at ?? new Date().toISOString())
  // A sale paid before the distributor had a level would make every later statement fail to compute.
  if (Date.parse(input.paidAt) < Date.parse(levelStart)) {
    throw new DistributorStoreError('the payment date is before this distributor was approved', 409)
  }
  const { data, error } = await supabaseAdmin
    .from('distributor_sales')
    .insert({
      distributor_id: input.distributorId,
      kind: input.kind,
      order_ref: input.orderRef,
      plan_code: input.planCode,
      months: input.months,
      extra_avatars: input.extraAvatars,
      amount_cents: input.amountCents,
      currency: AI_STEWARD_RULES_V1.currency,
      paid_at: input.paidAt,
      is_self_purchase: input.isSelfPurchase,
      recorded_by: actorEmail,
    })
    .select(SALE_COLUMNS)
    .single()
  if (error?.code === '23505') throw new DistributorStoreError('this order_ref was already recorded', 409)
  if (error || !data) fail('record sale', error)
  return data as Record<string, unknown>
}

export async function recordRefund(input: RefundInput, actorEmail: string): Promise<Record<string, unknown>> {
  const original = await supabaseAdmin.from('distributor_sales').select(SALE_COLUMNS).eq('id', input.refundOfSaleId).maybeSingle()
  if (original.error) fail('load original sale', original.error)
  const o = original.data as { id: string; kind: string; distributor_id: string; amount_cents: number; currency: string; paid_at: string } | null
  if (!o) throw new DistributorStoreError('original sale not found', 404)
  if (o.kind === 'refund') throw new DistributorStoreError('a refund cannot be refunded', 409)
  if (Date.parse(input.paidAt) < Date.parse(o.paid_at)) {
    throw new DistributorStoreError('the refund date is before the original payment date', 409)
  }
  const prior = await supabaseAdmin.from('distributor_sales').select('amount_cents').eq('refund_of_sale_id', o.id)
  if (prior.error) fail('load earlier refunds', prior.error)
  const remaining = ((prior.data ?? []) as Array<{ amount_cents: number }>).reduce((sum, r) => sum + r.amount_cents, o.amount_cents)
  if (input.amountCents > remaining) {
    throw new DistributorStoreError(`refund exceeds what is left of the sale (${remaining} cents)`, 409)
  }
  const { data, error } = await supabaseAdmin
    .from('distributor_sales')
    .insert({
      distributor_id: o.distributor_id,
      kind: 'refund',
      order_ref: input.orderRef,
      amount_cents: -input.amountCents,
      currency: o.currency,
      paid_at: input.paidAt,
      refund_of_sale_id: o.id,
      recorded_by: actorEmail,
    })
    .select(SALE_COLUMNS)
    .single()
  if (error?.code === '23505') throw new DistributorStoreError('this order_ref was already recorded', 409)
  if (error || !data) fail('record refund', error)
  return data as Record<string, unknown>
}
