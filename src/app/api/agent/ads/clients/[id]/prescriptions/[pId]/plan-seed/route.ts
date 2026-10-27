/**
 * GET /api/agent/ads/clients/[id]/prescriptions/[pId]/plan-seed
 * Ads-agent read of the same plan seed the session route computes.
 * The access row is written before the read. A failed write returns 503.
 */

import { NextRequest, NextResponse } from 'next/server'
import { finishAgentAdsAudit } from '@/lib/auth/agent-ads-audit'
import { agentJson, openAgentAdsCall } from '@/lib/auth/agent-ads-call'
import { readPlanSeedForClient } from '@/lib/ads-strategy/plan-seed/read-for-client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string; pId: string } }) {
  const opened = await openAgentAdsCall({
    request: req,
    clientId: params.id,
    action: 'plan_seed_read',
    resourceId: params.pId,
  })
  if (!opened.ok) return opened.response
  try {
    const result = await readPlanSeedForClient(params.id, params.pId)
    const errorCode = result.status === 200 ? null : result.status === 404 ? 'prescription_missing' : 'seed_failed'
    if (!await finishAgentAdsAudit(opened.auditId, errorCode)) return agentJson(503, 'audit_unavailable')
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    if (!await finishAgentAdsAudit(opened.auditId, 'unexpected')) return agentJson(503, 'audit_unavailable')
    return agentJson(500, 'seed_failed')
  }
}
