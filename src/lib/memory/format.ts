/**
 * Phase 23.D.2 — Memory → Prompt formatter (shared across all agents)
 *
 * 把 MemoryContext 渲染成纯文本块，供张骞 / 华佗 / 诸葛亮 / 鲁班 等 Agent
 * 直接拼进各自的 prompt。每个 Agent 关心的字段不一样，通过 options 裁剪。
 *
 * 设计原则：
 *   - has_content = false → 返回空字符串（行为与旧版完全一致）
 *   - 默认包含全部四类记忆；options 可逐项关闭
 *   - 标题用「Client Memory (L3 Long-term Learning)」统一品牌
 */
import type { MemoryContext } from './types'

export interface FormatMemoryOptions {
  /** 是否包含 preferences 段，默认 true */
  includePreferences?: boolean
  /** 是否包含 proven_patterns 段，默认 true */
  includeProvenPatterns?: boolean
  /** 是否包含 failed_experiments 段，默认 true */
  includeFailedExperiments?: boolean
  /** 是否包含 recent_decisions 段，默认 true（仅对诸葛亮有意义；其他 Agent 可关闭以节省 token） */
  includeRecentDecisions?: boolean
  /** 自定义标题（默认「Client Memory (L3 Long-term Learning)」） */
  heading?: string
  /** 标题前的 markdown 等级，默认 '##'（与诸葛亮 prompt 保持一致） */
  headingLevel?: '##' | '###'
}

/**
 * 渲染 MemoryContext 为 prompt 文本块。无内容时返回空串。
 *
 * 输出形如：
 *   ## Client Memory (L3 Long-term Learning)
 *   Use this to refine your recommendations...
 *   ### Content Preferences
 *     - [style] ...
 *   ### Proven Winning Patterns
 *     - [hook] ... → CTR +32%
 *   ### Failed Experiments (DO NOT repeat)
 *     - [social] ... → failed because: ...
 *   ### Recent Decisions
 *     - Chose "..." (outcome: success): ...
 */
export function formatMemoryForPrompt(
  memory: MemoryContext | undefined,
  options: FormatMemoryOptions = {},
): string {
  if (!memory?.has_content) return ''

  const includePreferences        = options.includePreferences        ?? true
  const includeProvenPatterns     = options.includeProvenPatterns     ?? true
  const includeFailedExperiments  = options.includeFailedExperiments  ?? true
  const includeRecentDecisions    = options.includeRecentDecisions    ?? true
  const level = options.headingLevel ?? '##'
  const subLevel = level === '##' ? '###' : '####'
  const heading = options.heading ?? 'Client Memory (L3 Long-term Learning)'

  const parts: string[] = [`\n${level} ${heading}`]
  parts.push('Use this to refine your output — prefer proven patterns, avoid known failures, respect past decisions.\n')

  let any = false

  if (includePreferences && memory.preferences.length > 0) {
    any = true
    parts.push(`${subLevel} Content Preferences`)
    for (const p of memory.preferences) {
      const fw = p.flywheel ? ` [${p.flywheel}]` : ''
      parts.push(`  - [${p.preference_type}${fw}] ${p.content}`)
    }
  }

  if (includeProvenPatterns && memory.proven_patterns.length > 0) {
    any = true
    parts.push(`${subLevel} Proven Winning Patterns`)
    for (const p of memory.proven_patterns) {
      const fw = p.flywheel ? ` [${p.flywheel}]` : ''
      const metric = p.performance_metric ? ` → ${p.performance_metric}` : ''
      parts.push(`  - [${p.pattern_type}${fw}] ${p.pattern_content}${metric}`)
    }
  }

  if (includeFailedExperiments && memory.failed_experiments.length > 0) {
    any = true
    parts.push(`${subLevel} Failed Experiments (DO NOT repeat)`)
    for (const e of memory.failed_experiments) {
      const dim = e.dimension ? ` [${e.dimension}]` : ''
      parts.push(`  -${dim} ${e.experiment_description} → failed because: ${e.failure_reason}`)
    }
  }

  if (includeRecentDecisions && memory.recent_decisions.length > 0) {
    any = true
    parts.push(`${subLevel} Recent Decisions`)
    for (const d of memory.recent_decisions) {
      const outcome = d.outcome_verdict ? ` (outcome: ${d.outcome_verdict})` : ''
      const alts = d.alternatives_rejected.length > 0
        ? ` (rejected: ${d.alternatives_rejected.join(', ')})`
        : ''
      parts.push(`  - Chose "${d.chosen_action}"${alts}${outcome}: ${d.reasoning}`)
    }
  }

  // 全部子段都被关闭/为空 → 不输出标题
  if (!any) return ''

  return parts.join('\n') + '\n'
}
