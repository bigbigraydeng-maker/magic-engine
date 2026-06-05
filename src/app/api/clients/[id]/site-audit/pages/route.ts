/**
 * GET /api/clients/[id]/site-audit/pages
 *
 * Returns paginated list of crawled pages for a client directly from
 * the client_site_pages table (no intermediary site_audit_jobs lookup).
 *
 * Query Parameters:
 * - limit       (optional): Max results per page. 1–500. Default: 50
 * - offset      (optional): Results to skip. >= 0. Default: 0
 * - sort        (optional): Column to sort by. Default: crawled_at
 *                Allowed: url | word_count | crawled_at | has_geo_block
 * - order       (optional): Sort direction. Default: desc
 *                Allowed: asc | desc
 * - pageType    (optional): Filter by page type.
 *                Allowed: blog | product | service | landing | about | contact | other
 * - hasGeoBlock (optional): Filter by GEO block presence: 'true' or 'false'
 * - statusCode  (optional): Filter by status code range: '2xx' | '4xx' | '5xx'
 *
 * Response:
 * {
 *   pages:  ClientSitePage[],
 *   total:  number,
 *   limit:  number,
 *   offset: number,
 *   sort:   string,
 *   order:  string,
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

export type PageType =
  | 'blog'
  | 'product'
  | 'service'
  | 'landing'
  | 'about'
  | 'contact'
  | 'other'

const PAGE_TYPES: PageType[] = [
  'blog', 'product', 'service', 'landing', 'about', 'contact', 'other',
]

export type SortColumn = 'url' | 'word_count' | 'crawled_at' | 'has_geo_block'
export type SortOrder = 'asc' | 'desc'

const ALLOWED_SORT_COLUMNS: SortColumn[] = [
  'url', 'word_count', 'crawled_at', 'has_geo_block',
]

const ALLOWED_ORDERS: SortOrder[] = ['asc', 'desc']

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500
const DEFAULT_SORT: SortColumn = 'crawled_at'
const DEFAULT_ORDER: SortOrder = 'desc'

export interface ClientSitePage {
  id: string
  url: string
  title: string | null
  page_type: PageType
  topics: string[]
  primary_keyword: string | null
  word_count: number | null
  has_geo_block: boolean
  status_code: number | null
  crawled_at: string | null
  created_at: string
  updated_at: string
}

export interface PagesResponse {
  pages: ClientSitePage[]
  total: number
  limit: number
  offset: number
  sort: string
  order: string
}

export interface ApiErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function parsePagination(
  limitParam: string | null,
  offsetParam: string | null
): { limit: number; offset: number } | { error: string } {
  const rawLimit = parseInt(limitParam ?? String(DEFAULT_LIMIT), 10)
  if (isNaN(rawLimit) || rawLimit < 1) {
    return { error: 'limit must be a positive integer' }
  }
  const limit = Math.min(rawLimit, MAX_LIMIT)

  const offset = parseInt(offsetParam ?? '0', 10)
  if (isNaN(offset) || offset < 0) {
    return { error: 'offset must be >= 0' }
  }

  return { limit, offset }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<PagesResponse | ApiErrorResponse>> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const clientId = params.id
  const { searchParams } = new URL(request.url)

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

    // 2. Parse and validate sort/order BEFORE pagination
    //    (so invalid sort returns 400 before any DB lookup)
    const sortParam = (searchParams.get('sort') ?? DEFAULT_SORT) as SortColumn
    const orderParam = (searchParams.get('order') ?? DEFAULT_ORDER) as SortOrder

    if (!ALLOWED_SORT_COLUMNS.includes(sortParam)) {
      return NextResponse.json<ApiErrorResponse>(
        { error: `Invalid sort column: ${sortParam}. Allowed: ${ALLOWED_SORT_COLUMNS.join(', ')}` },
        { status: 400 }
      )
    }

    if (!ALLOWED_ORDERS.includes(orderParam)) {
      return NextResponse.json<ApiErrorResponse>(
        { error: `Invalid order: ${orderParam}. Allowed: asc, desc` },
        { status: 400 }
      )
    }

    // 3. Validate pagination
    const pagination = parsePagination(
      searchParams.get('limit'),
      searchParams.get('offset')
    )
    if ('error' in pagination) {
      return NextResponse.json<ApiErrorResponse>(
        { error: pagination.error },
        { status: 400 }
      )
    }
    const { limit, offset } = pagination

    // 4. Validate pageType filter
    const pageTypeParam = searchParams.get('pageType') as PageType | null
    if (pageTypeParam && !PAGE_TYPES.includes(pageTypeParam)) {
      return NextResponse.json<ApiErrorResponse>(
        { error: `pageType must be one of: ${PAGE_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // 5. Build query against client_site_pages (direct client_id scope)
    let query = supabaseAdmin
      .from('client_site_pages')
      .select(
        'id, url, title, page_type, topics, primary_keyword, word_count, has_geo_block, status_code, crawled_at, created_at, updated_at',
        { count: 'exact' }
      )
      .eq('client_id', clientId)

    // Apply optional filters
    if (pageTypeParam) {
      query = query.eq('page_type', pageTypeParam)
    }

    const hasGeoParam = searchParams.get('hasGeoBlock')
    if (hasGeoParam === 'true') {
      query = query.eq('has_geo_block', true)
    } else if (hasGeoParam === 'false') {
      query = query.eq('has_geo_block', false)
    }

    const statusCodeParam = searchParams.get('statusCode')
    if (statusCodeParam === '2xx') {
      query = query.gte('status_code', 200).lt('status_code', 300)
    } else if (statusCodeParam === '3xx') {
      query = query.gte('status_code', 300).lt('status_code', 400)
    } else if (statusCodeParam === '4xx') {
      query = query.gte('status_code', 400).lt('status_code', 500)
    } else if (statusCodeParam === '5xx') {
      query = query.gte('status_code', 500).lt('status_code', 600)
    }

    // Apply sort + pagination
    query = query
      .order(sortParam, { ascending: orderParam === 'asc' })
      .range(offset, offset + limit - 1)

    const { data: pages, count, error: pagesError } = await query

    if (pagesError) {
      throw new Error(`Failed to fetch pages: ${pagesError.message}`)
    }

    return NextResponse.json<PagesResponse>(
      {
        pages: (pages ?? []) as ClientSitePage[],
        total: count ?? 0,
        limit,
        offset,
        sort: sortParam,
        order: orderParam,
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/pages] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
