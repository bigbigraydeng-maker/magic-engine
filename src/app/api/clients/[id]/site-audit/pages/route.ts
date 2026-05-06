/**
 * GET /api/clients/[id]/site-audit/pages
 *
 * Returns paginated list of crawled pages for a client.
 *
 * Query Parameters:
 * - limit (optional): Max results per page. Must be 1-100. Default: 10
 * - offset (optional): Results to skip. Must be >= 0. Default: 0
 * - pageType (optional): Filter by page type: 'blog', 'landing', 'product', 'service', 'contact', 'about', 'other'
 * - hasGeoBlock (optional): Filter by GEO block presence: 'true' or 'false'
 *
 * Response:
 * {
 *   pages: SitePage[],
 *   total: number,
 *   hasMore: boolean
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { SitePage } from '@/types/magic-engine'

export const maxDuration = 60

export interface PagesResponse {
  pages: SitePage[]
  total: number
  hasMore: boolean
}

export interface ApiErrorResponse {
  error: string
}

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

function parsePagination(limit?: string | null, offset?: string | null) {
  const l = limit ? parseInt(limit, 10) : DEFAULT_LIMIT
  const o = offset ? parseInt(offset, 10) : 0
  if (isNaN(l) || l < 1 || l > MAX_LIMIT) return { error: `limit must be 1–${MAX_LIMIT}` }
  if (isNaN(o) || o < 0) return { error: 'offset must be >= 0' }
  return { limit: l, offset: o }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<PagesResponse | ApiErrorResponse>> {
  const clientId = params.id
  const { searchParams } = new URL(request.url)

  const pagination = parsePagination(searchParams.get('limit'), searchParams.get('offset'))
  if ('error' in pagination) {
    return NextResponse.json<ApiErrorResponse>({ error: pagination.error }, { status: 400 })
  }
  const { limit, offset } = pagination

  const pageType = searchParams.get('pageType') ?? undefined
  const hasGeoBlockParam = searchParams.get('hasGeoBlock')
  const hasGeoBlock = hasGeoBlockParam === 'true' ? true : hasGeoBlockParam === 'false' ? false : null

  try {
    let countQuery = supabaseAdmin
      .from('client_site_pages')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('crawl_status', 'crawled')

    if (pageType) countQuery = countQuery.eq('page_type', pageType)
    if (hasGeoBlock !== null) countQuery = countQuery.eq('has_geo_block', hasGeoBlock)

    const { count: total, error: countError } = await countQuery
    if (countError) throw new Error(`Failed to count pages: ${countError.message}`)

    let dataQuery = supabaseAdmin
      .from('client_site_pages')
      .select('*')
      .eq('client_id', clientId)
      .eq('crawl_status', 'crawled')

    if (pageType) dataQuery = dataQuery.eq('page_type', pageType)
    if (hasGeoBlock !== null) dataQuery = dataQuery.eq('has_geo_block', hasGeoBlock)

    dataQuery = dataQuery.order('updated_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: pages, error: pagesError } = await dataQuery
    if (pagesError) throw new Error(`Failed to fetch pages: ${pagesError.message}`)

    const hasMore = (pages?.length ?? 0) === limit && (total ?? 0) > offset + limit

    return NextResponse.json<PagesResponse>(
      { pages: (pages || []) as SitePage[], total: total || 0, hasMore },
      { status: 200 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/pages] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>({ error: message }, { status: 500 })
  }
}
