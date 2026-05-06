/**
 * GET /api/clients/[id]/site-audit/pages/[pageId]
 *
 * Returns full details of a single crawled page including markdown_content.
 *
 * Response:
 * {
 *   page: SitePage
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { SitePage } from '@/types/magic-engine'

export const maxDuration = 60

export interface PageDetailResponse {
  page: SitePage
}

export interface ApiErrorResponse {
  error: string
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; pageId: string } }
): Promise<NextResponse<PageDetailResponse | ApiErrorResponse>> {
  const { id: clientId, pageId } = params

  try {
    const { data: page, error } = await supabaseAdmin
      .from('client_site_pages')
      .select('*')
      .eq('id', pageId)
      .eq('client_id', clientId)
      .maybeSingle()

    if (error) throw new Error(`Failed to fetch page: ${error.message}`)

    if (!page) {
      return NextResponse.json<ApiErrorResponse>({ error: 'Page not found' }, { status: 404 })
    }

    return NextResponse.json<PageDetailResponse>({ page: page as SitePage }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/pages/[pageId]] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>({ error: message }, { status: 500 })
  }
}
