/**
 * Facebook Page binding — the single write entry for clients.facebook_page_id.
 *
 * Setting this is what turns the Messenger pipeline on for a client: the hourly
 * sync only pulls Pages that have an id here, and everything downstream (briefs,
 * the 客户消息 page, sending replies) hangs off that.
 *
 * Until now the only way to set it was a SQL UPDATE, which CLAUDE.md forbids for
 * FDE/PM configuration — the migration that added the column says so in a TODO.
 * This closes it.
 *
 * GET   → { page_id, pages, pages_error, reachable }
 *         `pages` is the list the client's Meta token can act for, so the UI can
 *         offer a pick-list instead of asking someone to find a numeric id.
 *         It is null (with a reason in pages_error) when we cannot ask Meta.
 *         `reachable` answers "is this binding actually live right now" — see below.
 * PATCH → { page_id: string | null } replaces the binding; null clears it.
 *
 * ── AD-SEC-4 (2026-09-17) — who may change this, and what "bound" proves ─────
 * This column picks the Page the Messenger and lead-form syncs read with a token
 * that may be the shared fallback (it can see several clients' Pages), and it is
 * the ownership basis for boost-post / draft / winner-reel-sync. So:
 *   - PATCH: internal staff only (requireGlobalAdmin — ADMIN_EMAILS /
 *     ADMIN_EMAIL_DOMAIN; DEMO_ADMINS, scoped admins and every client_portal_users
 *     access_type incl. 'fde' are refused, nothing written or recorded);
 *   - binding runs src/lib/meta/page-binding-service.ts: Meta must list the Page
 *     for this client's token (or a stored OAuth connection) → the Page must not be
 *     bound to another client (no override) → audit row first, fail closed;
 *   - GET: the pick-list (`pages`) is staff-only — through the shared token it
 *     lists other clients' Pages. `verification` says whether the syncs will run
 *     (src/lib/meta/page-sync-authorization.ts); only staff see the reason.
 *
 * WHY GET REPORTS `reachable` (added 2026-07-31)
 * ---------------------------------------------
 * A Page can be bound and still pull nothing: the agency can be allowed to
 * *advertise* with a client's Page without that Page being shared into our
 * portfolio, and only the second grant lets us read the inbox. PATCH already
 * said so at save time, but that message vanished on the next page load, so a
 * dead binding looked identical to a healthy one forever after.
 *
 * 30 Kiteroa ran this way: Page bound, ads live and spending, hourly sync
 * skipping with `no_page_token`, zero conversations in ME, nothing on screen
 * saying so. Computing it on GET costs nothing — readPages() is already called
 * here for the pick-list.
 *
 * `reachable` also checks the stored per-client OAuth token (added 2026-09-13,
 * see computeReachable below) — not just the legacy env-var token `pages` is
 * built from — otherwise any client who connects through "连接 Meta" gets a
 * permanent false alarm even though the actual hourly sync works fine.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { listManagedPages, type ManagedPage } from '@/lib/meta/page-posts'
import { normalisePageId } from '@/lib/meta/page-binding'
import { bindPage, clearPage } from '@/lib/meta/page-binding-service'
import { assessPageBinding } from '@/lib/meta/page-sync-authorization'
import { projectFactoryConfig } from '@/lib/factory/client-config'

/** Why the pick-list is unavailable — the UI turns each into a plain sentence. */
type PagesError = 'no_token' | 'meta_rejected'

async function readPages(
  clientId: string,
): Promise<{ pages: ManagedPage[] | null; pages_error: PagesError | null }> {
  const userToken = await getMetaTokenForClient(clientId)
  if (!userToken) return { pages: null, pages_error: 'no_token' }

  const pages = await listManagedPages(userToken)
  if (!pages) return { pages: null, pages_error: 'meta_rejected' }

  return { pages, pages_error: null }
}

/**
 * Can ME actually act for the bound Page right now?
 *   true  → the Page is in the list our token can act for, OR we hold a stored
 *           per-client OAuth token for it; sync will pull it
 *   false → bound, but neither source hands us this Page (grant missing/expired)
 *   null  → nothing bound, or we could not ask Meta at all and have no stored token
 * `false` is the state that used to be invisible, so callers must render it.
 *
 * WHY THIS ALSO CHECKS getStoredPageToken (added 2026-09-13)
 * ------------------------------------------------------------
 * `pages` comes from getMetaTokenForClient — the legacy env-var token, which is
 * what the pick-list is built from. It has no idea about a client that connected
 * through the "连接 Meta" OAuth button: that flow stores its own per-client token
 * in platform_oauth_connections via getStoredPageToken, and never touches the
 * env var. New Asian Logistics hit exactly this: OAuth succeeded, the sync (which
 * already tries getStoredPageToken first) worked fine, but this check only ever
 * looked at the old env-token pick-list and reported "not reachable" forever.
 * The pick-list logic itself is untouched — it still needs to know which Pages
 * exist before it can offer them, and stored-token lookup needs a concrete
 * page_id to check, so it cannot help there.
 */
async function computeReachable(
  clientId: string,
  pageId: string | null,
  pages: ManagedPage[] | null,
): Promise<boolean | null> {
  if (pageId === null) return null
  if (pages?.some((p) => p.id === pageId)) return true

  const storedToken = await getStoredPageToken(clientId, pageId)
  if (storedToken) return true

  if (!pages) return null
  return false
}

/**
 * Will the syncs run for this Page? `null` when there is no Meta token at all —
 * that is not a binding problem and `reachable` already says so. The refusal
 * reason can name another client's binding, so only staff get it.
 */
async function verificationFor(clientId: string, pageId: string, isStaff: boolean) {
  const assessment = await assessPageBinding(supabaseAdmin, clientId, pageId, process.env)
  if (!assessment.verified && assessment.reason === 'no_meta_token') return null
  return isStaff ? assessment : { verified: assessment.verified }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id, factory_config')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  // Global admin = tier admin with no client restriction (scoped admins carry allowedClientId).
  const isStaff = access.tier === 'admin' && access.allowedClientId === null

  const raw = (data as { facebook_page_id: unknown }).facebook_page_id
  const page_id = typeof raw === 'string' && raw.trim().length > 0 ? raw : null

  // The Facebook Reel adapter publishes to factory_config.publish_target, which
  // is configured independently of the inbox Page. Expose it so the UI can offer
  // "Reauthorize Meta Publishing" whenever a valid Facebook publish target
  // exists — even when facebook_page_id is unset or a different Page.
  const publishTarget = projectFactoryConfig((data as { factory_config?: unknown }).factory_config).publish_target
  const publish_target_page_id =
    publishTarget && publishTarget.platform === 'facebook' ? publishTarget.page_id : null

  // Best-effort: a Meta outage must not stop someone reading or clearing the
  // binding, so a failed lookup degrades to "no pick-list" rather than a 500.
  const { pages, pages_error } = await readPages(clientId)
  const reachable = await computeReachable(clientId, page_id, pages)

  const verification = page_id ? await verificationFor(clientId, page_id, isStaff) : null

  return NextResponse.json({
    page_id,
    publish_target_page_id,
    pages: isStaff ? pages : null,
    pages_error: isStaff ? pages_error : null,
    reachable,
    verification,
    can_edit: isStaff,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // 改绑定主页只许内部员工（AD-SEC-4，理由见文件头）。客户成员仍可 GET 查看。
  const admin = await requireGlobalAdmin()
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const actorEmail = (admin.user.email ?? '').toLowerCase().trim()

  let body: { page_id?: unknown }
  try {
    body = (await req.json()) as { page_id?: unknown }
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  // An absent page_id must not silently mean "clear the binding".
  if (!body || typeof body !== 'object' || !('page_id' in body)) {
    return NextResponse.json({ error: '缺少 page_id（要清空绑定请明确传 null）' }, { status: 400 })
  }

  let next: string | null
  try {
    next = normalisePageId(body.page_id)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  const result = next === null
    ? await clearPage(clientId, actorEmail)
    : await bindPage(clientId, actorEmail, next)
  if (result.status !== 200) {
    return NextResponse.json(result.body, { status: result.status })
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort outside a Next request context
  }

  // Tell the caller whether ME can actually reach the Page it was just told to
  // watch, and whether the syncs will run for it.
  const { pages, pages_error } = await readPages(clientId)
  const reachable = await computeReachable(clientId, next, pages)
  const verification = next ? await verificationFor(clientId, next, true) : null

  return NextResponse.json({ ...result.body, reachable, pages, pages_error, verification })
}
