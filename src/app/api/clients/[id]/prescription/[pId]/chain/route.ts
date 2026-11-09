/**
 * GET /api/clients/[id]/prescription/[pId]/chain
 *
 * Read-only chain position for one prescription. Computed from existing rows.
 * Does not write, does not call a model, and does not read diagnostic tables.
 * Access matches the prescription detail GET in this folder: paid client or internal.
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { deriveChainStatus } from '@/lib/prescription-chain/derive'
import { loadChainFacts, serviceReader } from '@/lib/prescription-chain/load'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  _req: Request,
  { params }: { params: { id: string; pId: string } },
): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const facts = await loadChainFacts(serviceReader(supabaseAdmin), {
    clientId: params.id,
    prescriptionId: params.pId,
    nowIso: new Date().toISOString(),
  })
  if (facts.prescription.read === 'ok' && facts.prescription.value === null) {
    return NextResponse.json({ success: false, error: '处方不存在' }, { status: 404 })
  }

  return NextResponse.json(
    { success: true, chain: deriveChainStatus(facts) },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
  )
}
