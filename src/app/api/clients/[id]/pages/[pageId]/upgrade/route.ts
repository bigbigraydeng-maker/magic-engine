/**
 * POST /api/clients/[id]/pages/[pageId]/upgrade
 *
 * Generates an SEO + GEO enhanced version of an existing client page.
 * Steps:
 *   1. Verify page exists and belongs to client
 *   2. Call generatePageUpgrade (Jina fetch + Claude rewrite)
 *   3. Return the upgrade diff — persistence happens when user approves in UI
 *
 * Phase 8.2.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generatePageUpgrade } from '@/lib/blog/upgrade-generator'
import { getPageSeoIntelligence } from '@/lib/blog/page-seo-intelligence'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const maxDuration = 60

interface PageRow {
  id: string
  client_id: string
  url: string
  title: string | null
  page_type: string
  word_count: number | null
  has_geo_block: boolean
  topics: string[]
  primary_keyword: string | null
}

interface UpgradeBody {
  topic?: string
  mode?: 'unified' | 'geo_only' | 'seo_only'
  source_query_text?: string
  primary_keyword?: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; pageId: string } }
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { pageId } = params

  try {
    // Step 1: Fetch page and verify ownership
    const { data: page, error: pageError } = await supabaseAdmin
      .from('client_site_pages')
      .select('id, client_id, url, title, page_type, word_count, has_geo_block, topics, primary_keyword')
      .eq('id', pageId)
      .single<PageRow>()

    if (pageError || !page || page.client_id !== clientId) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }

    // Step 2: Parse request body
    let body: UpgradeBody = {}
    try {
      body = await req.json()
    } catch {
      // empty body is fine
    }

    // Derive topic from body or fall back to page's own keywords
    const topic = body.topic?.trim() ||
      [page.primary_keyword, ...(page.topics ?? [])].filter(Boolean).join(' ') ||
      page.title ||
      page.url

    const mode = body.mode ?? 'unified'

    // Step 3: Fetch real SEO + GEO intelligence (non-fatal — falls back gracefully)
    const seoIntelligence = await getPageSeoIntelligence(clientId, page.url).catch(() => undefined)

    // Step 4: Generate upgrade using data-driven weakness signals
    const output = await generatePageUpgrade({
      client_id: clientId,
      page_id: pageId,
      page_url: page.url,
      page_title: page.title,
      page_type: page.page_type,
      word_count: page.word_count,
      has_geo_block: page.has_geo_block,
      topic,
      mode,
      primary_keyword: body.primary_keyword ?? page.primary_keyword ?? undefined,
      source_query_text: body.source_query_text,
      seo_intelligence: seoIntelligence,
    })

    return NextResponse.json(output, { status: 200 })

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[upgrade POST]', message)
    return NextResponse.json({ error: `Upgrade generation failed: ${message}` }, { status: 500 })
  }
}
