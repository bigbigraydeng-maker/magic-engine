/**
 * GET /api/clients/[id]/site-audit/pages/[pageId]
 *
 * Returns full details of a single crawled page including markdown_content.
 * Multi-tenant isolation is enforced by querying with BOTH id AND client_id,
 * so pages from other clients automatically return 404 (no information leak).
 *
 * This replaces the old implementation that used a site_audit_jobs intermediate
 * lookup (which was both incorrect and inefficient).
 *
 * Response:
 * {
 *   page: ClientSitePage  // Full page record with markdown_content
 * }
 *
 * Reference: ROADMAP.md P8.0.8-Phase1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const maxDuration = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientSitePageDetail {
  id: string
  client_id: string
  url: string
  title: string | null
  page_type: string
  topics: string[]
  primary_keyword: string | null
  word_count: number | null
  has_geo_block: boolean
  status_code: number | null
  crawled_at: string | null
  markdown_content: string | null
  classification_confidence?: number | null
  geo_detection_method?: string | null
  geo_confidence?: number | null
  created_at: string
  updated_at: string
}

export interface PageDetailResponse {
  page: ClientSitePageDetail
}

export interface ApiErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; pageId: string } }
): Promise<NextResponse<PageDetailResponse | ApiErrorResponse>> {
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

    if (!client.domain) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Client has no domain configured' },
        { status: 404 }
      )
    }

    // 2. Fetch the page by ID AND client_id (enforces multi-tenant isolation)
    //    Querying with both columns means pages from other clients
    //    automatically return PGRST116 (not found) — no 403 info leak.
    const { data: page, error: pageError } = await supabaseAdmin
      .from('client_site_pages')
      .select('*')
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

    return NextResponse.json<PageDetailResponse>(
      { page: page as ClientSitePageDetail },
      { status: 200 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/pages/[pageId]] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
