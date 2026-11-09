import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { allowedClient } from '@/lib/web-intelligence/contracts'
import { loadCompetitors } from '@/lib/web-intelligence/targets'
import { collectAndRecordTrafficDirectionObservations } from '@/lib/web-intelligence/external-run'

export const maxDuration = 300

type Context = { params: Promise<{ id: string }> }

/** Admin-only manual pilot run. The recurring schedule remains dark by default. */
export async function POST(_req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Administrator required' }, { status: 403 })
  if (!allowedClient(id)) return NextResponse.json({ error: 'Client is not enabled for Web Intelligence.' }, { status: 403 })
  try {
    const competitors = await loadCompetitors(id)
    const client = await (await import('@/lib/supabase')).supabaseAdmin.from('clients').select('domain').eq('id', id).single()
    if (client.error || !client.data?.domain) return NextResponse.json({ error: 'Client website domain is not configured.' }, { status: 409 })
    const domains = [...new Set([client.data.domain, ...competitors.filter(item => item.status !== 'archive').map(item => item.domain).filter(Boolean)])].slice(0, 20)
    if (!domains.length) return NextResponse.json({ error: 'No active competitor domains are configured.' }, { status: 409 })
    const receipt = await collectAndRecordTrafficDirectionObservations({ clientId: id, domains, observedAt: new Date().toISOString(), maxChargeUsd: 0.15 })
    return NextResponse.json({
      ok: !receipt.error,
      domains: domains.length,
      returned: (receipt.observations?.length ?? 0) + (receipt.rejected ?? 0),
      persisted: receipt.persisted,
      duplicates: receipt.duplicates,
      rejected: receipt.rejected,
      write_failures: receipt.writeFailures,
      cost_usd: receipt.costUsd ?? 0,
      run_id: receipt.runId,
      dataset_id: receipt.datasetId ?? null,
      error: receipt.error ?? null,
    }, { status: receipt.error ? 502 : 200 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Traffic direction collection failed.' }, { status: 502 })
  }
}
