/**
 * POST /api/clients/[id]/site-audit/pages/[pageId]/rescan
 *
 * Triggers a re-crawl, re-classification, and GEO re-detection for a single page.
 * Updates the client_site_pages record with fresh data and returns the updated row.
 *
 * Flow:
 *   1. Verify client + page exist (multi-tenant isolation via client_id)
 *   2. Crawl the page URL via Jina Reader (crawlPages with limit=1)
 *   3. Classify the page type via OpenAI
 *   4. Detect GEO block via detectGEOBlock
 *   5. Update client_site_pages with fresh data
 *   6. Return the updated page record
 *
 * Reference: ROADMAP.md P8.0.8-Phase1 Step 4
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { crawlPages } from '@/lib/site-audit/crawler'
import { classifyPage } from '@/lib/site-audit/classifier'
import { detectGEOBlock } from '@/lib/site-audit/geo-detector'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const maxDuration = 120

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; pageId: string } }
): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const clientId = params.id
  const pageId = params.pageId

  try {
    // 1. Verify client exists and has a domain
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id, domain')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Client not found' },
        { status: 404 }
      )
    }

    // 2. Fetch the page (enforces multi-tenant isolation via client_id)
    const { data: page, error: pageError } = await supabaseAdmin
      .from('client_site_pages')
      .select('id, url, client_id')
      .eq('id', pageId)
      .eq('client_id', clientId)
      .single()

    if (pageError) {
      if (pageError.code === 'PGRST116') {
        return NextResponse.json<ApiErrorResponse>(
          { error: 'Page not found' },
          { status: 404 }
        )
      }
      throw new Error(`Failed to fetch page: ${pageError.message}`)
    }

    if (!page) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Page not found' },
        { status: 404 }
      )
    }

    // 3. Re-crawl the URL via Jina Reader
    const crawlResults = await crawlPages([page.url], {
      limit: 1,
      rateLimitMs: 0,
    })

    const crawlResult = crawlResults[0]
    if (!crawlResult || crawlResult.error) {
      throw new Error(
        `Failed to crawl page: ${crawlResult?.error ?? 'No result returned'}`
      )
    }

    // 4. Re-classify page type
    const classification = await classifyPage(
      crawlResult.url,
      crawlResult.title || page.url,
      crawlResult.markdown || ''
    )

    // 5. Re-detect GEO block
    const geoInfo = detectGEOBlock(crawlResult.markdown)

    // 6. Calculate word count
    const wordCount = crawlResult.markdown
      ? crawlResult.markdown.trim().split(/\s+/).filter(Boolean).length
      : 0

    // 7. Update the DB record
    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('client_site_pages')
      .update({
        title: crawlResult.title || page.url,
        markdown_content: crawlResult.markdown,
        word_count: wordCount,
        page_type: classification.page_type,
        topics: classification.topics,
        primary_keyword: classification.primary_keyword,
        classification_confidence: classification.confidence,
        has_geo_block: geoInfo.has_geo_block,
        geo_detection_method: geoInfo.detection_method,
        geo_confidence: geoInfo.confidence,
        status_code: crawlResult.statusCode,
        crawled_at: crawlResult.crawledAt.toISOString(),
        updated_at: now,
      })
      .eq('id', pageId)
      .eq('client_id', clientId)
      .select()
      .single()

    if (updateError) {
      throw new Error(`Failed to update page: ${updateError.message}`)
    }

    return NextResponse.json(updated, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/pages/rescan] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
