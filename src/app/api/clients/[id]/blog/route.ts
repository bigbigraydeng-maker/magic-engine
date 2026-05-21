import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateBlogPost } from '@/lib/blog/generator'
import type { BlogGeneratorOutput } from '@/lib/blog/generator'
import { auditExistingContent } from '@/lib/blog/content-auditor'
import { fetchRelatedPages, buildPagesContextBlock } from '@/lib/blog/pages-context'
import { auditBlogPost } from '@/lib/blog/quality-audit'
import type { BlogAuditMetadata } from '@/lib/blog/quality-audit'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { getActiveCampaigns } from '@/lib/content/campaign-injector'
import { requireBearerToken, clampLimit } from '@/lib/validation-utils'
import { SeoContentAdapter } from '@/lib/flywheel/adapters/SeoContentAdapter'
import { SEO_ACTION_TYPE, SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
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
        const { result, qualityScore, contextSnapshot } = await generateWithQualityRetry(
          { ...body, mode, client_id: clientId, existing_pages_context: existingPagesContext || undefined },
          mode,
        )
        return await persistAndReturn(clientId, body, mode, result, audit, qualityScore, contextSnapshot)
      }
    }

    // ── Generate (no domain set, or audit skipped) ────────────────────────────
    const relatedPages = await fetchRelatedPages(clientId, body.topic).catch(() => [])
    const existingPagesContext = buildPagesContextBlock(relatedPages)
    const { result, qualityScore, contextSnapshot } = await generateWithQualityRetry(
      { ...body, mode, client_id: clientId, existing_pages_context: existingPagesContext || undefined },
      mode,
    )
    return await persistAndReturn(clientId, body, mode, result, null, qualityScore, contextSnapshot)

  } catch (err: unknown) {
    console.error('[blog POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a blog post with up to 2 quality-rubric retries (3 attempts total).
 * If the post never passes the quality threshold, returns the last result + logs a warning.
 * On any audit error, proceeds immediately with the last generated result (non-blocking).
 */
async function generateWithQualityRetry(
  req: GenerateBlogRequest & { client_id: string; mode: string; existing_pages_context?: string },
  mode: string,
): Promise<{
  result: BlogGeneratorOutput
  qualityScore: number | null
  contextSnapshot: Record<string, unknown> | null
}> {
  const [brief, campaigns] = await Promise.all([
    getActiveBrief(req.client_id).catch(() => null),
    getActiveCampaigns(req.client_id).catch(() => []),
  ])
  const campaign = campaigns[0] ?? null

  const metadata: BlogAuditMetadata = {
    brand_name:       brief?.brand_name ?? null,
    tone:             brief?.tone ?? null,
    avoid_words:      brief?.avoid_words ?? null,
    platforms:        brief?.platforms ?? null,
    primary_audience: brief?.primary_audience ?? null,
    campaign: campaign ? {
      title:                  campaign.title ?? null,
      offer:                  campaign.offer ?? null,
      primary_cta:            campaign.primary_cta ?? null,
      campaign_angle:         campaign.campaign_angle ?? null,
      target_audience_detail: campaign.target_audience_detail ?? null,
    } : null,
    primaryKeyword: req.primary_keyword ?? null,
  }

  const MAX_ATTEMPTS = 3
  let lastResult: BlogGeneratorOutput | null = null
  let qualityScore: number | null = null
  let contextSnapshot: Record<string, unknown> | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastResult = await generateBlogPost(req)

    try {
      const content = lastResult.html_body + '\n' + (lastResult.geo_html_snapshot ?? '')
      const audit = await auditBlogPost(content, mode, metadata)

      if (!audit) break  // skipped (no API key) — proceed without retry

      qualityScore = audit.rubricResult.overallScore
      contextSnapshot = {
        ...audit.contextSnapshot,
        attempts: attempt,
      }

      if (audit.rubricResult.pass || attempt === MAX_ATTEMPTS) {
        if (!audit.rubricResult.pass) {
          console.warn(
            `[blog quality] Post failed quality threshold after ${attempt} attempt(s)` +
            ` (score: ${audit.rubricResult.overallScore}). Proceeding with last result.`
          )
        }
        break
      }
    } catch (err) {
      console.error('[blog quality] Audit error (non-blocking):', err)
      break
    }
  }

  return { result: lastResult!, qualityScore, contextSnapshot }
}

async function persistAndReturn(
  clientId: string,
  body: GenerateBlogRequest,
  mode: string,
  result: BlogGeneratorOutput,
  audit: Awaited<ReturnType<typeof auditExistingContent>> | null,
  qualityScore: number | null,
  contextSnapshot: Record<string, unknown> | null,
) {
  const { data: post, error: dbErr } = await supabaseAdmin
    .from('blog_posts')
    .insert({
      client_id:          clientId,
      mode,
      topic:              body.topic.slice(0, 400),
      source_query_id:    body.source_query_id   ?? null,
      source_query_text:  body.source_query_text ?? null,
      // P12.I.5: persist keyword metadata (SEMrush signal for SEO/unified posts)
      primary_keyword:    body.primary_keyword   ?? null,
      keyword_volume:     body.keyword_volume    ?? null,
      keyword_kd:         body.keyword_kd        ?? null,
      keyword_intent:     body.keyword_intent    ?? null,
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
      generation_context_snapshot: contextSnapshot,
      quality_score:      qualityScore,
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
      supabaseAdmin
        .from('blog_posts')
        .update({ production_item_id: item.id })
        .eq('id', post.id)
        .then(
          () => {},
          (err: unknown) => console.error('[blog persistAndReturn] production_item_id back-ref error:', err)
        )
    }
  }

  // P12.I.5: record an SEO flywheel action so blog generation feeds the flywheel
  // data loop. Non-blocking — the post is already persisted, so a flywheel write
  // failure must never fail the request.
  try {
    await new SeoContentAdapter().execute({
      clientId,
      actionType:    SEO_ACTION_TYPE.PUBLISH_BLOG,
      executionMode: 'in_house',
      payload: {
        triggered_by:    'blog_generation',
        blog_post_id:    post.id,
        mode,
        primary_keyword: body.primary_keyword ?? null,
      },
      expectedMetric:      SEO_METRIC_KEY.ORGANIC_TRAFFIC,
      productionPackageId: body.production_package_id,
    })
  } catch (err) {
    console.error('[blog persistAndReturn] flywheel action write failed (non-blocking):', err)
  }

  return NextResponse.json({
    success: true,
    action: 'new',
    post,
    audit,
    cost_usd: result.cost_usd,
  })
}
