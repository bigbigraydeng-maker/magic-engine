/**
 * Enforce the ads-agent scope on a request.
 *
 * Session routes call `rejectAgentAdsBearer`. A bearer that is not this scope
 * is ignored, so a normal login keeps working. A key that carries the scope
 * is judged here: only the allowlist continues, and a denial is written to
 * `mcp_access_log` before the 403 is returned. If that row cannot be written,
 * the answer is 503 and the route must not continue.
 *
 * New agent routes must call `authorizeAgentAdsKey` and stop unless the
 * result is allowed. `rejectAgentAdsBearer` returns null for an allowed
 * action so the existing session check can still run.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  AGENT_ADS_DENY_TOOL,
  decideAgentAdsAccess,
  metaExecuteDenialAction,
  scopeIncludesAgentAds,
  type AgentAdsDeny,
} from '@/lib/auth/agent-ads-scope'
import {
  extractBearer,
  KEY_PREFIX_CLIENT,
  verifyApiKey,
  type ApiKeyAuth,
  type VerifyResult,
} from '@/lib/auth/api-key-access'

type HeaderSource = { headers: { get(name: string): string | null } }

export interface AgentAdsResult {
  ok: boolean
  status: 200 | 403 | 503
  code: string
  logged: boolean
  keyId?: string
}

interface GuardInput {
  clientId: string
  action: string
  resourceId?: string | null
  sourceIp?: string | null
  nowMs?: number
}

export function clientBearer(request: HeaderSource): string | null {
  const raw = extractBearer(request.headers.get('authorization'))
  if (!raw || !raw.startsWith(KEY_PREFIX_CLIENT)) return null
  return raw
}

export function sourceIpFrom(request: HeaderSource): string | null {
  const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  return safeInet(first)
}

export async function authorizeAgentAdsKey(input: GuardInput & { rawKey: string | null }): Promise<AgentAdsResult> {
  const verified = await verifyApiKey(input.rawKey, {
    expectedKind: 'client',
    sourceIp: input.sourceIp ?? undefined,
  })
  if (!verified.ok || verified.auth.kind !== 'client') return unverified(verified)
  return enforceClient(verified.auth, input)
}

export async function rejectAgentAdsBearer(request: HeaderSource, input: GuardInput): Promise<NextResponse | null> {
  const rawKey = clientBearer(request)
  if (!rawKey) return null
  const verified = await verifyApiKey(rawKey, {
    expectedKind: 'client',
    sourceIp: input.sourceIp ?? sourceIpFrom(request) ?? undefined,
  })
  if (!verified.ok) return verified.reason === 'lookup_error' ? jsonResult(503, 'lookup_error') : null
  if (verified.auth.kind !== 'client' || !scopeIncludesAgentAds(verified.auth.scopes)) return null
  const result = await enforceClient(verified.auth, input)
  if (result.status === 200) return null
  return jsonResult(result.status, result.code)
}

export async function rejectAgentAdsMetaExecute(request: Request, clientId: string): Promise<NextResponse | null> {
  if (!clientBearer(request)) return null
  const peeked = await peekMetaExecute(request)
  return rejectAgentAdsBearer(request, { clientId, action: peeked.action, resourceId: peeked.resourceId })
}

export async function rejectAgentAdsCapWrite(request: Request, clientId: string): Promise<NextResponse | null> {
  if (!clientBearer(request)) return null
  return rejectAgentAdsBearer(request, { clientId, action: await capAction(request) })
}

async function enforceClient(auth: Extract<ApiKeyAuth, { kind: 'client' }>, input: GuardInput): Promise<AgentAdsResult> {
  const decision = decideAgentAdsAccess({
    identity: {
      keyId: auth.keyId,
      clientId: auth.clientId,
      scopes: auth.scopes,
      expiresAt: auth.expiresAt ?? null,
    },
    requestedClientId: input.clientId,
    action: input.action,
    nowMs: input.nowMs ?? Date.now(),
  })
  if (decision.ok) return { ok: true, status: 200, code: 'allowed', logged: false, keyId: auth.keyId }
  const logged = await recordDenial(decision, input)
  if (!logged) return { ok: false, status: 503, code: 'audit_unavailable', logged: false }
  return { ok: false, status: 403, code: decision.code, logged: true }
}

function unverified(verified: VerifyResult): AgentAdsResult {
  if (verified.ok) return { ok: false, status: 403, code: 'wrong_endpoint', logged: false }
  const status = verified.reason === 'lookup_error' ? 503 : 403
  return { ok: false, status, code: verified.reason, logged: false }
}

async function recordDenial(decision: AgentAdsDeny, input: GuardInput): Promise<boolean> {
  const resourceId = safeResourceId(input.resourceId)
    ?? (decision.code === 'client_mismatch' ? safeResourceId(input.clientId) : null)
  const row = {
    key_kind: 'client' as const,
    client_key_id: decision.keyId,
    client_id: decision.clientId,
    tool: AGENT_ADS_DENY_TOOL,
    ok: false,
    error_code: decision.code,
    source_ip: safeInet(input.sourceIp),
    resource_id: resourceId,
  }
  try {
    const { error } = await supabaseAdmin.from('mcp_access_log').insert(row)
    if (error) console.error('[agent-ads] denial log failed')
    return !error
  } catch {
    console.error('[agent-ads] denial log rejected')
    return false
  }
}

async function peekMetaExecute(request: Request): Promise<{ action: string; resourceId: string | null }> {
  try {
    const body = await request.clone().json() as { action_type?: unknown; campaign_id?: unknown }
    const actionType = typeof body.action_type === 'string' ? body.action_type : ''
    const resourceId = typeof body.campaign_id === 'string' ? body.campaign_id : null
    return { action: metaExecuteDenialAction(actionType), resourceId }
  } catch {
    return { action: 'write_meta', resourceId: null }
  }
}

async function capAction(request: Request): Promise<string> {
  try {
    const body = await request.clone().json() as { daily_budget_cap_cents?: unknown }
    if (!body || typeof body !== 'object' || !('daily_budget_cap_cents' in body)) return 'outside_allowlist'
    return 'change_cap'
  } catch {
    return 'change_cap'
  }
}

function jsonResult(status: 403 | 503, code: string): NextResponse {
  const error = status === 403 ? 'forbidden' : code
  return NextResponse.json({ error, code }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function safeResourceId(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > 64) return null
  if (!/^[A-Za-z0-9:_-]+$/.test(trimmed)) return null
  return trimmed
}

function safeInet(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) {
    return trimmed.split('.').every((part) => Number(part) <= 255) ? trimmed : null
  }
  if (/^[0-9a-f:]+$/i.test(trimmed) && trimmed.includes(':') && trimmed.length <= 45) return trimmed
  return null
}
