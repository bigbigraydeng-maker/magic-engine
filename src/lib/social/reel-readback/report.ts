/**
 * Per-reel 72-hour numbers (likes, comments, shares) for reels the social agent put on Facebook.
 * Pure. Reuses the receipt reading of post-performance.ts, so "not readable" is never turned into 0.
 * Design: docs/specs/2026-11-05-social-agent-high-frequency-facebook-dev-plan-v1.md knife 6.
 */
import { readingFromReceipt, type PublishActionRow, type Reading, type ReceiptRow } from '@/lib/social/post-performance'

export const READBACK_WINDOW_HOURS = 72
const HOUR_MS = 3_600_000

export interface ReelMeta {
  id: string
  title: string
  template: string | null
  pillar: string | null
}

export type ReadbackStatus = 'measured' | 'pending' | 'not_readable'

export interface ReelReadbackItem {
  /** The publish action (unique per published reel; one work order can be published more than once). */
  action_id: string
  work_order_id: string
  title: string
  template: string | null
  pillar: string | null
  permalink: string | null
  published_at: string | null
  status: ReadbackStatus
  /** Why there are no numbers (status pending / not_readable). */
  note: string | null
  likes: Reading
  comments: Reading
  shares: Reading
  /** likes + comments + shares, only when all three were read; engagement is NOT inquiries. */
  engagement: Reading
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/** Receipts land a little after the 72-hour mark; inside this grace the reel still counts as "not yet". */
const RECEIPT_GRACE_HOURS = 6

/** The reel publish action keeps its work order only inside idempotency_key = `factory-reel:<work order>:<video>`. */
export function workOrderIdOf(payload: Record<string, unknown>): string | null {
  const direct = str(payload.work_order_id)
  if (direct) return direct
  const key = str(payload.idempotency_key)
  const m = key ? /^factory-reel:([^:]+):/.exec(key) : null
  return m ? m[1] : null
}

const NOT_READ: Reading = { kind: 'not_readable', reason: 'no_72h_receipt' }

function engagementOf(parts: Reading[]): Reading {
  let sum = 0
  for (const p of parts) {
    if (p.kind !== 'value') return { kind: 'not_readable', reason: 'incomplete' }
    sum += p.value
  }
  return { kind: 'value', value: sum }
}

function receiptAt72(receipts: readonly ReceiptRow[]): ReceiptRow | null {
  const ok = receipts.filter((r) => r.window_hours === READBACK_WINDOW_HOURS)
  return ok.find((r) => r.status === 'ok' || r.status === 'partial') ?? ok[0] ?? null
}

function itemOf(action: PublishActionRow, receipts: readonly ReceiptRow[], meta: ReelMeta, now: Date): ReelReadbackItem {
  const payload = isRecord(action.payload) ? action.payload : {}
  const publishedAt = str(payload.published_at) ?? action.executed_at
  const receipt = receiptAt72(receipts)
  const usable = receipt !== null && (receipt.status === 'ok' || receipt.status === 'partial')
  const age = publishedAt ? now.getTime() - new Date(publishedAt).getTime() : Number.NaN
  const base = { action_id: action.id, work_order_id: meta.id, title: meta.title, template: meta.template, pillar: meta.pillar, permalink: str(payload.permalink), published_at: publishedAt }
  if (usable) {
    const likes = readingFromReceipt(receipt, 'likes')
    const comments = readingFromReceipt(receipt, 'comments')
    const shares = readingFromReceipt(receipt, 'shares')
    return { ...base, status: 'measured', note: null, likes, comments, shares, engagement: engagementOf([likes, comments, shares]) }
  }
  const young = Number.isFinite(age) && age < (READBACK_WINDOW_HOURS + RECEIPT_GRACE_HOURS) * HOUR_MS
  const reason = receipt !== null ? (receipt.reason ?? receipt.status) : null
  return {
    ...base,
    status: young ? 'pending' : 'not_readable',
    note: young ? '还没满 72 小时（或成绩还在路上）' : `满 72 小时但没读到数${reason ? `（${reason}）` : ''}`,
    likes: NOT_READ, comments: NOT_READ, shares: NOT_READ, engagement: NOT_READ,
  }
}

/** One item per reel action whose work order is known; newest first. Reels with no work-order meta are skipped (counted). */
export function buildReelReadback(input: {
  actions: readonly PublishActionRow[]
  receipts: readonly ReceiptRow[]
  metas: ReadonlyMap<string, ReelMeta>
  now: Date
}): { items: ReelReadbackItem[]; unmatched: number } {
  const byAction = new Map<string, ReceiptRow[]>()
  for (const r of input.receipts) byAction.set(r.action_id, [...(byAction.get(r.action_id) ?? []), r])
  const items: ReelReadbackItem[] = []
  let unmatched = 0
  for (const action of input.actions) {
    const payload = isRecord(action.payload) ? action.payload : {}
    const woId = workOrderIdOf(payload)
    const meta = woId ? input.metas.get(woId) : undefined
    if (!meta) { unmatched += 1; continue }
    items.push(itemOf(action, byAction.get(action.id) ?? [], meta, input.now))
  }
  items.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
  return { items, unmatched }
}
