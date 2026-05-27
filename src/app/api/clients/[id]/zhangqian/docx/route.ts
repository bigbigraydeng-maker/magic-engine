/**
 * GET /api/clients/[id]/zhangqian/docx
 *
 * Returns a .docx binary of the latest Zhang Qian discovery report.
 * Fetches the most recent ClientDiscoveryRow for the client, then runs
 * generateZhangqianDocx() and streams the binary back for download.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getLatestDiscovery } from '@/lib/zhangqian/persistor'
import { generateZhangqianDocx } from '@/lib/zhangqian/docx-generator'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Fetch client name
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
  }

  // Fetch latest discovery
  const discovery = await getLatestDiscovery(supabaseAdmin, clientId)
  if (!discovery) {
    return NextResponse.json(
      { success: false, error: 'No discovery found for this client' },
      { status: 404 },
    )
  }

  try {
    const reportDate = new Date(discovery.generated_at).toLocaleDateString('en-AU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const buffer = await generateZhangqianDocx(discovery.payload, client.name, reportDate)
    const slug = client.name.replace(/[^a-z0-9-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40)
    const filename = `magic_engine_discovery_${slug || 'client'}_${discovery.generated_at.slice(0, 10)}.docx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err: unknown) {
    console.error('[zhangqian/docx] generation error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'DOCX generation failed' },
      { status: 500 },
    )
  }
}
