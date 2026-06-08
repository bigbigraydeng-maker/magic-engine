/**
 * 子牙 — Rule-based Task Router
 *
 * Step 1: Match task_description against known patterns (0 LLM cost)
 * Step 2: LLM fallback (Claude Opus) for unmatched tasks
 *
 * Phase C: planExecution() returns a full ExecutionPlan — the capability chain,
 * parallel/sequential split, and required ClientContext fields.
 * This is the bridge between ZiyaRouter and the Phase B orchestrator.
 *
 * Reference: docs/agents/10-ziya.md § 三、混合路由规则
 */

import type { TaskType, ZiyaTaskInput } from './types'
import type { ExecutionPlan, GrowthCapabilityKey } from '@/lib/context/types'

// ── Rule keywords ─────────────────────────────────────────────────────────────

const ROUTE_RULES: Array<{ keywords: string[], type: TaskType }> = [
  { keywords: ['诊断', 'diagnos', '健康度', 'health', '全面检查'], type: 'diagnostic' },
  { keywords: ['内容生产', '写博客', 'blog', '做 reels', '发帖', 'content'], type: 'content_produce' },
  { keywords: ['数据采集', '拉指标', 'metric', '采集', 'collect data'], type: 'data_collect' },
  { keywords: ['fix', '暂停广告', '调出价', '出价', '否定词', 'pause', 'bid'], type: 'fix_execute' },
  { keywords: ['代码审查', 'code review', 'pr', 'pull request', '魏征'], type: 'code_review' },
  { keywords: ['方案挑战', 'design challenge', '达芬奇', '审查方案', '新 phase'], type: 'design_challenge' },
  { keywords: ['seo', '关键词', 'keyword', '排名', 'ranking', '东坡'], type: 'seo_plan' },
  { keywords: ['体验', 'ux', 'ui', '用户路径', '郑板桥', '上线前检查', '产品设计'], type: 'product_review' },
  { keywords: ['测试', 'qa', '验收', '功能对不对', '狄仁杰', 'bug', '回归'], type: 'qa_test' },
]

/**
 * Match task input against rule table.
 * Returns the matched TaskType or 'unknown' for LLM fallback.
 */
export function matchRoute(input: ZiyaTaskInput): { type: TaskType; method: 'rule' | 'llm' } {
  // Explicit task_type provided → use it directly
  if (input.task_type && input.task_type !== 'unknown') {
    return { type: input.task_type, method: 'rule' }
  }

  const desc = input.task_description.toLowerCase()

  for (const rule of ROUTE_RULES) {
    if (rule.keywords.some(kw => desc.includes(kw))) {
      return { type: rule.type, method: 'rule' }
    }
  }

  return { type: 'unknown', method: 'llm' }
}

// ── Execution plan mapping ────────────────────────────────────────────────────
//
// Each TaskType maps to an ExecutionPlan describing:
//   capabilities  — ordered list of growth capabilities to invoke
//   parallel      — subset that can run concurrently (no shared runtime deps)
//   sequential    — subset that must run in order (each depends on prior output)
//   context_needs — ClientContext fields required (subset loading optimisation)
//
// 柔性设计：agent 合并/拆分时只改此表，orchestrator 和 super-agent route 不变。

type PartialPlan = Omit<ExecutionPlan, 'task_type'>

const TASK_EXECUTION_MAP: Record<TaskType, PartialPlan> = {
  /**
   * diagnostic — full DAPE pipeline
   * 张骞(collect) → 华佗(diagnose) → 诸葛亮(plan)
   * All sequential — each step depends on the previous output.
   */
  diagnostic: {
    capabilities: ['collect', 'diagnose', 'plan'],
    parallel: [],
    sequential: ['collect', 'diagnose', 'plan'],
    context_needs: ['client', 'masterBrief', 'memory', 'recentOutcomes'],
  },

  /**
   * seo_plan — SEO-focused strategy
   * collect → diagnose (SEO dimension) → plan
   * Lighter than full diagnostic; same pipeline, narrower scope passed via options.
   */
  seo_plan: {
    capabilities: ['collect', 'diagnose', 'plan'],
    parallel: [],
    sequential: ['collect', 'diagnose', 'plan'],
    context_needs: ['client', 'masterBrief', 'memory'],
  },

  /**
   * fix_execute — immediate action execution
   * Skips collection phase; runs plan from existing diagnosis.
   * Only needs client context + memory for guard-rails.
   */
  fix_execute: {
    capabilities: ['plan'],
    parallel: [],
    sequential: ['plan'],
    context_needs: ['client', 'memory'],
  },

  /**
   * data_collect — data ingestion only
   * No diagnosis or planning — pure collect.
   */
  data_collect: {
    capabilities: ['collect'],
    parallel: [],
    sequential: ['collect'],
    context_needs: ['client'],
  },

  /**
   * content_produce — content generation pipeline
   * Needs collect (for topics) → plan (which type of content to write)
   * Actual writing (write_seo / write_geo) not yet wired — extend here when ready.
   */
  content_produce: {
    capabilities: ['collect', 'plan'],
    parallel: [],
    sequential: ['collect', 'plan'],
    context_needs: ['client', 'masterBrief', 'memory'],
  },

  /**
   * Devops task types — handled by internal agents, not the growth orchestrator.
   * Return empty capability lists; the super-agent route will dispatch differently.
   */
  code_review: {
    capabilities: [],
    parallel: [],
    sequential: [],
    context_needs: [],
  },
  design_challenge: {
    capabilities: [],
    parallel: [],
    sequential: [],
    context_needs: [],
  },
  product_review: {
    capabilities: [],
    parallel: [],
    sequential: [],
    context_needs: [],
  },
  qa_test: {
    capabilities: [],
    parallel: [],
    sequential: [],
    context_needs: [],
  },

  /**
   * unknown — LLM fallback; run full diagnostic by default.
   */
  unknown: {
    capabilities: ['collect', 'diagnose', 'plan'],
    parallel: [],
    sequential: ['collect', 'diagnose', 'plan'],
    context_needs: ['client', 'masterBrief', 'memory', 'recentOutcomes'],
  },
}

/**
 * Phase C — Plan an execution pipeline for the given task input.
 *
 * Returns a full ExecutionPlan including the capability chain,
 * parallel/sequential split, and which ClientContext fields are needed.
 *
 * Usage:
 *   const plan = planExecution(input)
 *   const ctx  = await loadClientContext(supabase, clientId)
 *   const out  = await runOrchestration(supabase, ctx, plan.capabilities, {
 *                  parallel: plan.parallel
 *                })
 */
export function planExecution(input: ZiyaTaskInput): ExecutionPlan {
  const { type } = matchRoute(input)
  const partial = TASK_EXECUTION_MAP[type] ?? TASK_EXECUTION_MAP.unknown

  return {
    task_type: type,
    ...partial,
  }
}

/**
 * Return the list of task types that involve growth orchestration
 * (i.e. have at least one growth capability in their plan).
 */
export function isGrowthTask(taskType: TaskType): boolean {
  const plan = TASK_EXECUTION_MAP[taskType]
  return plan !== undefined && plan.capabilities.length > 0
}

/**
 * Retrieve the static capability list for a known task type.
 * Useful for pre-flight checks (e.g. "does this task need collect?").
 */
export function getCapabilitiesForTask(taskType: TaskType): GrowthCapabilityKey[] {
  return TASK_EXECUTION_MAP[taskType]?.capabilities ?? []
}
