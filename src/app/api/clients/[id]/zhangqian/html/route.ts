/**
 * GET /api/clients/[id]/zhangqian/html
 *
 * Returns the latest 张骞 discovery report as a self-contained HTML deck
 * (client-shareable · editorial style). Bro of `../docx/route.ts` — same
 * auth model, same source data, different renderer.
 *
 * Query params:
 *   ?download=1  → force Content-Disposition: attachment (default: inline
 *                  so browsers preview the page on click).
 *
 * Security: dashboard client access (session-based) — same as the /docx sibling.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getLatestDiscovery } from '@/lib/zhangqian/persistor'
import { generateZhangqianHtml } from '@/lib/zhangqian/html-generator'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Fetch client name (mirror docx route)
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
  }

  const discovery = await getLatestDiscovery(supabaseAdmin, clientId)
  if (!discovery) {
    return NextResponse.json(
      { success: false, error: 'No discovery found for this client' },
      { status: 404 },
    )
  }

  try {
    const reportDate = new Date(discovery.generated_at).toLocaleDateString('en-NZ', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const html = generateZhangqianHtml(discovery.payload, {
      clientName: client.name,
      reportDate,
    })

    const download = req.nextUrl.searchParams.get('download') === '1'
    const slug = client.name.replace(/[^a-z0-9-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40)
    const filename = `magic_engine_discovery_${slug || 'client'}_${discovery.generated_at.slice(0, 10)}.html`
    const disposition = download
      ? `attachment; filename="${filename}"`
      : 'inline'

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': disposition,
        // Short-lived cache — the FDE re-runs discovery frequently during onboarding.
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err: unknown) {
    console.error('[zhangqian/html] generation error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'HTML generation failed' },
      { status: 500 },
    )
  }
}
