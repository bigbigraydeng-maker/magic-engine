import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateBlogPost } from '@/lib/blog/generator'
import { auditExistingContent } from '@/lib/blog/content-auditor'
import { fetchRelatedPages, buildPagesContextBlock } from '@/lib/blog/pages-context'
import { requireBearerToken, clampLimit } from '@/lib/validation-utils'
import type { BlogPost, GenerateBlogRequest } from '@/types/magic-engine'

/**
 * GET /api/clients/[id]/blog
 * List blog posts for a client, newest first.
 * Query: ?status=draft|approved|published|rejected  (omit for all)
 *        &limit=20  (max 100)
 *
 * POST /api/clients/[id]/blog
 * Generate a new blog post (stored as 'draft').
 * Body: GenerateBlogRequest
 *
 * Content Audit:
 *   Before generating, the handler fetches the client's domain and checks
 *   whether a post with the same intent already exists. If so, it returns
 *   { success: true, action: 'upgrade', audit } without generating a new post.
 *   The caller can pass skip_audit: true to bypass this check.
 *
 * Security: All endpoints require a valid Bearer token (INTERNAL_API_KEY).
 * Error messages returned to callers are generic — DB schema details are
 * only written to server-side logs.
 *
 * Reference: ROADMAP.md P7.3.8
 */

interface ClientRow {
  id: string
  name: string
  domain: string | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const clientId = params.id
    const status = req.nextUrl.searchParams.get('status')
    // HIGH-1: clamp limit to prevent unbounded DB queries
    const limit = clampLimit(req.nextUrl.searchParams.get('limit'))

    let query = supabaseAdmin
      .from('blog_posts')
      .select(
        'id, mode, topic, source_query_text, title, meta_title, slug, ' +
        'word_count, status, featured_image_url, cost_usd, created_at, updated_at'
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)

    const { data, error } = await query

    if (error) {
      // HIGH-3: log details server-side, return generic message to caller
      console.error('[blog GET] Supabase error:', error)
      return NextResponse.json({ success: false, error: 'Failed to retrieve blog posts' }, { status: 500 })
    }

    return NextResponse.json({ success: true, posts: data ?? [] })
  } catch (err: unknown) {
    console.error('[blog GET] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const clientId = params.id
    const body = (await req.json()) as GenerateBlogRequest

    if (!body.topic?.trim()) {
      return NextResponse.json(
        { success: false, error: 'topic is required' },
        { status: 400 }
      )
    }

    const validModes = ['unified', 'geo_only', 'seo_only']
    const mode = body.mode ?? 'geo_only'
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { success: false, error: `mode must be one of: ${validModes.join(', ')}` },
        { status: 400 }
      )
    }

    // ── Content Audit (pre-generation) ────────────────────────────────────────
    // Skip if caller explicitly opts out (e.g. user clicked "Generate Anyway")
    if (!body.skip_audit) {
      const { data: clientData } = await supabaseAdmin
        .from('clients')
        .select('id, name, domain')
        .eq('id', clientId)
        .single<ClientRow>()

      const domain = clientData?.domain

      if (domain) {
        const audit = await auditExistingContent(
          domain,
          body.topic,
          body.source_query_text,
          clientId
        ).catch(() => null) // audit failure must never block generation

        if (audit?.action === 'upgrade') {
          // Return early — UI should show upgrade recommendation card
          return NextResponse.json({
            success: true,
            action: 'upgrade',
            audit,
            post: null,
          })
        }

        // action === 'new' — proceed with generation, attach audit info to response
        const relatedPages = await fetchRelatedPages(clientId, body.topic).catch(() => [])
        const existingPagesContext = buildPagesContextBlock(relatedPages)
        const result = await generateBlogPost({ ...body, mode, client_id: clientId, existing_pages_context: existingPagesContext || undefined })
        return await persistAndReturn(clientId, body, mode, result, audit)
      }
    }

    // ── Generate (no domain set, or audit skipped) ────────────────────────────
    const relatedPages = await fetchRelatedPages(clientId, body.topic).catch(() => [])
    const existingPagesContext = buildPagesContextBlock(relatedPages)
    const result = await generateBlogPost({ ...body, mode, client_id: clientId, existing_pages_context: existingPagesContext || undefined })
    return await persistAndReturn(clientId, body, mode, result, null)

  } catch (err: unknown) {
    console.error('[blog POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function persistAndReturn(
  clientId: string,
  body: GenerateBlogRequest,
  mode: string,
  result: Awaited<ReturnType<typeof generateBlogPost>>,
  audit: Awaited<ReturnType<typeof auditExistingContent>> | null
) {
  const { data: post, error: dbErr } = await supabaseAdmin
    .from('blog_posts')
    .insert({
      client_id:          clientId,
      mode,
      topic:              body.topic.slice(0, 400),
      source_query_id:    body.source_query_id   ?? null,
      source_query_text:  body.source_query_text ?? null,
      title:              result.title,
      meta_title:         result.meta_title,
      meta_description:   result.meta_description,
      slug:               result.slug,
      html_body:          result.html_body,
      word_count:         result.word_count,
      geo_directive_id:   result.geo_directive_id,
      geo_html_snapshot:  result.geo_html_snapshot,
      featured_image_prompt: result.featured_image_prompt,
      cost_usd:           result.cost_usd,
      model_used:         result.model_used,
      status:             'draft',
    })
    .select('*')
    .single<BlogPost>()

  if (dbErr || !post) {
    // HIGH-3: log DB details server-side only
    console.error('[blog persistAndReturn] DB insert error:', dbErr)
    return NextResponse.json(
      { success: false, error: 'Failed to save blog post' },
      { status: 500 }
    )
  }

  // Link to production package if specified (best-effort, non-blocking on error)
  if (body.production_package_id) {
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('production_items')
      .insert({
        package_id:    body.production_package_id,
        client_id:     clientId,
        content_type:  'blog_post',
        blog_post_id:  post.id,
        sort_order:    0,
        status:        'ready',
      })
      .select('id')
      .single()

    if (itemErr) {
      console.error('[blog persistAndReturn] production_items insert error:', JSON.stringify(itemErr))
    } else if (item) {
      await supabaseAdmin
        .from('blog_posts')
        .update({ production_item_id: item.id })
        .eq('id', post.id)
        .catch(err => console.error('[blog persistAndReturn] production_item_id back-ref error:', err))
    }
  }

  return NextResponse.json({
    success: true,
    action: 'new',
    post,
    audit,
    cost_usd: result.cost_usd,
  })
}
