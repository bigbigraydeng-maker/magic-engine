/**
 * Fail-closed audit for the two ads-agent calls.
 * A row is inserted before the read or the draft write. If that insert fails,
 * the caller must not continue.
 */

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { AGENT_ADS_CALLS_PER_MINUTE } from '@/lib/auth/agent-ads-scope'

const WINDOW_MS = 60_000

export async function countRecentAgentAdsCalls(
  keyId: string,
  nowMs: number,
): Promise<{ ok: true; used: number; limit: number } | { ok: false }> {
  const since = new Date(nowMs - WINDOW_MS).toISOString()
  try {
    const { count, error } = await supabaseAdmin
      .from('mcp_access_log')
      .select('id', { count: 'exact', head: true })
      .eq('client_key_id', keyId)
      .gte('created_at', since)
    if (error) {
      console.error('[agent-ads] rate count failed')
      return { ok: false }
    }
    return { ok: true, used: count ?? 0, limit: AGENT_ADS_CALLS_PER_MINUTE }
  } catch {
    console.error('[agent-ads] rate count rejected')
    return { ok: false }
  }
}

export async function beginAgentAdsAudit(input: {
  keyId: string
  clientId: string
  tool: string
  resourceId: string | null
  sourceIp: string | null
  errorCode?: string
}): Promise<string | null> {
  const id = randomUUID()
  const row = {
    id,
    key_kind: 'client' as const,
    client_key_id: input.keyId,
    client_id: input.clientId,
    tool: input.tool,
    ok: false,
    error_code: input.errorCode ?? 'in_progress',
    source_ip: input.sourceIp,
    resource_id: input.resourceId,
  }
  try {
    const { error } = await supabaseAdmin.from('mcp_access_log').insert(row)
    if (error) {
      console.error('[agent-ads] audit insert failed')
      return null
    }
    return id
  } catch {
    console.error('[agent-ads] audit insert rejected')
    return null
  }
}

export async function finishAgentAdsAudit(id: string, errorCode: string | null): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('mcp_access_log')
      .update({ ok: errorCode === null, error_code: errorCode })
      .eq('id', id)
      .select('id')
    if (error || !Array.isArray(data) || data.length !== 1 || data[0]?.id !== id) {
      console.error('[agent-ads] audit finish failed')
      return false
    }
    return true
  } catch {
    console.error('[agent-ads] audit finish rejected')
    return false
  }
}
