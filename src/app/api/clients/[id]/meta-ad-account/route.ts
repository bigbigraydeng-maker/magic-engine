/**
 * Meta ad account — single write entry for clients.meta_ad_account_id.
 *
 * GET   → { ad_account_id, can_edit, pending_request }
 *         `pending_request` (internal staff only) is the latest number a client
 *         submitted from the self-serve wizard that nobody has handled yet.
 * PATCH → body { ad_account_id, preview?, allow_shared_account?, override_reason?,
 *                dismiss_request?, keep_previous_as_secondary? }
 *
 * Consumed by:
 *   - src/app/api/clients/[id]/meta-ads/sync/route.ts (manual sync, 422 if unset)
 *   - src/app/api/cron/google-data-pullback-daily/route.ts (daily flywheel)
 *   - src/lib/diagnostic/adapters/MetaAdsAdapter.ts
 *   - src/lib/meta/campaign-ownership.ts (AD-SEC-1 ownership gate on ad WRITES)
 *
 * ── AD-SEC-3 (2026-09-13) — who may change this ─────────────────────────────
 * The ownership gate on stop-loss / meta-ads/execute trusts this registry. It
 * used to be writable by anyone with dashboard access to the client — including
 * the client's own staff — with only a format check, so rebinding client A to
 * client B's account number unlocked B's campaigns (often through the shared
 * fallback token that can see both). Now:
 *   - only internal staff (requireGlobalAdmin: ADMIN_EMAILS / ADMIN_EMAIL_DOMAIN)
 *     can bind, clear, or dismiss; DEMO_ADMINS / scoped_admin / every
 *     client_portal_users access_type (incl. legacy 'fde') cannot;
 *   - a client member's submission is recorded as a pending request for FDE
 *     (daily "需要你动手" list) and answered 403 — nothing is bound;
 *   - binding runs the checks in src/lib/meta/ad-account-binding-service.ts
 *     (Graph readable → not registered to another client unless overridden with
 *     a reason → audit row first, fail closed) and records who/when/what.
 *
 * Primary-account mirroring into `client_meta_ad_accounts` (2026-09-13 multi-
 * account table): the ownership gate trusts EVERY registered row, so on rebind /
 * clear the old primary is now REMOVED from this client unless staff tick
 * `keep_previous_as_secondary` (e.g. CTS personal + official accounts). Both
 * writes roll back together on failure — see src/lib/meta/ad-account-registry-write.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess, requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { parseAdAccountInput } from '@/lib/meta/ad-account-binding'
import { listPendingBindingRequests } from '@/lib/clients/binding-requests'
import {
  bindAdAccount, clearAdAccount, dismissBindingRequest, recordClientRequest, parseOverride,
  type ServiceResult,
} from '@/lib/meta/ad-account-binding-service'

interface PatchBody {
  ad_account_id?: unknown
  preview?: unknown
  allow_shared_account?: unknown
  override_reason?: unknown
  dismiss_request?: unknown
  keep_previous_as_secondary?: unknown
}

const json = (r: ServiceResult) => NextResponse.json(r.body, { status: r.status })
const badRequest = (err: unknown) =>
  NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = (data as { meta_ad_account_id: unknown }).meta_ad_account_id
  const ad_account_id = typeof raw === 'string' && raw.trim().length > 0 ? raw : null

  // Global admin = tier admin with no client restriction (scoped admins carry allowedClientId).
  const canEdit = access.tier === 'admin' && access.allowedClientId === null
  let pending_request: unknown = null
  if (canEdit) {
    try {
      const [pending] = await listPendingBindingRequests(supabaseAdmin, 'meta_ad_account', new Date(), [clientId])
      pending_request = pending ?? null
    } catch (err) {
      // Showing the binding matters more than the hint; say it could not be read.
      pending_request = { error: err instanceof Error ? err.message : String(err) }
    }
  }

  return NextResponse.json({ ad_account_id, can_edit: canEdit, pending_request })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const admin = await requireGlobalAdmin()
  if (!admin.ok) {
    if (admin.status === 401) return NextResponse.json({ error: admin.error }, { status: 401 })
    return handleNonStaff(clientId, body)
  }
  const actorEmail = (admin.user.email ?? '').toLowerCase().trim()

  if (body.dismiss_request === true) return json(await dismissBindingRequest(clientId, actorEmail))

  let next: string | null
  let override: { reason: string } | null
  try {
    next = parseAdAccountInput(body.ad_account_id)
    override = parseOverride(body)
  } catch (err) {
    return badRequest(err)
  }

  const keepPrevious = body.keep_previous_as_secondary === true
  const result = next === null
    ? await clearAdAccount(clientId, actorEmail, keepPrevious)
    : await bindAdAccount({ clientId, actorEmail, adAccountId: next, preview: body.preview === true, override, keepPrevious })

  if (result.status === 200 && body.preview !== true) {
    try {
      revalidatePath(`/dashboard/clients/${clientId}/settings`)
    } catch {
      // best-effort during dev / non-Next runtime
    }
  }
  return json(result)
}

/**
 * Not internal staff. Members of this client get their number recorded for FDE;
 * everyone else is refused without writing anything (no audit spam from outsiders).
 */
async function handleNonStaff(clientId: string, body: PatchBody): Promise<NextResponse> {
  const member = await requireOnboardingClientAccess(clientId)
  if (!member.ok) {
    return NextResponse.json({ error: member.error }, { status: member.status })
  }

  let next: string | null
  try {
    next = parseAdAccountInput(body.ad_account_id)
  } catch (err) {
    return badRequest(err)
  }
  if (next === null) {
    return NextResponse.json(
      { error: 'Only the Magic Lab team can disconnect an ad account.', reason: 'fde_verification_required' },
      { status: 403 },
    )
  }

  const actorEmail = (member.user.email ?? '').toLowerCase().trim()
  return json(await recordClientRequest(clientId, actorEmail, next))
}
