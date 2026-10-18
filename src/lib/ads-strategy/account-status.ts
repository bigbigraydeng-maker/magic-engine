import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'

export interface AccountStatusRow {
  ad_account_id: string
  entity_name: string | null
  account_status: number | null
  timezone_name: string | null
  capture_reason: string | null
  captured_at: string
}

export const DISAPPEARED_CAPTURE_REASON = 'disappeared'
export const ACCOUNT_STATUS_ACTIVE = 1
export const ACCOUNT_STATUS_UNSETTLED = 3
/** Meta account_status codes meaning the account is disabled / pending closure / closed. */
export const ACCOUNT_STATUS_CLOSED_CODES: ReadonlySet<number> = new Set([2, 100, 101])

export function isClosedAccountStatus(code: number | null): boolean {
  return code !== null && ACCOUNT_STATUS_CLOSED_CODES.has(code)
}

export function accountStatusHint(code: number): string {
  return code === ACCOUNT_STATUS_UNSETTLED ? '一般是欠款未结' : ''
}

export function normalizeAdAccountId(id: string): string {
  return id.startsWith('act_') ? id.slice('act_'.length) : id
}

/** Reads account-level snapshot rows for one client since sinceIso, newest first. Throws Error on read failure (never swallow into []). */
export async function loadAccountStatusRows(clientId: string, sinceIso: string): Promise<AccountStatusRow[]> {
  return fetchAll<AccountStatusRow>((from, to) =>
    supabaseAdmin
      .from('ad_entity_snapshots')
      .select('ad_account_id, entity_name, account_status, timezone_name, capture_reason, captured_at')
      .eq('client_id', clientId)
      .eq('level', 'account')
      .gte('captured_at', sinceIso)
      .order('captured_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

/** Pure. rows are already sorted newest first. Returns the FIRST row seen per ad_account_id (including a 'disappeared' row; callers decide). */
export function latestPerAccount(rows: readonly AccountStatusRow[]): AccountStatusRow[] {
  const seen = new Set<string>()
  const out: AccountStatusRow[] = []
  for (const r of rows) {
    if (seen.has(r.ad_account_id)) continue
    seen.add(r.ad_account_id)
    out.push(r)
  }
  return out
}
