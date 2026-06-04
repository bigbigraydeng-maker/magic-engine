import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateDirectiveHtml } from '@/lib/geo/html-generator'
import { buildSnippets } from '@/lib/geo/snippet-builder'
import type { GeoDirective } from '@/types/magic-engine'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/clients/[id]/geo/snippet?directive_id=...
 *
 * Returns the HTML snippet and installation instructions for a directive.
 * Defaults to the active directive if no directive_id is provided.
 *
 * Reference: ROADMAP.md P7.2.9, ARCHITECTURE.md §11.4
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const clientId = params.id
    const directiveId = new URL(req.url).searchParams.get('directive_id')

    let query = supabaseAdmin
      .from('geo_directives')
      .select('*')
      .eq('client_id', clientId)

    if (directiveId) {
      query = query.eq('id', directiveId)
    } else {
      query = query.eq('status', 'active')
    }

    const { data, error } = await query.single<GeoDirective>()

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: 'Directive not found' },
        { status: 404 }
      )
    }

    const html = generateDirectiveHtml(data)
    const snippets = buildSnippets(html)

    return NextResponse.json({
      success: true,
      directive_id: data.id,
      version: data.version,
      status: data.status,
      html,
      snippets,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
