/**
 * Spend activation authority — who may turn Meta ad spend back ON.
 *
 * Turning a campaign ACTIVE (reactivate a paused campaign, approve a draft) is the
 * one step where money starts moving. Paid client accounts may still PAUSE; only
 * the global admin (PM) may ACTIVATE. Every activation carries a machine-readable
 * receipt so it can be traced afterwards (who, which client, which campaign, basis, time).
 *
 * Fail-closed: no session, scoped admin, not on the exact ADS_SPEND_APPROVER_EMAILS list
 * (empty list = nobody), or any thrown error → deny. Pausing never goes through this module.
 *
 * 2026-11-03 (fix-plan knife 3a): the list used to be ADMIN_EMAILS, which holds six people;
 * PM decided only PM personally may turn spend back on, so it now shares the spend-approver
 * list with the kernel's spend-increase gate.
 *
 * Go-live uses a separate basis, `go_live_card`. This module does not grant it.
 * The go-live decision mints that basis only after OPC or that client's FDE
 * clicks the confirmation card. `requireSpendActivationAuthority` stays global-admin only.
 */
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { isSpendApproverEmail } from '@/lib/auth/whitelist'

export const SPEND_ACTIVATION_RECEIPT_SCHEMA = 'ads.spend_activation_receipt.v1' as const

export type SpendActivationEntry = 'meta-ads/execute' | 'ad-approval' | 'go-live-card'

export interface SpendActivationAuthority {
  readonly actorUserId: string
  readonly actorEmail: string
  readonly basis: 'global_admin' | 'go_live_card'
  /** Set only for `go_live_card`: the confirmation-card run that was clicked. */
  readonly cardRunId?: string
}

export type SpendActivationAuthorityResult =
  | ({ ok: true } & SpendActivationAuthority)
  | { ok: false; status: 401 | 403 | 500; error: string; code: 'activation_requires_pm' | 'activation_auth_failed' }

export const ACTIVATION_DENIED_MESSAGE = '重新开启广告（会开始花钱）只有 PM 能操作；暂停不受影响。'

export async function requireSpendActivationAuthority(): Promise<SpendActivationAuthorityResult> {
  try {
    const admin = await requireGlobalAdmin()
    if (!admin.ok) {
      return {
        ok: false,
        status: admin.status,
        error: ACTIVATION_DENIED_MESSAGE,
        code: 'activation_requires_pm',
      }
    }

    const email = (admin.user.email ?? '').toLowerCase().trim()

    // Only the exact ADS_SPEND_APPROVER_EMAILS list counts (not ADMIN_EMAILS, not ADMIN_EMAIL_DOMAIN).
    if (!isSpendApproverEmail(email)) {
      return {
        ok: false,
        status: 403,
        error: ACTIVATION_DENIED_MESSAGE,
        code: 'activation_requires_pm',
      }
    }

    return {
      ok: true,
      actorUserId: admin.user.id,
      actorEmail: email,
      basis: 'global_admin',
    }
  } catch (error) {
    console.error('[ads/spend-activation] authority check failed:', error)
    return {
      ok: false,
      status: 500,
      error: '暂时无法核对重开权限，已拒绝。',
      code: 'activation_auth_failed',
    }
  }
}

export interface SpendActivationReceipt {
  readonly schema: typeof SPEND_ACTIVATION_RECEIPT_SCHEMA
  readonly entry: SpendActivationEntry
  readonly basis: 'global_admin' | 'go_live_card'
  readonly card_run_id?: string
  readonly actor_user_id: string
  readonly actor_email: string
  readonly client_id: string
  readonly campaign_id: string
  readonly draft_action_id: string | null
  readonly authorized_at: string
  /** The approved ads plan this launch was checked against. Absent on older receipts. */
  readonly plan_id?: string
}

export function buildSpendActivationReceipt(input: {
  readonly authority: SpendActivationAuthority
  readonly entry: SpendActivationEntry
  readonly clientId: string
  readonly campaignId: string
  readonly draftActionId?: string | null
  readonly now?: Date
  readonly planId?: string
}): SpendActivationReceipt {
  const receipt: SpendActivationReceipt = {
    schema: SPEND_ACTIVATION_RECEIPT_SCHEMA,
    entry: input.entry,
    basis: input.authority.basis,
    actor_user_id: input.authority.actorUserId,
    actor_email: input.authority.actorEmail,
    client_id: input.clientId,
    campaign_id: input.campaignId,
    draft_action_id: input.draftActionId ?? null,
    authorized_at: (input.now ?? new Date()).toISOString(),
  }
  const withCard = input.authority.cardRunId ? { ...receipt, card_run_id: input.authority.cardRunId } : receipt
  if (!input.planId) return withCard
  return { ...withCard, plan_id: input.planId }
}
