/**
 * POST /api/clients/[id]/cms/publish-shopify
 *
 * Push a blog post or page to the client's Shopify store.
 * Implements a two-step draft-first flow:
 *
 *   Step 1 — action: "draft"
 *     Creates a remote draft (published: false) and records a
 *     website_publish_jobs row with status='draft'.
 *     Returns: { job_id, platform_id, preview_url }
 *
 *   Step 2 — action: "publish"
 *     Flips the remote draft to published and updates the job row
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
 *  - Validates client_id ownership of the cms_connection
 *  - HTML is sanitized (strip script/iframe/event-handlers) before push
 *
 * Phase 14.A.4
 */

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getShopifyConnection } from '@/lib/cms/connection-store'
import {
  createShopifyArticleDraft,
  publishShopifyArticle,
  createShopifyPageDraft,
  publishShopifyPage,
  getOrCreateDefaultBlog,
} from '@/lib/cms/shopify-client'
import { prepareCmsContent } from '@/lib/cms/html-sanitizer'
import { buildArticleSchemaScript } from '@/lib/blog/html-builder'
import type { ArticleSchemaPost } from '@/lib/blog/html-builder'
import { CMS_ACTION_TYPE } from '@/lib/cms/vocabulary'

interface RouteContext {
  params: { id: string }
}

type TargetType = 'article' | 'page'
type PublishAction = 'draft' | 'publish'

interface DraftRequestBody {
  action:         'draft'
  source_type:    'blog_post'
  source_id:      string
  target_type:    TargetType
  blog_id?:       number
  idempotency_key?: string
}

interface PublishRequestBody {
  action:       'publish'
  job_id:       string
  platform_id:  string
  blog_id?:     number
}

type RequestBody = DraftRequestBody | PublishRequestBody

function badInput(msg: string) {
  return NextResponse.json({ success: false, error: msg, code: 'INVALID_INPUT' }, { status: 400 })
}

// ─── helpers ─────────────────────────────────────────────────────────────────

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
  const conn = await getShopifyConnection(clientId)
  if (!conn) {
    throw Object.assign(new Error('No Shopify connection found for this client'), { code: 'NO_CONNECTION' })
  }
  if (conn.status !== 'connected') {
    throw Object.assign(new Error('Shopify connection is not verified — re-test the connection'), { code: 'CONNECTION_NOT_VERIFIED' })
  }
  return conn
}

async function findConnectionRow(clientId: string) {
  const { data } = await supabaseAdmin
    .from('cms_connections')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'shopify')
    .maybeSingle()
  return data as { id: string } | null
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

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
    console.error('[publish-shopify]', clientId, action, message)

    if (code === 'NO_CONNECTION' || code === 'CONNECTION_NOT_VERIFIED') {
      return NextResponse.json({ success: false, error: message, code }, { status: 422 })
    }
    return NextResponse.json({ success: false, error: 'Unexpected error', code: 'INTERNAL' }, { status: 500 })
  }
}

// ─── handleDraft ──────────────────────────────────────────────────────────────

async function handleDraft(clientId: string, body: DraftRequestBody): Promise<NextResponse> {
  const { source_type, source_id, target_type, blog_id: requestedBlogId } = body

  if (source_type !== 'blog_post') {
    return badInput('source_type must be "blog_post"')
  }
  if (typeof source_id !== 'string' || !source_id.trim()) {
    return badInput('source_id required')
  }
  if (target_type !== 'article' && target_type !== 'page') {
    return badInput('target_type must be "article" or "page"')
  }

  const conn      = await findConnection(clientId)
  const connRow   = await findConnectionRow(clientId)
  if (!connRow) throw new Error('Connection row not found')

  const post = await fetchBlogPost(source_id, clientId)
  if (!post) {
    return NextResponse.json({ success: false, error: 'Blog post not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const title       = typeof post.title             === 'string' ? post.title             : 'Untitled'
  const rawHtml     = typeof post.html_body         === 'string' ? post.html_body         : ''
  const geoSnapshot = typeof post.geo_html_snapshot === 'string' ? post.geo_html_snapshot : ''
  const summary     = typeof post.meta_description  === 'string' ? post.meta_description  : undefined

  // P14.C.4: JSON-LD BlogPosting schema + GEO directive injected AFTER sanitization
  // so script tag and GEO style/aria attrs survive intact.
  const schemaScript = buildArticleSchemaScript(post as ArticleSchemaPost, conn.shopUrl)
  const bodyHtml     = [
    prepareCmsContent(rawHtml),
    geoSnapshot,
    schemaScript,
  ].filter(Boolean).join('\n')

  const snapshot    = { title, bodyHtml, summary, source_type, source_id, target_type }
  const payloadHash = sha256(JSON.stringify(snapshot))
  const idKey       = body.idempotency_key ?? `${source_type}:${source_id}:${payloadHash}`

  // Check for existing job (idempotency).
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

  const config = { shopUrl: conn.shopUrl, accessToken: conn.plainToken }

  let platformId: string
  let previewUrl: string

  if (target_type === 'article') {
    const blogId = requestedBlogId ?? (await getOrCreateDefaultBlog(config))
    const draft  = await createShopifyArticleDraft(config, { blogId, title, bodyHtml, summary })
    platformId = draft.platformId
    previewUrl = draft.previewUrl
  } else {
    const draft = await createShopifyPageDraft(config, { title, bodyHtml, metaDescription: summary })
    platformId = draft.platformId
    previewUrl = draft.previewUrl
  }

  const { data: job, error: jobErr } = await supabaseAdmin
    .from('website_publish_jobs')
    .insert({
      client_id:        clientId,
      connection_id:    connRow.id,
      source_type:      'blog_post',
      source_id:        source_id,
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
  const { job_id, blog_id: blogId } = body

  if (typeof job_id !== 'string' || !job_id.trim()) {
    return badInput('job_id required')
  }

  // Load and verify the job belongs to this client.
  const { data: job } = await supabaseAdmin
    .from('website_publish_jobs')
    .select('id, client_id, status, connection_id, platform_post_id, content_snapshot')
    .eq('id', job_id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!job) {
    return NextResponse.json({ success: false, error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const platformId = job.platform_post_id as string

  if (job.status === 'published') {
    return NextResponse.json({ success: true, job_id, platform_id: platformId, status: 'published', note: 'already published' })
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

  // Ensure the job targets the current Shopify connection (guards against stale or swapped connections).
  if (job.connection_id !== connRow.id) {
    return NextResponse.json(
      {
        success: false,
        error:   'Job connection mismatch — re-draft against the current Shopify connection',
        code:    'CONNECTION_MISMATCH',
      },
      { status: 409 },
    )
  }

  const config     = { shopUrl: conn.shopUrl, accessToken: conn.plainToken }
  const snapshot   = (job.content_snapshot ?? {}) as Record<string, unknown>
  const targetType = (snapshot.target_type as string) ?? 'article'

  if (targetType === 'article') {
    const resolvedBlogId = blogId ?? (await getOrCreateDefaultBlog(config))
    await publishShopifyArticle(config, resolvedBlogId, platformId)
  } else {
    await publishShopifyPage(config, platformId)
  }

  await supabaseAdmin
    .from('website_publish_jobs')
    .update({
      status:       'published',
      published_at: new Date().toISOString(),
    })
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
        platform:    'shopify',
        platform_id: platformId,
        target_type: targetType,
        source_id:   snapshot.source_id ?? null,
      },
    })
    .then(({ error }) => {
      if (error) console.error('[publish-shopify] flywheel insert failed', error.message)
    })

  return NextResponse.json({
    success:    true,
    job_id,
    platform_id: platformId,
    status:      'published',
  })
}
