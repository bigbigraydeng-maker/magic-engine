import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { GeoDirective } from '@/types/magic-engine'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/clients/[id]/geo/deployments
 *
 * Returns all deployed pages for this client's active GEO directive.
 * Each entry is shaped as { id, page_url, deployed_at, status }.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const clientId = params.id

    const { data: directives, error } = await supabaseAdmin
      .from('geo_directives')
      .select('id, deployed_pages, updated_at, status')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .limit(1)

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    if (!directives || directives.length === 0) {
      return NextResponse.json({ success: true, deployments: [] })
    }

    const directive = directives[0] as { id: string; deployed_pages: string[] | null; updated_at: string; status: string }
    const pages: string[] = directive.deployed_pages ?? []

    // Shape into Deployment objects the frontend expects
    const deployments = pages.map((url, i) => ({
      id: `${directive.id}-${i}`,
      page_url: url,
      deployed_at: directive.updated_at,
      status: 'active' as const,
    }))

    return NextResponse.json({ success: true, deployments })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * POST /api/clients/[id]/geo/deployments
 *
 * Record a URL where the GEO snippet has been deployed.
 * Appends to deployed_pages array of the active directive.
 *
 * Body:
 * {
 *   url: string             // the page URL where snippet was installed
 *   directive_id?: string   // defaults to active directive
 * }
 *
 * Reference: ROADMAP.md P7.2.10, ARCHITECTURE.md §11.4
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const clientId = params.id
    const body = (await req.json()) as { url?: string; directive_id?: string }

    if (!body.url || !body.url.startsWith('http')) {
      return NextResponse.json(
        { success: false, error: 'url is required and must start with http' },
        { status: 400 }
      )
    }

    // Find the target directive
    let directiveQuery = supabaseAdmin
      .from('geo_directives')
      .select('id, deployed_pages')
      .eq('client_id', clientId)

    if (body.directive_id) {
      directiveQuery = directiveQuery.eq('id', body.directive_id)
    } else {
      directiveQuery = directiveQuery.eq('status', 'active')
    }

    const { data: existing, error: fetchErr } = await directiveQuery
      .single<{ id: string; deployed_pages: string[] }>()

    if (fetchErr || !existing) {
      return NextResponse.json(
        { success: false, error: 'No active directive found for this client' },
        { status: 404 }
      )
    }

    // Append URL if not already present
    const currentPages = existing.deployed_pages ?? []
    if (currentPages.includes(body.url)) {
      return NextResponse.json({
        success: true,
        message: 'URL already recorded',
        deployed_pages: currentPages,
      })
    }

    const updatedPages = [...currentPages, body.url]

    const { data, error: updateErr } = await supabaseAdmin
      .from('geo_directives')
      .update({ deployed_pages: updatedPages })
      .eq('id', existing.id)
      .select('*')
      .single<GeoDirective>()

    if (updateErr) {
      return NextResponse.json(
        { success: false, error: updateErr.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      directive_id: existing.id,
      deployed_pages: data?.deployed_pages ?? updatedPages,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
