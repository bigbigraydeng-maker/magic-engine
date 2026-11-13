/**
 * Read open budget-raise holds and overlay honest card copy.
 * Never turns the confirm button back on.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BUDGET_ACTION_TYPE, type BudgetHold, type HoldRow } from './ledger'
import {
  budgetRaisePhase,
  overlayForPhase,
  raiseAdsetLabel,
  raiseAmountPhrase,
  type BudgetRaiseCardOverlay,
  type BudgetRaisePhase,
  KERNEL_APPROVALS_PATH,
} from './raise-approval-hints'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'

export interface BudgetRaiseTodoDraft {
  readonly phase: BudgetRaisePhase
  readonly clientId: string
  readonly cardRunId: string
  readonly hold: BudgetHold
}

function asHold(row: { payload?: unknown }): HoldRow | null {
  if (!row.payload || typeof row.payload !== 'object') return null
  const payload = row.payload as BudgetHold
  if (payload.kind !== 'adset_daily_budget' || !payload.cardRunId) return null
  return { id: 'row', payload }
}

export async function fetchBudgetRaiseOverlays(
  sb: SupabaseClient,
  clientId: string,
): Promise<Map<string, BudgetRaiseCardOverlay>> {
  const out = new Map<string, BudgetRaiseCardOverlay>()
  const { data, error } = await sb
    .from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', BUDGET_ACTION_TYPE)
    .eq('payload->>status', 'awaiting')
  if (error) return out
  const holds = ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>)
    .map(asHold)
    .filter((row): row is HoldRow => row !== null)
  const runIds = [...new Set(holds.map((h) => h.payload.actionRunId).filter((id): id is string => Boolean(id)))]
  const statuses = await readRunStatuses(sb, runIds)
  for (const row of holds) {
    const phase = budgetRaisePhase(row.payload, statuses.get(row.payload.actionRunId ?? '') ?? null)
    if (!phase) continue
    out.set(row.payload.cardRunId, overlayForPhase(phase, row.payload))
  }
  return out
}

async function readRunStatuses(sb: SupabaseClient, runIds: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (runIds.length === 0) return map
  const { data, error } = await sb.from('action_runs').select('id, status').in('id', [...runIds])
  if (error) return map
  for (const row of (data ?? []) as Array<{ id?: unknown; status?: unknown }>) {
    if (typeof row.id === 'string' && typeof row.status === 'string') map.set(row.id, row.status)
  }
  return map
}

export function applyBudgetRaiseOverlay(
  card: ConfirmationCardView,
  overlay: BudgetRaiseCardOverlay | undefined,
): ConfirmationCardView & { followUpHint?: string; followUpHref?: string | null } {
  if (!overlay) return card
  return {
    ...card,
    statusLine: overlay.statusLine,
    followUpHint: overlay.followUpHint,
    followUpHref: overlay.followUpHref,
    confirmEnabled: overlay.confirmEnabled,
    declineEnabled: overlay.declineEnabled,
    blockedReason: null,
  }
}

export async function listBudgetRaiseTodos(
  sb: SupabaseClient,
  clientIds: readonly string[],
): Promise<BudgetRaiseTodoDraft[]> {
  if (clientIds.length === 0) return []
  const { data, error } = await sb
    .from('flywheel_actions')
    .select('client_id, payload')
    .in('client_id', [...clientIds])
    .eq('action_type', BUDGET_ACTION_TYPE)
    .eq('payload->>status', 'awaiting')
  if (error) throw new Error(`加预算两步待办读台账失败：${error.message}`)
  const rows = ((data ?? []) as Array<{ client_id?: unknown; payload?: unknown }>)
  const holds: Array<{ clientId: string; hold: BudgetHold }> = []
  for (const row of rows) {
    if (typeof row.client_id !== 'string') continue
    const parsed = asHold(row)
    if (!parsed) continue
    holds.push({ clientId: row.client_id, hold: parsed.payload })
  }
  const runIds = [...new Set(holds.map((h) => h.hold.actionRunId).filter((id): id is string => Boolean(id)))]
  const statuses = await readRunStatuses(sb, runIds)
  const drafts: BudgetRaiseTodoDraft[] = []
  for (const { clientId, hold } of holds) {
    const phase = budgetRaisePhase(hold, statuses.get(hold.actionRunId ?? '') ?? null)
    if (!phase) continue
    drafts.push({ phase, clientId, cardRunId: hold.cardRunId, hold })
  }
  return drafts
}

export function todoCopyForRaise(
  draft: BudgetRaiseTodoDraft,
  appBase: string,
): { what: string; how: string; href: string } {
  const who = raiseAdsetLabel(draft.hold)
  const amt = raiseAmountPhrase(draft.hold)
  const cardHref = `${appBase}/dashboard/clients/${encodeURIComponent(draft.clientId)}/confirmation-cards`
  if (draft.phase === 'awaiting_pm') {
    return {
      what: `「${who}」加日预算（${amt}）已有人确认过卡，还等你（花钱负责人）点同意；点同意只签授权，不会改 Meta。`,
      how: `打开 ${KERNEL_APPROVALS_PATH}，找到这条加广告组日预算，点「同意」。`,
      href: `${appBase}${KERNEL_APPROVALS_PATH}`,
    }
  }
  return {
    what: `「${who}」加日预算（${amt}）花钱负责人已点同意。动作停在已授权，日预算没有改。`,
    how: '确认卡上的「确认」不可点。再提交不会执行，只会停在已授权。现在没有执行入口。',
    href: cardHref,
  }
}
