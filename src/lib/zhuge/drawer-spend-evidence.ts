/**
 * Local reads for the drawer's hard checks. Fail closed.
 * Does not call the ad platform. A miss is unread, never a default pass.
 */

import type { CardClicker, HardCheckState } from '@/lib/confirmation-card'
import {
  pickLatestClientReceipt,
  receiptIsStale,
  TRACKING_PREFLIGHT_JOB,
  TRACKING_RECEIPT_STALE_HOURS,
} from '@/lib/ads-tracking-preflight/receipt'
import type { Light } from '@/lib/marketing-plan/promo/gates'
import type { CapFact, SpendEvidence } from './drawer-spend-checks'

interface QueryResult<T> {
  data: T
  error: { message: string } | null
}

export interface SpendEvidenceDb {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): CapChain & LogChain
    }
  }
}

interface CapChain {
  maybeSingle(): Promise<QueryResult<{ daily_budget_cap_cents?: unknown } | null>>
}

interface LogChain {
  order(column: string, options: { ascending: boolean }): {
    limit(count: number): Promise<QueryResult<unknown[] | null>>
  }
}

const CRM_UNREAD = '线索进 CRM 的检查读不到'
const CREATIVE_UNREAD = '这句话没有对上已批准的素材'
const OWNERSHIP_UNREAD = '系列归属读不到'

function safeReason(text: string, fallback: string): string {
  const cleaned = text
    .replace(/[{}[\]`]/g, ' ')
    .replace(/\d{10,}/g, '数字已略')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return fallback
  return cleaned.slice(0, 80)
}

function crmFromLight(status: Light, reason: string): { state: HardCheckState; reason: string } {
  if (status === 'green') return { state: 'green', reason: safeReason(reason, '') }
  if (status === 'red') return { state: 'red', reason: safeReason(reason, '没通过') }
  return { state: 'unread', reason: safeReason(reason, CRM_UNREAD) }
}

async function readCap(db: SpendEvidenceDb, clientId: string): Promise<CapFact> {
  const result = await db.from('ad_strategy_configs').select('daily_budget_cap_cents').eq('client_id', clientId).maybeSingle()
  if (result.error) return 'unread'
  const cents = result.data?.daily_budget_cap_cents
  if (typeof cents === 'number' && Number.isFinite(cents)) return { cents }
  if (!result.data) return 'missing'
  return 'missing'
}

async function readCrm(db: SpendEvidenceDb, clientId: string, now: Date): Promise<{ state: HardCheckState; reason: string }> {
  const result = await db
    .from('cron_run_logs')
    .select('status, started_at, summary')
    .eq('job_name', TRACKING_PREFLIGHT_JOB)
    .order('started_at', { ascending: false })
    .limit(20)
  if (result.error || !Array.isArray(result.data)) return { state: 'unread', reason: CRM_UNREAD }
  const picked = pickLatestClientReceipt(
    result.data as Array<{ status: string | null; started_at: string; summary: unknown }>,
    clientId,
  )
  if (!picked) return { state: 'unread', reason: CRM_UNREAD }
  if (receiptIsStale(picked.receipt.checked_at, now, TRACKING_RECEIPT_STALE_HOURS)) {
    return { state: 'unread', reason: '线索进 CRM 的检查过期了，没有当成通过' }
  }
  const gate = picked.receipt.gates.find((item) => item.key === 'tracking.lead_reaches_crm')
  if (!gate || gate.na) return { state: 'unread', reason: CRM_UNREAD }
  return crmFromLight(gate.status, gate.reason)
}

export function unreadEvidence(speaker: CardClicker, clientId: string): SpendEvidence {
  return {
    dailyCap: 'unread',
    amountVerdict: 'unknown',
    leadCrm: 'unread',
    leadCrmReason: CRM_UNREAD,
    creative: 'unread',
    creativeReason: CREATIVE_UNREAD,
    ownership: 'unread',
    ownershipReason: OWNERSHIP_UNREAD,
    speaker,
    clientId,
  }
}

export async function loadSpendEvidence(
  db: SpendEvidenceDb,
  clientId: string,
  speaker: CardClicker,
  now: Date,
): Promise<SpendEvidence> {
  try {
    const [dailyCap, crm] = await Promise.all([
      readCap(db, clientId),
      readCrm(db, clientId, now),
    ])
    return {
      ...unreadEvidence(speaker, clientId),
      dailyCap,
      leadCrm: crm.state,
      leadCrmReason: crm.reason,
    }
  } catch {
    return unreadEvidence(speaker, clientId)
  }
}
