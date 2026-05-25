/**
 * POST /api/clients/[id]/cms/publish-wordpress
 *
 * Push a blog post or page to the client's WordPress site.
 * Implements a two-step draft-first flow:
 *
 *   Step 1 — action: "draft"
 *     Creates a remote draft (status='draft') and records a
 *     website_publish_jobs row with status='draft'.
 *     Returns: { job_id, platform_id, preview_url }
 *
 *   Step 2 — action: "publish"
 *     Flips the remote draft to status='publish' and updates the job row
 *     to status='published'.
 *     Requires: platform_id (from step 1), job_id (from step 1)
 *     Returns: { job_id, platform_id, published_url }
 *
 * Idempotency:
 *   The idempotency_key defaults to "{source_type}:{source_id}:{payload_hash}".
 *   Re-submitting the same payload returns the existing job row without creating
 *   a duplicate remote draft.
 *
 * Security:
 *  - INTERNAL_API_KEY bearer required
 *  - Validates client_id ownership of the cms_connection (no tenant cross-read)
 *  - HTML is sanitized (strip script/iframe/event-handlers) before push
 *  - DNS SSRF guard runs inside wordpress-client before every outbound fetch
 *
 * Phase 14.A.5
 */

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireBearerToken } from '@/lib/validation-utils'
import { supabaseAdmin } from '@/lib/supabase'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import {
  createWordpressPostDraft,
  publishWordpressPost,
  createWordpressPageDraft,
  publishWordpressPage,
} from '@/lib/cms/wordpress-client'
import { prepareCmsContent } from '@/lib/cms/html-sanitizer'
import { CMS_ACTION_TYPE } from '@/lib/cms/vocabulary'

interface RouteContext {
  params: { id: string }
}

type TargetType    = 'post' | 'page'
type PublishAction = 'draft' | 'publish'

interface DraftRequestBody {
  action:            'draft'
  source_type:       'blog_post'
  source_id:         string
  target_type:       TargetType
  idempotency_key?:  string
}

interface PublishRequestBody {
  action:      'publish'
  job_id:      string
  platform_id: string
}

type RequestBody = DraftRequestBody | PublishRequestBody

function badInput(msg: string) {
  return NextResponse.json({ success: false, error: msg, code: 'INVALID_INPUT' }, { status: 400 })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

async function fetchBlogPost(blogPostId: string, clientId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin
    .from('blog_posts')
    .select('*')
    .eq('id', blogPostId)
    .eq('client_id', clientId)
    .maybeSingle()
  return data as Record<string, unknown> | null
}

async function findConnection(clientId: string) {
  const conn = await getWordpressConnection(clientId)
  if (!conn) {
    throw Object.assign(
      new Error('No WordPress connection found for this client'),
      { code: 'NO_CONNECTION' },
    )
  }
  if (conn.status !== 'connected') {
    throw Object.assign(
      new Error('WordPress connection is not verified — re-test the connection in Settings'),
      { code: 'CONNECTION_NOT_VERIFIED' },
    )
  }
  return conn
}

async function findConnectionRow(clientId: string) {
  const { data } = await supabaseAdmin
    .from('cms_connections')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'wordpress')
    .maybeSingle()
  return data as { id: string } | null
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const clientId = params.id
  if (!clientId) return badInput('client id required')

  let body: RequestBody
  try {
    body = await req.json() as RequestBody
  } catch {
    return badInput('Invalid JSON body')
  }

  const action = (body as unknown as Record<string, unknown>).action as PublishAction | undefined
  if (action !== 'draft' && action !== 'publish') {
    return badInput('action must be "draft" or "publish"')
  }

  try {
    if (action === 'draft') {
      return await handleDraft(clientId, body as DraftRequestBody)
    } else {
      return await handlePublish(clientId, body as PublishRequestBody)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const code    = (err as Record<string, unknown>).code as string | undefined
    console.error('[publish-wordpress]', clientId, action, message)

    if (code === 'NO_CONNECTION' || code === 'CONNECTION_NOT_VERIFIED') {
      return NextResponse.json({ success: false, error: message, code }, { status: 422 })
    }

    // Surface crypto / auth errors so FDE knows to re-enter credentials.
    if (
      message.includes('authenticate') ||
      message.includes('decrypt') ||
      message.includes('Unsupported state')
    ) {
      return NextResponse.json(
        {
          success: false,
          error:   'WordPress credential decryption failed — please re-enter the Application Password in Settings → Website Connection → WordPress.',
          code:    'DECRYPT_ERROR',
        },
        { status: 422 },
      )
    }

    // WordPress API errors (e.g. 401, 403, unreachable host).
    if (message.startsWith('WordPress ')) {
      return NextResponse.json({ success: false, error: message, code: 'WP_API_ERROR' }, { status: 502 })
    }

    return NextResponse.json(
      { success: false, error: message, code: 'INTERNAL' },
      { status: 500 },
    )
  }
}

// ─── handleDraft ──────────────────────────────────────────────────────────────

async function handleDraft(clientId: string, body: DraftRequestBody): Promise<NextResponse> {
  const { source_type, source_id, target_type } = body

  if (source_type !== 'blog_post') {
    return badInput('source_type must be "blog_post"')
  }
  if (typeof source_id !== 'string' || !source_id.trim()) {
    return badInput('source_id required')
  }
  if (target_type !== 'post' && target_type !== 'page') {
    return badInput('target_type must be "post" or "page"')
  }

  const conn    = await findConnection(clientId)
  const connRow = await findConnectionRow(clientId)
  if (!connRow) throw new Error('Connection row not found')

  const post = await fetchBlogPost(source_id, clientId)
  if (!post) {
    return NextResponse.json(
      { success: false, error: 'Blog post not found', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  const title   = typeof post.title            === 'string' ? post.title            : 'Untitled'
  const rawHtml = typeof post.html_body        === 'string' ? post.html_body        : ''
  const excerpt = typeof post.meta_description === 'string' ? post.meta_description : undefined
  const content = prepareCmsContent(rawHtml)

  const snapshot    = { title, content, excerpt, source_type, source_id, target_type }
  const payloadHash = sha256(JSON.stringify(snapshot))
  const idKey       = body.idempotency_key ?? `${source_type}:${source_id}:${payloadHash}`

  // Idempotency check — return existing job if payload is unchanged.
  const { data: existing } = await supabaseAdmin
    .from('website_publish_jobs')
    .select('id, platform_post_id, target_url, status')
    .eq('connection_id', connRow.id)
    .eq('idempotency_key', idKey)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      success:     true,
      idempotent:  true,
      job_id:      existing.id,
      platform_id: existing.platform_post_id,
      preview_url: existing.target_url,
      status:      existing.status,
    })
  }

  const config = {
    siteUrl:     conn.siteUrl,
    username:    conn.username,
    appPassword: conn.plainAppPassword,
  }

  let platformId: string
  let previewUrl: string

  if (target_type === 'post') {
    const draft = await createWordpressPostDraft(config, { title, content, excerpt })
    platformId = draft.platformId
    previewUrl = draft.previewUrl
  } else {
    const draft = await createWordpressPageDraft(config, { title, content, excerpt })
    platformId = draft.platformId
    previewUrl = draft.previewUrl
  }

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('website_publish_jobs')
    .insert({
      client_id:        clientId,
      connection_id:    connRow.id,
      source_type:      'blog_post',
      source_id,
      platform_post_id: platformId,
      target_url:       previewUrl,
      content_snapshot: snapshot,
      payload_hash:     payloadHash,
      status:           'draft',
      idempotency_key:  idKey,
    })
    .select('id')
    .single()

  if (jobErr) throw new Error(`website_publish_jobs insert failed: ${jobErr.message}`)

  return NextResponse.json({
    success:     true,
    job_id:      job.id,
    platform_id: platformId,
    preview_url: previewUrl,
    status:      'draft',
  })
}

// ─── handlePublish ────────────────────────────────────────────────────────────

async function handlePublish(clientId: string, body: PublishRequestBody): Promise<NextResponse> {
  const { job_id } = body

  if (typeof job_id !== 'string' || !job_id.trim()) {
    return badInput('job_id required')
  }

  // Verify the job belongs to this client (tenant isolation).
  const { data: job } = await supabaseAdmin
    .from('website_publish_jobs')
    .select('id, client_id, status, content_snapshot, connection_id, platform_post_id')
    .eq('id', job_id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!job) {
    return NextResponse.json(
      { success: false, error: 'Job not found', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  const platformId = job.platform_post_id as string

  if (job.status === 'published') {
    return NextResponse.json({
      success: true, job_id, platform_id: platformId, status: 'published', note: 'already published',
    })
  }
  if (job.status === 'rolled_back' || job.status === 'failed') {
    return NextResponse.json(
      { success: false, error: `Job is in terminal state: ${job.status}`, code: 'INVALID_STATE' },
      { status: 422 },
    )
  }

  const conn    = await findConnection(clientId)
  const connRow = await findConnectionRow(clientId)
  if (!connRow) throw new Error('Connection row not found')

  // Ensure the job targets the current WP connection (guards against stale or swapped connections).
  if (job.connection_id !== connRow.id) {
    return NextResponse.json(
      {
        success: false,
        error:   'Job connection mismatch — re-draft against the current WordPress connection',
        code:    'CONNECTION_MISMATCH',
      },
      { status: 409 },
    )
  }

  const config = {
    siteUrl:     conn.siteUrl,
    username:    conn.username,
    appPassword: conn.plainAppPassword,
  }

  const snapshot   = (job.content_snapshot ?? {}) as Record<string, unknown>
  const targetType = (snapshot.target_type as string) ?? 'post'

  if (targetType === 'post') {
    await publishWordpressPost(config, platformId)
  } else {
    await publishWordpressPage(config, platformId)
  }

  const now = new Date().toISOString()

  await supabaseAdmin
    .from('website_publish_jobs')
    .update({ status: 'published', published_at: now })
    .eq('id', job_id)

  // Record in flywheel_actions so the SEO flywheel tracks the content publish.
  void supabaseAdmin
    .from('flywheel_actions')
    .insert({
      client_id:      clientId,
      flywheel:       'seo',
      action_type:    CMS_ACTION_TYPE.CONTENT_INSERT,
      execution_mode: 'in_house',
      status:         'done',
      payload:        {
        job_id,
        platform:    'wordpress',
        platform_id: platformId,
        source_id:   snapshot.source_id ?? null,
      },
    })
    .then(({ error }) => {
      if (error) console.error('[publish-wordpress] flywheel insert failed', error.message)
    })

  return NextResponse.json({ success: true, job_id, platform_id: platformId, status: 'published' })
}
