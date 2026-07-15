/**
 * 共享只读 Agent 工具集 — 类型 + 安全守卫
 *
 * spec: docs/superpowers/specs/2026-07-16-zhuge-v2-agent-tools-readonly.md
 *
 * 🔴 安全模型（§3.3 资源身份强作用域）：这套工具喂给 Claude（黑盒，可幻觉/被
 * prompt 注入）。跨客户越权轴有 4 条 —— client_id / domain / site_url /
 * property_id。全部由**服务端注入 ctx**，工具 input_schema 一律不暴露，
 * handler 只用 ctx.* 查询。四 agent（诸葛亮/华佗/张骞/鲁班）将来共用。
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 全部资源身份标识符在此承载 —— 服务端组好后冻结进 handler 闭包。
 * Claude 全程无法指定查哪个客户 / 域名 / 站 / property。
 */
export interface ReadonlyToolContext {
  /** 越权轴 1 — 服务端注入 */
  clientId: string
  /** 越权轴 2 — dataforseo 按 domain 查 */
  domain: string | null
  /** 越权轴 3 — GSC 按 siteUrl 查（由 clientId 反查 client_connectors.config）*/
  siteUrl: string | null
  /** 越权轴 4 — GA4 按 propertyId 查（由 clientId 反查 client_connectors.config）*/
  propertyId: string | null
  supabase: SupabaseClient
  market: 'AU' | 'NZ'
}

/** 一个只读工具 = Anthropic 工具定义 + 绑 ctx 的 handler。 */
export interface ReadonlyToolModule {
  tool: Anthropic.Tool
  handler: (input: unknown, ctx: ReadonlyToolContext) => Promise<string>
}

// ── 市场 → DataForSEO 地域码（AU=2036, NZ=2554，与 labs.ts 一致）───────────────

export const AU_LOCATION_CODE = 2036
export const NZ_LOCATION_CODE = 2554

export function locationCodeForMarket(market: 'AU' | 'NZ'): number {
  return market === 'NZ' ? NZ_LOCATION_CODE : AU_LOCATION_CODE
}

// ── 闸 3：防御式忽略入参里的一切资源标识符（§3.3）──────────────────────────────

/**
 * 若 Claude 在 input 里硬塞了资源标识符（不该有 —— schema 没声明），
 * 这些字段被**忽略**（handler 只用 ctx.*）。命中即告警，用于观测越权尝试 /
 * prompt 注入信号。此函数不改 input、不抛错，仅告警。
 */
const FORBIDDEN_INPUT_KEYS = [
  'client_id', 'clientId', 'client',
  'domain', 'target', 'url',
  'site_url', 'siteUrl', 'site',
  'property_id', 'propertyId', 'property',
]

export function warnOnResourceIds(input: unknown, toolName: string): void {
  if (!input || typeof input !== 'object') return
  for (const key of Object.keys(input as Record<string, unknown>)) {
    if (FORBIDDEN_INPUT_KEYS.includes(key)) {
      console.warn(
        `[agent-tools/readonly] ${toolName}: ignored resource identifier "${key}" in tool input ` +
        `— using server-injected ctx only (possible prompt-injection or hallucination)`,
      )
    }
  }
}

// ── 工具输出截断（§4：每工具 return ≤ ~1500 token，避免灌爆上下文）──────────────

export function truncateToolOutput(s: string, maxChars = 6000): string {
  return s.length <= maxChars ? s : `${s.slice(0, maxChars)}\n…[truncated ${s.length - maxChars} chars]`
}

/** 从 Claude 入参安全取一个正整数（带上下限），非法则用默认。 */
export function clampNumber(raw: unknown, def: number, min: number, max: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : def
  return Math.max(min, Math.min(max, n))
}

/** 从 Claude 入参安全取一个字符串（可选）。 */
export function optString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}
