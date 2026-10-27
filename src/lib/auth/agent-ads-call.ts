/**
 * Open an allowed ads-agent call: verify the key, enforce the per-minute
 * ceiling, then write the audit row before any read or draft write.
 */

import { NextResponse } from 'next/server'
import {
  AGENT_ADS_CALLS_PER_MINUTE,
  AGENT_ADS_DRAFT_TOOL,
  AGENT_ADS_SEED_TOOL,
  type AgentAdsAllowedAction,
} from '@/lib/auth/agent-ads-scope'
import { beginAgentAdsAudit, countRecentAgentAdsCalls } from '@/lib/auth/agent-ads-audit'
import {
  authorizeAgentAdsKey,
  clientBearer,
  safeResourceId,
  sourceIpFrom,
} from '@/lib/auth/agent-ads-guard'

type HeaderSource = { headers: { get(name: string): string | null } }

const TOOL: Record<AgentAdsAllowedAction, string> = {
  plan_seed_read: AGENT_ADS_SEED_TOOL,
  plan_draft_save: AGENT_ADS_DRAFT_TOOL,
}

export interface OpenedAgentAdsCall {
  ok: true
  keyId: string
  auditId: string
}

export async function openAgentAdsCall(input: {
  request: HeaderSource
  clientId: string
  action: AgentAdsAllowedAction
  resourceId: string | null
  nowMs?: number
}): Promise<OpenedAgentAdsCall | { ok: false; response: NextResponse }> {
  const nowMs = input.nowMs ?? Date.now()
  const sourceIp = sourceIpFrom(input.request)
  const resourceId = safeResourceId(input.resourceId)
  const auth = await authorizeAgentAdsKey({
    rawKey: clientBearer(input.request),
    clientId: input.clientId,
    action: input.action,
    resourceId,
    sourceIp,
    nowMs,
  })
  if (!auth.ok) return { ok: false, response: agentJson(auth.status, auth.code) }
  if (!auth.keyId) return { ok: false, response: agentJson(503, 'audit_unavailable') }
  const rate = await countRecentAgentAdsCalls(auth.keyId, nowMs)
  if (!rate.ok) return { ok: false, response: agentJson(503, 'audit_unavailable') }
  if (rate.used >= AGENT_ADS_CALLS_PER_MINUTE) {
    return rateLimited(auth.keyId, input.clientId, TOOL[input.action], resourceId, sourceIp)
  }
  const auditId = await beginAgentAdsAudit({
    keyId: auth.keyId,
    clientId: input.clientId,
    tool: TOOL[input.action],
    resourceId,
    sourceIp,
  })
  if (!auditId) return { ok: false, response: agentJson(503, 'audit_unavailable') }
  return { ok: true, keyId: auth.keyId, auditId }
}

async function rateLimited(
  keyId: string,
  clientId: string,
  tool: string,
  resourceId: string | null,
  sourceIp: string | null,
): Promise<{ ok: false; response: NextResponse }> {
  const logged = await beginAgentAdsAudit({
    keyId,
    clientId,
    tool,
    resourceId,
    sourceIp,
    errorCode: 'rate_limited',
  })
  if (!logged) return { ok: false, response: agentJson(503, 'audit_unavailable') }
  return { ok: false, response: agentJson(429, 'rate_limited') }
}

export function agentJson(status: number, code: string, extra?: Record<string, unknown>): NextResponse {
  const error = status === 403 ? 'forbidden' : code
  return NextResponse.json(
    { error, code, ...extra },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}
