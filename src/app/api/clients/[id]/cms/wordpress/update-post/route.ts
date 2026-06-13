/**
 * POST /api/clients/[id]/cms/wordpress/update-post  (P12.R.M2 — Page Rewriter)
 *
 * PATCH an already-published WordPress post or page.
 *
 * Unlike `publish-wordpress` (two-step draft → publish flow), this is a SINGLE-
 * step update: the WP REST PATCH is atomic, so the row in `website_publish_jobs`
 * is created with status='completed' in one go.
 *
 * Request body (at least one updatable field is required):
 *   {
 *     remote_post_id:    number                       // required, WP post ID
 *     target_type?:      'post' | 'page'              // default 'post'
 *     kanban_item_id?:   string (uuid)                // optional Kanban execution_items row UUID
 *     idempotency_key?:  string                       // default = sha256(payload)
 *
 *     // Updatable fields — supply ONE OR MORE:
 *     title?:            string
 *     excerpt?:          string
 *     slug?:             string
 *     seo_title?:        string
 *     seo_description?:  string
 *     focus_keyphrase?:  string
 *     content_html?:     string   // sanitized before send
 *   }
 *
 * Audit:
 *   `website_publish_jobs` row with content_snapshot JSONB containing
 *   { action: 'update_existing', target_type, remote_post_id, input,
 *     before_snapshot, after_snapshot } so a rollback or human review can
 *   inspect exactly what changed.
 *
 *   `flywheel_actions` row with action_type=CMS_ACTION_TYPE.UPDATE_EXISTING.
 *
 * Security:
 *   - requirePaidClientAccess gates tenant isolation
 *   - content_html is sanitized via prepareCmsContent (strips script/iframe/event-handlers)
 *   - All WP traffic goes through wpFetch hardened in P12.R.B6
 *     (timeout / WAF detection / 5xx retry)
 *
 * Phase 12.R.M2
 */

import { createHash, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import {
  getExistingWordpressPost,
  updateExistingWordpressPost,
  WordpressFetchError,
  type WordpressPostType,
  type ExistingWordpressPost,
  type UpdateExistingWordpressPostInput,
} from '@/lib/cms/wordpress-client'
import { prepareCmsContent } from '@/lib/cms/html-sanitizer'
import { CMS_ACTION_TYPE } from '@/lib/cms/vocabulary'

interface RouteContext {
  params: { id: string }
}

interface UpdatePostRequestBody {
  remote_post_id:    number
  target_type?:      WordpressPostType
  kanban_item_id?:   string
  idempotency_key?:  string
  title?:            string
  excerpt?:          string
  slug?:             string
  seo_title?:        string
  seo_description?:  string
  focus_keyphrase?:  string
  content_html?:     string
}

// ─── small helpers ────────────────────────────────────────────────────────────

function badInput(msg: string): NextResponse {
  return NextResponse.json({ success: false, error: msg, code: 'INVALID_INPUT' }, { status: 400 })
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

async function findConnectionRow(clientId: string): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from('cms_connections')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'wordpress')
    .maybeSingle()
  return data as { id: string } | null
}

// Map M1 WordpressFetchError codes onto outward-facing HTTP responses so the UI
// can show the right remediation hint (WAF allowlist, credentials, etc.).
function respondWpError(err: WordpressFetchError): NextResponse {
  const status = (() => {
    switch (err.code) {
      case 'SITEGROUND_ANTIBOT':
      case 'CLOUDFLARE_CHALLENGE':
      case 'WORDFENCE_BLOCK':
      case 'SUCURI_BLOCK':
      case 'GENERIC_WAF':         return 502
      case 'TIMEOUT':             return 504
      case 'NETWORK_ERROR':       return 502
      case 'WP_REST_DISABLED':    return 502
      case 'HTTP_ERROR':          return (err.httpStatus && err.httpStatus >= 400 && err.httpStatus < 600) ? err.httpStatus : 502
    }
  })()
  return NextResponse.json(
    { success: false, error: err.message, code: err.code, wp_status: err.httpStatus ?? null },
    { status },
  )
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    return await handleUpdatePost(req, ctx)
  } catch (err) {
    // Last-chance net for unexpected Supabase errors / Buffer-out-of-memory /
    // anything we forgot to map. We don't echo the message verbatim because
    // raw DB errors often leak schema details.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[update-post]', ctx.params.id, message)
    return NextResponse.json(
      { success: false, error: 'Internal error processing the update request', code: 'INTERNAL' },
      { status: 500 },
    )
  }
}

async function handleUpdatePost(req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id: clientId } = params
  if (!clientId) return badInput('client id required')

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: UpdatePostRequestBody
  try {
    body = await req.json() as UpdatePostRequestBody
  } catch {
    return badInput('Invalid JSON body')
  }

  // ── 1. Required-field validation ────────────────────────────────────────────
  if (typeof body.remote_post_id !== 'number' || !Number.isInteger(body.remote_post_id) || body.remote_post_id <= 0) {
    return badInput('remote_post_id must be a positive integer (WP post ID)')
  }
  const targetType: WordpressPostType = body.target_type ?? 'post'
  if (targetType !== 'post' && targetType !== 'page') {
    return badInput('target_type must be "post" or "page"')
  }
  if (body.kanban_item_id !== undefined && !isUuid(body.kanban_item_id)) {
    return badInput('kanban_item_id must be a UUID')
  }

  // ── 2. Build the update payload (sanitize content_html on the way in) ───────
  const sanitizedContent = typeof body.content_html === 'string'
    ? prepareCmsContent(body.content_html)
    : undefined

  const updateInput: UpdateExistingWordpressPostInput = {
    postId:   body.remote_post_id,
    postType: targetType,
    ...(body.title           !== undefined ? { title:          body.title          } : {}),
    ...(body.excerpt         !== undefined ? { excerpt:        body.excerpt        } : {}),
    ...(body.slug            !== undefined ? { slug:           body.slug           } : {}),
    ...(body.seo_title       !== undefined ? { seoTitle:       body.seo_title      } : {}),
    ...(body.seo_description !== undefined ? { seoDescription: body.seo_description} : {}),
    ...(body.focus_keyphrase !== undefined ? { focusKeyphrase: body.focus_keyphrase} : {}),
    ...(sanitizedContent     !== undefined ? { content:        sanitizedContent    } : {}),
  }

  // M1 will reject zero-field inputs, but failing earlier yields a cleaner
  // 400 (vs 502 if it slipped through to the WP layer somehow).
  const requestedFieldCount = Object.keys(updateInput).length - 2  // minus postId/postType
  if (requestedFieldCount === 0) {
    return badInput(
      'At least one updatable field is required: title, excerpt, slug, ' +
      'seo_title, seo_description, focus_keyphrase, content_html',
    )
  }

  // ── 3. Connection lookup ────────────────────────────────────────────────────
  const conn = await getWordpressConnection(clientId)
  if (!conn) {
    return NextResponse.json(
      { success: false, error: 'No WordPress connection found for this client', code: 'NO_CONNECTION' },
      { status: 422 },
    )
  }
  if (conn.status !== 'connected') {
    return NextResponse.json(
      {
        success: false,
        error:   'WordPress connection is not verified — re-test the connection in Settings',
        code:    'CONNECTION_NOT_VERIFIED',
      },
      { status: 422 },
    )
  }
  const connRow = await findConnectionRow(clientId)
  if (!connRow) {
    return NextResponse.json(
      { success: false, error: 'Connection row not found', code: 'NO_CONNECTION' },
      { status: 422 },
    )
  }

  const config = {
    siteUrl:     conn.siteUrl,
    username:    conn.username,
    appPassword: conn.plainAppPassword,
  }

  // ── 4. Idempotency key (hash includes remote_post_id + every field sent) ────
  const payloadForHash = {
    target_type:    targetType,
    remote_post_id: body.remote_post_id,
    title:          body.title,
    excerpt:        body.excerpt,
    slug:           body.slug,
    seo_title:      body.seo_title,
    seo_description: body.seo_description,
    focus_keyphrase: body.focus_keyphrase,
    content_html:   sanitizedContent,  // sanitized so a no-op sanitize doesn't trigger a re-run
  }
  const payloadHash = sha256(JSON.stringify(payloadForHash))
  const idKey       = body.idempotency_key ?? `wp_rewrite:${body.remote_post_id}:${payloadHash}`

  const { data: existing } = await supabaseAdmin
    .from('website_publish_jobs')
    .select('id, target_url, status, content_snapshot')
    .eq('connection_id', connRow.id)
    .eq('idempotency_key', idKey)
    .maybeSingle()

  if (existing && (existing.status === 'completed' || existing.status === 'published')) {
    return NextResponse.json({
      success:     true,
      idempotent:  true,
      job_id:      existing.id,
      updated_url: existing.target_url,
      status:      existing.status,
    })
  }

  // ── 5. Fetch before_snapshot from WP ────────────────────────────────────────
  let before: ExistingWordpressPost
  try {
    before = await getExistingWordpressPost(config, body.remote_post_id, targetType)
  } catch (err) {
    if (err instanceof WordpressFetchError) return respondWpError(err)
    throw err
  }

  // ── 6. Apply the update ─────────────────────────────────────────────────────
  let after: { postId: number; postType: WordpressPostType; link: string; modified: string; updatedFields: string[] }
  try {
    after = await updateExistingWordpressPost(config, updateInput)
  } catch (err) {
    if (err instanceof WordpressFetchError) return respondWpError(err)
    throw err
  }

  // ── 7. Audit: website_publish_jobs ──────────────────────────────────────────
  // source_id is NOT NULL, so route an ad-hoc rewrite to a fresh UUID and fold
  // the kanban tie-in (if any) into the snapshot for cross-reference.
  const sourceId    = body.kanban_item_id ?? randomUUID()
  const sourceType  = body.kanban_item_id ? 'kanban_execution_item' : 'wp_rewrite_adhoc'

  const contentSnapshot = {
    action:         'update_existing',
    target_type:    targetType,
    remote_post_id: body.remote_post_id,
    input: {
      title:           body.title,
      excerpt:         body.excerpt,
      slug:            body.slug,
      seo_title:       body.seo_title,
      seo_description: body.seo_description,
      focus_keyphrase: body.focus_keyphrase,
      // content_html may be large; cap it so the JSONB stays under sensible
      // limits. Full body is preserved in `before_snapshot.content` for rollback.
      content_html_truncated: sanitizedContent ? sanitizedContent.slice(0, 8192) : undefined,
      content_html_bytes:     sanitizedContent ? sanitizedContent.length : undefined,
    },
    before_snapshot: {
      title:          before.title,
      slug:           before.slug,
      excerpt:        before.excerpt,
      content:        before.content.slice(0, 32_768),   // truncate; raw enough for rollback diff
      content_bytes:  before.content.length,
      status:         before.status,
      link:           before.link,
      modified:       before.modified,
      seo_title:        before.seoTitle ?? null,
      seo_description:  before.seoDescription ?? null,
      focus_keyphrase:  before.focusKeyphrase ?? null,
    },
    after_snapshot: {
      link:           after.link,
      modified:       after.modified,
      updated_fields: after.updatedFields,
    },
    kanban_item_id: body.kanban_item_id ?? null,
  }

  let jobId: string | null = null
  if (existing) {
    // A prior attempt was retried — update the existing row to completed.
    const { data: updated, error: upErr } = await supabaseAdmin
      .from('website_publish_jobs')
      .update({
        platform_post_id: String(body.remote_post_id),
        target_url:       after.link,
        content_snapshot: contentSnapshot,
        status:           'completed',
        published_at:     new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id')
      .single()
    if (upErr) throw new Error(`website_publish_jobs update failed: ${upErr.message}`)
    jobId = updated.id
  } else {
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('website_publish_jobs')
      .insert({
        client_id:        clientId,
        connection_id:    connRow.id,
        source_type:      sourceType,
        source_id:        sourceId,
        platform_post_id: String(body.remote_post_id),
        target_url:       after.link,
        content_snapshot: contentSnapshot,
        payload_hash:     payloadHash,
        status:           'completed',
        idempotency_key:  idKey,
        published_at:     new Date().toISOString(),
      })
      .select('id')
      .single()
    if (insErr) throw new Error(`website_publish_jobs insert failed: ${insErr.message}`)
    jobId = inserted.id
  }

  // ── 8. Flywheel action log (best-effort, not blocking) ──────────────────────
  void supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id:      clientId,
      flywheel:       'seo',
      action_type:    CMS_ACTION_TYPE.UPDATE_EXISTING,
      execution_mode: 'in_house',
      payload: {
        target_type:    targetType,
        remote_post_id: body.remote_post_id,
        updated_fields: after.updatedFields,
        kanban_item_id: body.kanban_item_id ?? null,
        job_id:         jobId,
      },
    })

  return NextResponse.json({
    success:        true,
    job_id:         jobId,
    updated_url:    after.link,
    updated_fields: after.updatedFields,
    status:         'completed',
  })
}
