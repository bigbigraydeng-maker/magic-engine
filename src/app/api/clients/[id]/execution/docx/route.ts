/**
 * GET /api/clients/[id]/execution/docx
 *
 * Returns a .docx binary of the execution plan for a client.
 * Fetches all execution items with their work logs, then runs
 * generateExecutionDocx() and streams the binary back for download.
 *
 * Query: ?prescription_id=<uuid>  — limit to a specific prescription (optional)
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { generateExecutionDocx } from '@/lib/execution/docx-generator'
import type { ExecutionItem, ExecutionLog } from '@/types/diagnostic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const { searchParams } = new URL(req.url)
  const prescriptionId = searchParams.get('prescription_id')

  // Fetch client name
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
  }

  // Fetch execution items
  let query = supabaseAdmin
    .from('execution_items')
    .select('*')
    .eq('client_id', clientId)
    .order('phase', { ascending: true })
    .order('sort_order', { ascending: true })

  if (prescriptionId) {
    query = query.eq('prescription_id', prescriptionId)
  }

  const { data: itemRows, error: itemsError } = await query

  if (itemsError) {
    console.error('[execution/docx] items fetch error:', itemsError)
    return NextResponse.json({ success: false, error: 'Failed to fetch execution items' }, { status: 500 })
  }

  const baseItems = (itemRows ?? []) as ExecutionItem[]

  if (!baseItems.length) {
    return NextResponse.json({ success: false, error: 'No execution items found' }, { status: 404 })
  }

  // Fetch logs
  let logsByItem: Record<string, ExecutionLog[]> = {}
  const { data: logRows, error: logErr } = await supabaseAdmin
    .from('execution_logs')
    .select('*')
    .in('execution_item_id', baseItems.map(i => i.id))
    .order('created_at', { ascending: true })

  if (!logErr && logRows) {
    logsByItem = (logRows as ExecutionLog[]).reduce((acc, log) => {
      ;(acc[log.execution_item_id] ??= []).push(log)
      return acc
    }, {} as Record<string, ExecutionLog[]>)
  }

  const itemsWithLogs = baseItems.map(item => ({
    ...item,
    logs: logsByItem[item.id] ?? [],
  }))

  try {
    const buffer = await generateExecutionDocx(itemsWithLogs, client.name)
    const slug = client.name.replace(/\s+/g, '_').slice(0, 30)
    const date = new Date().toISOString().slice(0, 10)
    const filename = `luban_execution_${slug}_${date}.docx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err: unknown) {
    console.error('[execution/docx] generation error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'DOCX generation failed' },
      { status: 500 },
    )
  }
}
