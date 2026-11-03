/**
 * PUT /api/agent/ads/clients/[id]/plan-drafts
 * Save an unapproved draft. Approval, launch, caps, and Meta writes are not accepted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { finishAgentAdsAudit } from '@/lib/auth/agent-ads-audit'
import { agentJson, openAgentAdsCall } from '@/lib/auth/agent-ads-call'
import { parseAgentDraftBody, prescriptionResourceId } from '@/lib/marketing-plan/agent-draft-parse'
import { saveAgentDraft, type DraftSaveResult } from '@/lib/marketing-plan/agent-draft'
import { productionAgentDraftDeps } from '@/lib/marketing-plan/agent-draft-store'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const raw = await readJson(req)
  const opened = await openAgentAdsCall({
    request: req,
    clientId: params.id,
    action: 'plan_draft_save',
    resourceId: prescriptionResourceId(raw),
  })
  if (!opened.ok) return opened.response
  try {
    const result = await runSave(params.id, opened.keyId, raw)
    const errorCode = result.status === 200 ? null : result.code
    if (!await finishAgentAdsAudit(opened.auditId, errorCode)) return agentJson(503, 'audit_unavailable')
    return draftJson(result)
  } catch {
    if (!await finishAgentAdsAudit(opened.auditId, 'unexpected')) return agentJson(503, 'audit_unavailable')
    return agentJson(500, 'write_failed')
  }
}

async function runSave(clientId: string, keyId: string, raw: unknown): Promise<DraftSaveResult> {
  const parsed = parseAgentDraftBody(raw)
  if (!parsed.ok) return { status: parsed.status, code: parsed.code, error: parsed.error }
  return saveAgentDraft({ clientId, keyId, request: parsed.request, deps: productionAgentDraftDeps() })
}

function draftJson(result: DraftSaveResult): NextResponse {
  if (result.status === 200 && result.planId) {
    return NextResponse.json(
      { success: true, plan_id: result.planId, status: 'draft' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return NextResponse.json(
    { success: false, error: result.error, code: result.code, ...(result.problems ? { problems: result.problems } : {}) },
    { status: result.status, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}
