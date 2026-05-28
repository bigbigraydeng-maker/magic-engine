import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateBlogPost } from '@/lib/blog/generator'
import type { BlogGeneratorOutput } from '@/lib/blog/generator'
import { auditExistingContent } from '@/lib/blog/content-auditor'
import { fetchRelatedPages, buildPagesContextBlock } from '@/lib/blog/pages-context'
import { auditBlogPost } from '@/lib/blog/quality-audit'
import type { BlogAuditMetadata } from '@/lib/blog/quality-audit'
import { checkInternalLinks } from '@/lib/blog/internal-link-checker'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { getActiveCampaigns } from '@/lib/content/campaign-injector'
import { clampLimit } from '@/lib/validation-utils'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { SeoContentAdapter } from '@/lib/flywheel/adapters/SeoContentAdapter'
import { SEO_ACTION_TYPE, SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import type { BlogPost, GenerateBlogRequest } from '@/types/magic-engine'

/**
 * GET /api/clients/[id]/blog
 * List blog posts for a client, newest first.
 * Query: ?status=draft|approved|published|rejected|generating|failed  (omit for all)
 *        &limit=20  (max 100)
 *
 * POST /api/clients/[id]/blog
 * Queue a new blog post for background generation.
 * Returns immediately with { action: 'queued', post_id } while AI runs in background.
 * The post appears in the list with status='generating' then transitions to 'draft'.
 *
 * Content Audit:
 *   Before queuing, the handler synchronously checks whether a post with the same
 *   intent already exists on the client's domain. If so, returns
 *   { success: true, action: 'upgrade', audit } without creating a post.
 *   The caller can pass skip_audit: true to bypass this check.
 *
 * Security: All endpoints require a valid Bearer token (INTERNAL_API_KEY).
 * Reference: ROADMAP.md P7.3.8
 */

interface ClientRow {
  id: string
  name: string
  domain: string | null
}

interface SupabaseErrorLike {
  code?: string
  message?: string
  details?: string
  hint?: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const status = req.nextUrl.searchParams.get('status')
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
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
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

    // ── Content Audit (synchronous — fast feedback before queuing) ─────────────
    if (!body.skip_audit) {
      const { data: clientData } = await supabaseAdmin
        .from('clients')
        .select('id, name, domain')
        .eq('id', clientId)
        .single<ClientRow>()

      if (clientData?.domain) {
        const audit = await auditExistingContent(
          clientData.domain,
          body.topic,
          body.source_query_text,
          clientId
        ).catch(() => null)

        if (audit?.action === 'upgrade') {
          return NextResponse.json({ success: true, action: 'upgrade', audit, post: null })
        }
      }
    }

    // ── Insert placeholder with status='generating', return immediately ────────
    const { data: placeholder, error: insertErr } = await supabaseAdmin
      .from('blog_posts')
      .insert({
        client_id:         clientId,
        mode,
        topic:             body.topic.slice(0, 400),
        source_query_id:   body.source_query_id   ?? null,
        source_query_text: body.source_query_text ?? null,
        primary_keyword:   body.primary_keyword   ?? null,
        keyword_volume:    body.keyword_volume    ?? null,
        keyword_kd:        body.keyword_kd        ?? null,
        keyword_intent:    body.keyword_intent    ?? null,
        status:            'generating',
      })
      .select('id')
      .single()

    if (insertErr || !placeholder) {
      console.error('[blog POST] placeholder insert error:', insertErr)
      return NextResponse.json(
        { success: false, error: 'Failed to queue blog post' },
        { status: 500 }
      )
    }

    // Fire background generation — intentionally not awaited
    void runGenerationBackground(clientId, body, mode, placeholder.id)

    return NextResponse.json({ success: true, action: 'queued', post_id: placeholder.id })

  } catch (err: unknown) {
    console.error('[blog POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ─── Background generation ────────────────────────────────────────────────────

async function runGenerationBackground(
  clientId: string,
  body: GenerateBlogRequest,
  mode: string,
  postId: string,
) {
  try {
    // Load client domain for internal link checker (P14.B.4).
    const { data: clientRow } = await supabaseAdmin
      .from('clients')
      .select('domain')
      .eq('id', clientId)
      .maybeSingle<{ domain: string | null }>()

    const relatedPages = await fetchRelatedPages(clientId, body.topic).catch(() => [])
    const existingPagesContext = buildPagesContextBlock(relatedPages)

    const { result, qualityScore, contextSnapshot } = await generateWithQualityRetry(
      { ...body, mode, client_id: clientId, existing_pages_context: existingPagesContext || undefined },
      mode,
    )

    // P14.B.4: internal link quality check — persisted to quality_check JSONB column.
    const internalLinkCheck = checkInternalLinks(result.html_body, clientRow?.domain ?? null)

    await updateGeneratedPost(postId, result, qualityScore, contextSnapshot, internalLinkCheck)
    await linkStrategyItemToPost(clientId, body.strategy_item_id, postId)

    if (body.production_package_id) {
      await linkProductionPackage(clientId, body.production_package_id, postId)
    }

    try {
      await new SeoContentAdapter().execute({
        clientId,
        actionType:          SEO_ACTION_TYPE.PUBLISH_BLOG,
        executionMode:       'in_house',
        payload: {
          triggered_by:    'blog_generation',
          blog_post_id:    postId,
          mode,
          primary_keyword: body.primary_keyword ?? null,
        },
        expectedMetric:      SEO_METRIC_KEY.ORGANIC_TRAFFIC,
        productionPackageId: body.production_package_id,
      })
    } catch (err) {
      console.error('[blog background] flywheel action failed (non-blocking):', err)
    }

  } catch (err) {
    console.error('[blog background] Generation failed for post', postId, ':', err)
    await supabaseAdmin
      .from('blog_posts')
      .update({ status: 'failed' })
      .eq('id', postId)
      .catch(e => console.error('[blog background] status→failed update error:', e))
  }
}

async function updateGeneratedPost(
  postId: string,
  result: BlogGeneratorOutput,
  qualityScore: number | null,
  contextSnapshot: Record<string, unknown> | null,
  internalLinkCheck?: { count: number; level: string; pass: boolean; detail: string; computed_at: string },
) {
  const payload: Record<string, unknown> = {
    title:                       result.title,
    meta_title:                  result.meta_title,
    meta_description:            result.meta_description,
    slug:                        result.slug,
    html_body:                   result.html_body,
    word_count:                  result.word_count,
    geo_directive_id:            result.geo_directive_id,
    geo_html_snapshot:           result.geo_html_snapshot,
    featured_image_prompt:       result.featured_image_prompt,
    cost_usd:                    result.cost_usd,
    model_used:                  result.model_used,
    status:                      'draft',
    generation_context_snapshot: contextSnapshot,
    quality_score:               qualityScore,
    // P14.B.4: persist internal link QC result
    quality_check: internalLinkCheck ? { internal_link: internalLinkCheck } : null,
  }

  let { error } = await supabaseAdmin
    .from('blog_posts')
    .update(payload)
    .eq('id', postId)

  if (error && isMissingQualityColumnsError(error)) {
    console.warn('[blog background] quality columns missing; retrying without quality metadata')
    const fallback = { ...payload }
    delete fallback.generation_context_snapshot
    delete fallback.quality_score
    delete fallback.quality_check
    const { error: e2 } = await supabaseAdmin
      .from('blog_posts').update(fallback).eq('id', postId)
    error = e2
  }

  if (error) {
    console.error('[blog background] DB update error:', error)
    throw new Error('Failed to save generated post')
  }
}

async function linkProductionPackage(
  clientId: string,
  productionPackageId: string,
  postId: string,
) {
  const { data: item, error: itemErr } = await supabaseAdmin
    .from('production_items')
    .insert({
      package_id:   productionPackageId,
      client_id:    clientId,
      content_type: 'blog_post',
      blog_post_id: postId,
      sort_order:   0,
      status:       'ready',
    })
    .select('id')
    .single()

  if (itemErr) {
    console.error('[blog background] production_items insert error:', JSON.stringify(itemErr))
    return
  }

  if (item) {
    supabaseAdmin
      .from('blog_posts')
      .update({ production_item_id: item.id })
      .eq('id', postId)
      .then(
        () => {},
        (err: unknown) => console.error('[blog background] production_item_id back-ref error:', err)
      )
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

      if (!audit) break

      qualityScore = audit.rubricResult.overallScore
      contextSnapshot = { ...audit.contextSnapshot, attempts: attempt }

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

async function linkStrategyItemToPost(
  clientId: string,
  strategyItemId: string | undefined,
  postId: string,
) {
  if (!strategyItemId) return

  const { error } = await supabaseAdmin
    .from('content_strategy_items')
    .update({ status: 'done', linked_blog_post_id: postId })
    .eq('id', strategyItemId)
    .eq('client_id', clientId)
    .eq('action_type', 'new_blog')

  if (error) {
    console.error('[blog background] strategy item link failed (non-blocking):', error)
  }
}

function isMissingQualityColumnsError(err: SupabaseErrorLike): boolean {
  const text = [err.code, err.message, err.details, err.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()

  const mentionsQualityColumn =
    text.includes('generation_context_snapshot') ||
    text.includes('quality_score') ||
    text.includes('quality_check')

  return mentionsQualityColumn && (
    text.includes('pgrst204') ||
    text.includes('42703') ||
    text.includes('schema cache') ||
    text.includes('column')
  )
}
