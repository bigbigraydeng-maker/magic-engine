/**
 * GET /api/clients/[id]/site-audit/pages/stats
 *
 * Returns aggregated statistics for all crawled pages of a client.
 * Uses the get_page_stats PostgreSQL RPC function for efficiency
 * (single SQL query with FILTER clauses instead of N+1 queries).
 *
 * Response:
 * {
 *   total:         number,
 *   byType:        { blog, product, service, landing, about, contact, other },
 *   geoCoverage:   { withBlock, withoutBlock, percent },
 *   byStatusCode:  { ok, redirect, clientErr, serverErr },
 *   avgWordCount:  number,
 * }
 *
 * Reference: ROADMAP.md P8.0.8-Phase1 Step 5
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export const maxDuration = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageStats {
  total: number
  byType: {
    blog: number
    product: number
    service: number
    landing: number
    about: number
    contact: number
    other: number
  }
  geoCoverage: {
    withBlock: number
    withoutBlock: number
    percent: number
  }
  byStatusCode: {
    ok: number
    redirect: number
    clientErr: number
    serverErr: number
  }
  avgWordCount: number
}

export interface ApiErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<PageStats | ApiErrorResponse>> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const clientId = params.id

  try {
    // 1. Verify client exists
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

    // 2. Call the RPC aggregation function
    const { data, error: rpcError } = await supabaseAdmin.rpc('get_page_stats', {
      client_id: clientId,
    })

    if (rpcError) {
      throw new Error(`Stats query failed: ${rpcError.message}`)
    }

    const row = data?.[0] ?? {
      total_count: 0,
      blog_count: 0,
      product_count: 0,
      service_count: 0,
      landing_count: 0,
      about_count: 0,
      contact_count: 0,
      other_count: 0,
      geo_yes: 0,
      geo_no: 0,
      ok_2xx: 0,
      redirect_3xx: 0,
      client_4xx: 0,
      server_5xx: 0,
      avg_word_count: 0,
    }

    const total = Number(row.total_count) || 0

    const stats: PageStats = {
      total,
      byType: {
        blog: Number(row.blog_count) || 0,
        product: Number(row.product_count) || 0,
        service: Number(row.service_count) || 0,
        landing: Number(row.landing_count) || 0,
        about: Number(row.about_count) || 0,
        contact: Number(row.contact_count) || 0,
        other: Number(row.other_count) || 0,
      },
      geoCoverage: {
        withBlock: Number(row.geo_yes) || 0,
        withoutBlock: Number(row.geo_no) || 0,
        percent: total > 0
          ? Math.round((Number(row.geo_yes) / total) * 100)
          : 0,
      },
      byStatusCode: {
        ok: Number(row.ok_2xx) || 0,
        redirect: Number(row.redirect_3xx) || 0,
        clientErr: Number(row.client_4xx) || 0,
        serverErr: Number(row.server_5xx) || 0,
      },
      avgWordCount: Math.round(Number(row.avg_word_count) || 0),
    }

    return NextResponse.json<PageStats>(stats, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/pages/stats] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
