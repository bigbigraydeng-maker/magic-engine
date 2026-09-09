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
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { listManagedPages, type ManagedPage } from '@/lib/meta/page-posts'
import { projectFactoryConfig } from '@/lib/factory/client-config'

/** Why the pick-list is unavailable — the UI turns each into a plain sentence. */
type PagesError = 'no_token' | 'meta_rejected'

/**
 * Page IDs are long numeric strings ("1616575215312482"). We accept digits only:
 * people paste the vanity URL (facebook.com/CTSTOURS) by mistake, and saving that
 * would leave the sync silently pulling nothing until someone dug into the logs.
 *
 * Returns null on empty input (clear the binding); throws on anything malformed
 * so PATCH answers 400 with a sentence rather than storing junk.
 */
function normalisePageId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') throw new Error('page_id 必须是字符串或 null')

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  if (!/^\d{8,}$/.test(trimmed)) {
    throw new Error(
      '主页 ID 只能是数字（至少 8 位），比如 1616575215312482。' +
        '主页网址里的名字（facebook.com/CTSTOURS）不是 ID，请在下面的列表里选，或到主页「关于」页面找「主页 ID」。',
    )
  }
  return trimmed
}

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
 *   true  → the Page is in the list our token can act for; sync will pull it
 *   false → bound, but Meta does not hand us this Page (grant missing/expired)
 *   null  → nothing bound, or we could not ask Meta at all
 * `false` is the state that used to be invisible, so callers must render it.
 */
function computeReachable(pageId: string | null, pages: ManagedPage[] | null): boolean | null {
  if (pageId === null) return null
  if (!pages) return null
  return pages.some((p) => p.id === pageId)
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

  return NextResponse.json({
    page_id,
    publish_target_page_id,
    // The "add our app to your Business portfolio" instructions need the app id
    // that is actually live in this environment — hardcoding it in the UI copy
    // sends operators to add the wrong app whenever FACEBOOK_APP_ID differs
    // (staging, a migrated app, etc), and the grant still fails afterward.
    meta_app_id: process.env.FACEBOOK_APP_ID ?? null,
    pages,
    pages_error,
    reachable: computeReachable(page_id, pages),
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

  let body: { page_id?: unknown }
  try {
    body = (await req.json()) as { page_id?: unknown }
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
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

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ facebook_page_id: next })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `保存失败：${updateErr.message}` },
      { status: 500 },
    )
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort outside a Next request context
  }

  // Tell the caller whether ME can actually reach the Page it was just told to
  // watch. Saving succeeds either way — a binding made before Meta is connected
  // is legitimate — but the UI must be able to say "saved, but not live yet"
  // instead of implying the sync has started.
  const { pages, pages_error } = await readPages(clientId)
  const reachable = computeReachable(next, pages)

  return NextResponse.json({ success: true, page_id: next, reachable, pages, pages_error })
}
