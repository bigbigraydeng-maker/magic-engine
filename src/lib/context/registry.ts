/**
 * Phase B — Growth Capability Registry
 *
 * Maps logical capability keys to adapter functions.
 * The adapter is the "glue layer" — it takes ClientContext + prior runtime
 * outputs and maps them to each agent's specific argument format.
 *
 *柔性设计原则：
 *   - Agent 合并/拆分时只改这个文件的 adapter，调用方不变
 *   - 每个 capability 声明 needs_runtime — orchestrator 用来决定执行顺序
 *   - GROWTH_CAPABILITY_REGISTRY 只包含面向客户的能力
 *   - 开发工具 agent（魏征/郑板桥/狄仁杰）不在此注册
 *
 * Reference: ROADMAP.md Phase B · 魏征审查报告 2026-06-07
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { runZhangqian } from '@/lib/zhangqian/agent'
import { runHuatuo } from '@/lib/huatuo/agent'
import { conductPriorityActions } from '@/lib/zhuge/conductor'
import { LUBAN_TOOL_CATALOG } from '@/lib/zhuge/tools-catalog'
import type { ClientContext, RuntimeOutputs } from './types'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { HuatuoPrescriptionResult } from '@/lib/huatuo/types'

// ─── Capability definition ───────────────────────────────────────────────────

export interface CapabilityDef {
  label: string
  needs_runtime: (keyof RuntimeOutputs)[]
  output_key: keyof RuntimeOutputs
  run: (
    ctx: ClientContext,
    supabase: SupabaseClient,
    runtime: RuntimeOutputs,
    options?: CapabilityRunOptions,
  ) => Promise<RuntimeOutputs[keyof RuntimeOutputs]>
}

export interface CapabilityRunOptions {
  onProgress?: (note: string) => void | Promise<void>
}

// ─── Growth Capability Registry ──────────────────────────────────────────────
//
// To merge two agents: point both keys at a single `run` function.
// To split an agent: add a new key with its own `run` function.
// To swap models or vendors: change only inside `run` — callers are unaffected.

export const GROWTH_CAPABILITY_REGISTRY: Record<string, CapabilityDef> = {

  /**
   * collect — 张骞 Discovery
   * Scans the client's domain and surfaces structured evidence.
   */
  collect: {
    label: '张骞 — 域名侦察',
    needs_runtime: [],
    output_key: 'discovery',
    run: async (ctx, _supabase, _runtime, opts) => {
      const result = await runZhangqian(ctx.client.domain, {
        memoryContext: ctx.memory,
        onProgress: opts?.onProgress,
      })
      return result.report
    },
  },

  /**
   * diagnose — 华佗 Prescription
   * Scores 6 dimensions and generates a prioritised finding list.
   * Requires: discovery output from collect step.
   */
  diagnose: {
    label: '华佗 — 6维诊断',
    needs_runtime: ['discovery'],
    output_key: 'prescription',
    run: async (ctx, supabase, runtime, opts) => {
      const discovery = runtime.discovery as DiscoveryReport
      const intake = buildHuatuoIntake(ctx)
      const result = await runHuatuo(supabase, discovery, intake, {
        memoryContext: ctx.memory,
        onProgress: opts?.onProgress,
      })
      return result
    },
  },

  /**
   * plan — 诸葛亮 Strategy
   * Selects the top 5 priority actions from the diagnostic findings.
   * Requires: discovery + prescription.
   */
  plan: {
    label: '诸葛亮 — 战略决策',
    needs_runtime: ['discovery', 'prescription'],
    output_key: 'plan',
    run: async (ctx, _supabase, runtime) => {
      const discovery = runtime.discovery as DiscoveryReport
      const prescription = runtime.prescription as HuatuoPrescriptionResult

      // Derive diagnostic scores and findings from prescription phases
      const findings = prescription.content?.phases.flatMap(p => p.actions) ?? []
      const scores: Record<string, number | null> = {}
      for (const action of findings) {
        if (action.dimension && scores[action.dimension] === undefined) {
          scores[action.dimension] = null
        }
      }

      // Use the static tool catalog — luban tools are capability declarations,
      // not per-client runtime state. Dynamic tool availability is handled
      // inside the conductor prompt via the catalog.
      const result = await conductPriorityActions({
        client: buildClientForZhuge(ctx),
        discoveryEvidence: discovery,
        diagnosticScores: scores,
        findings: [],
        availableLubanTools: LUBAN_TOOL_CATALOG,
        businessContext: buildBusinessContext(ctx),
        memoryContext: ctx.memory,
      })
      return result
    },
  },

}

// ─── Adapter helpers ──────────────────────────────────────────────────────────
// These map ClientContext fields into the specific shapes each agent expects.
// If an agent's interface changes, only update here.

function buildHuatuoIntake(ctx: ClientContext): import('@/types/diagnostic').PrescriptionIntake {
  return {
    business_goal: ctx.masterBrief?.core_proposition ?? 'Grow digital presence',
    timeline_urgency: 'short_term',
    monthly_budget_aud: 0,
    priority_dimensions: [],
    notes: ctx.masterBrief
      ? `業務方向: ${ctx.masterBrief.core_proposition ?? ''}`
      : null,
  }
}

function buildClientForZhuge(ctx: ClientContext) {
  // ZhugeInput.client expects the full Client DB row shape.
  // Cast via unknown — we only pass the fields the conductor actually reads.
  return {
    id: ctx.client.id,
    name: ctx.client.name,
    domain: ctx.client.domain,
    primary_keywords: ctx.client.primary_keywords,
    brand_aliases: ctx.client.brand_aliases,
    competitor_domains: ctx.client.competitor_domains,
    industry: ctx.client.industry,
    semrush_db: ctx.client.semrush_db,
  } as unknown as Parameters<typeof conductPriorityActions>[0]['client']
}

function buildBusinessContext(ctx: ClientContext): import('@/lib/zhuge/types').BusinessContext {
  return {
    market: ctx.client.market as 'AU' | 'NZ' | 'AU/NZ',
    monthly_budget_aud: null,
    primary_goal: ctx.masterBrief?.core_proposition ?? null,
    blockers: [],
    has_fde: false,
  }
}
