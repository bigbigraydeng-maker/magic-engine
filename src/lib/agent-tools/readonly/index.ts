/**
 * 共享只读 Agent 工具集 — 工厂
 *
 * buildReadonlyTools(base) 由 clientId 反查该客户的 GSC/GA4 connector config，
 * 组出 siteUrl / propertyId，连同 clientId / domain 一起冻结进 ctx，返回
 * { tools, handlers } 供 callClaudeWithTools 使用。
 *
 * 🔴 4 条资源身份轴（clientId / domain / siteUrl / propertyId）全部在此服务端
 * 注入；Claude 通过工具入参无法指定任何一条（§3.3）。
 *
 * spec: docs/superpowers/specs/2026-07-16-zhuge-v2-agent-tools-readonly.md
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReadonlyToolContext, ReadonlyToolModule } from './types'
import { queryKeywordDetail } from './keyword-detail'
import { querySearchConsole } from './search-console'
import { queryAnalytics } from './analytics'
import { queryFlywheelHistory } from './flywheel-history'

export type { ReadonlyToolContext } from './types'

/** All readonly tool modules. Add new ones here — every agent gets them for free. */
const MODULES: ReadonlyToolModule[] = [
  queryKeywordDetail,
  querySearchConsole,
  queryAnalytics,
  queryFlywheelHistory,
]

/**
 * Resolve a single connector config value (site_url / property_id) for a client.
 * Returns null unless the connector exists AND is in 'connected' state AND the
 * key is a non-empty string. Fails silently to null on any DB error.
 */
async function resolveConnectorValue(
  supabase: SupabaseClient,
  clientId: string,
  anchor: 'gsc' | 'ga4',
  key: 'site_url' | 'property_id',
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('client_connectors')
      .select('status, config')
      .eq('client_id', clientId)
      .eq('anchor', anchor)
      .maybeSingle()
    if (error || !data || data.status !== 'connected') return null
    const v = (data.config as Record<string, unknown> | null)?.[key]
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

export interface BuildReadonlyToolsInput {
  clientId: string
  domain: string | null
  supabase: SupabaseClient
  market: 'AU' | 'NZ'
}

/**
 * Build the readonly tool set for one client. Async because it reads the
 * client's GSC/GA4 connector config to lock siteUrl / propertyId server-side.
 */
export async function buildReadonlyTools(base: BuildReadonlyToolsInput): Promise<{
  tools: Anthropic.Tool[]
  handlers: Record<string, (input: unknown) => Promise<string>>
}> {
  // 🔴 条款 B — resolve resource identifiers from the CLIENT'S OWN connector config.
  const [siteUrl, propertyId] = await Promise.all([
    resolveConnectorValue(base.supabase, base.clientId, 'gsc', 'site_url'),
    resolveConnectorValue(base.supabase, base.clientId, 'ga4', 'property_id'),
  ])

  const ctx: ReadonlyToolContext = {
    clientId: base.clientId,
    domain: base.domain,
    siteUrl,
    propertyId,
    supabase: base.supabase,
    market: base.market,
  }

  const tools = MODULES.map(m => m.tool)
  const handlers: Record<string, (input: unknown) => Promise<string>> = {}
  for (const m of MODULES) {
    // ctx captured in closure — Claude cannot influence any resource identifier.
    handlers[m.tool.name] = (input: unknown) => m.handler(input, ctx)
  }
  return { tools, handlers }
}

/**
 * Summarise tool calls for persistence (spec §5 条款 D): keep name + input +
 * a short result summary only — NOT the raw result full-text — to shrink the
 * leakage surface and keep the trace compact.
 */
export function summariseToolTrace(
  toolCalls: Array<{ name: string; input: unknown; result: string; is_error: boolean }>,
  maxSummaryChars = 200,
): Array<{ name: string; input: unknown; summary: string; is_error: boolean }> {
  return toolCalls.map(c => ({
    name: c.name,
    input: c.input,
    summary: c.result.length > maxSummaryChars ? `${c.result.slice(0, maxSummaryChars)}…` : c.result,
    is_error: c.is_error,
  }))
}
