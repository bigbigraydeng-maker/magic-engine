/**
 * 诸葛亮 Conductor — 策略调度引擎
 *
 * conductPriorityActions(input) 接收张骞证据 + 华佗诊断，
 * 调用 Claude Sonnet 生成最高优先级的 work order（PriorityAction[]），
 * 供 P12.G.3 写入 flywheel_actions 表。
 *
 * Reference: ROADMAP.md Phase 12.G (P12.G.1)
 */

import { callClaudeChat } from '@/lib/anthropic/client'
import { jsonrepair } from 'jsonrepair'
import { formatMemoryForPrompt } from '@/lib/memory/format'
import {
  formatIndustryBenchmarkPrompt,
  formatZhugeFeedbackPrompt,
} from './memory-loader'
import type {
  ZhugeInput,
  ZhugeOutput,
  PriorityAction,
  DiagnosticScores,
  LubanTool,
  ZhugePromptMode,
} from './types'
import type { DiagnosticFinding } from '@/types/diagnostic'
import type { BusinessContext } from './types'

// Maximum actions the conductor will recommend per run.
// DAPE W2 — short mode tightens this further (spec §2.x.6: 自助客户限 3 议题).
const MAX_ACTIONS = 5
const MAX_ACTIONS_SHORT = 3

// DAPE W2 — output token budget per prompt mode (spec §2.x.6).
// Short ≈ 500 tokens prompt; long ≈ 3000 tokens prompt.
// We size completion budget proportionally.
const MAX_OUTPUT_TOKENS_LONG = 2048
const MAX_OUTPUT_TOKENS_SHORT = 1024

// ── System prompts (DAPE W2 dual-mode) ────────────────────────────────────────

const SYSTEM_PROMPT_LONG = `You are 诸葛亮 (Zhuge Liang), the Strategy Conductor inside Magic Engine — an AI-powered digital marketing platform for AU/NZ small businesses.

Your role in the four-agent chain:
  张骞 Scout  → collects discovery evidence
  华佗 Doctor → diagnoses problems and scores dimensions (0–100)
  **诸葛亮 Conductor (YOU)** → decides what to do first, why, and how
  鲁班 Builder → executes the work orders you produce

## Your task
Given a structured evidence package, produce a prioritised list of up to ${MAX_ACTIONS} concrete actions this client should take RIGHT NOW.

## Prioritisation framework (apply in order)
1. CRITICAL/HIGH severity findings that are quick wins (low effort, high impact)
2. Dimensions with the lowest scores — these drag down the overall health the most
3. Actions that are auto-executable by 鲁班 (prefer these — they move fast)
4. Actions that unblock other dimensions (e.g. fixing AI visibility unlocks GEO content)
5. Business-context fit: respect budget constraints, market (AU vs NZ), and known blockers
6. Client Memory (Layer 1): prefer proven patterns, avoid failed experiments, respect past decisions
7. Industry Memory (Layer 2): anchor recommendations to peer benchmarks; do not propose targets above P90 without justification
8. Self-Feedback Loop: do NOT re-propose suggestions the client has repeatedly dismissed; re-frame irrelevant ones

## Output rules
- Respond with ONLY a valid JSON object — no markdown, no commentary outside the JSON
- Top-level key: "top_actions" — an array of action objects
- Each action MUST include all required fields (see schema below)
- evidence_refs must cite real data from the input (keyword names, dimension names, finding types, metric values) — never invent references
- action_type must be a short snake_case slug, e.g. "publish_geo_directive", "fix_meta_titles", "pause_losing_keywords"
- why_now must be a concise Chinese sentence (1–2 sentences) a non-technical client can understand — write in Simplified Chinese
- executable_by: use the exact tool name from availableLubanTools if one matches; otherwise null
- Do NOT recommend actions for "reputation" or "competitor" dimensions — those are FDE-only external tasks

## Required JSON schema
{
  "top_actions": [
    {
      "rank": 1,
      "dimension": "seo" | "geo" | "ads" | "social",
      "action_type": "string (snake_case)",
      "why_now": "string",
      "evidence_refs": ["string", ...],
      "expected_impact": "low" | "medium" | "high",
      "effort": "low" | "medium" | "high",
      "execution_mode": "in_house" | "third_party" | "external_manual",
      "executable_by": "string | null"
    }
  ]
}`

// Short mode: self-serve client path. Tighter token budget, fewer actions,
// only client-level memory injected. Spec §1.5.6 + §2.x.6.
const SYSTEM_PROMPT_SHORT = `You are 诸葛亮 (Zhuge Liang), the Strategy Conductor inside Magic Engine.

Audience: a SELF-SERVE client running diagnostics themselves. Keep it short, concrete, and practical.

## Your task
Pick the top ${MAX_ACTIONS_SHORT} actions this client should do RIGHT NOW based on the findings below.

## Rules
1. CRITICAL/HIGH severity findings come first; pick low-effort high-impact ones
2. Respect Client Memory: avoid failed experiments and recently dismissed suggestions
3. Each why_now must be ≤1 short Chinese sentence — plain language
4. JSON only, no markdown
5. Do NOT recommend "reputation" or "competitor" actions

## Required JSON schema
{
  "top_actions": [
    {
      "rank": 1,
      "dimension": "seo" | "geo" | "ads" | "social",
      "action_type": "string (snake_case)",
      "why_now": "string",
      "evidence_refs": ["string", ...],
      "expected_impact": "low" | "medium" | "high",
      "effort": "low" | "medium" | "high",
      "execution_mode": "in_house" | "third_party" | "external_manual",
      "executable_by": "string | null"
    }
  ]
}`

/**
 * DAPE W2 — Select system prompt by mode. Defaults to long (FDE, backward-compat).
 * Exported so the route layer and tests can reason about the active mode.
 */
export function pickSystemPrompt(mode: ZhugePromptMode | undefined): string {
  return mode === 'short' ? SYSTEM_PROMPT_SHORT : SYSTEM_PROMPT_LONG
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildUserPrompt(input: ZhugeInput): string {
  const {
    client,
    diagnosticScores,
    findings,
    availableLubanTools,
    businessContext,
    memoryContext,
    industryBenchmarkSummary,
    feedbackSummary,
    promptMode,
  } = input

  const mode: ZhugePromptMode = promptMode ?? 'long'

  const scoreLines = formatScores(diagnosticScores)
  const findingLines = formatFindings(findings, mode)
  const toolLines = formatTools(availableLubanTools)
  const contextLines = formatBusinessContext(businessContext)
  const evidenceSummary = formatEvidenceSummary(input)

  // DAPE W2 — Layer 1 (client memory) is injected in both modes.
  // Layer 2 (industry) + self-feedback loop only in long mode (spec §2.x.6).
  const clientMemorySection = formatMemoryForPrompt(memoryContext, {
    // Short mode trims recent_decisions to save tokens — preferences still help.
    includeRecentDecisions: mode === 'long',
  })
  const industryMemorySection =
    mode === 'long' ? formatIndustryBenchmarkPrompt(industryBenchmarkSummary) : ''
  const feedbackSection =
    mode === 'long' ? formatZhugeFeedbackPrompt(feedbackSummary) : ''

  return `## Client
Name: ${client.name}
Domain: ${client.domain ?? 'not set'}
Market: ${businessContext.market}
Plan: ${client.plan_tier}
PromptMode: ${mode}

## Business Context
${contextLines}

## 华佗 Diagnostic Scores (0–100; null = data unavailable)
${scoreLines}

## 华佗 Findings (${findings.length} total)
${findingLines}

## 张骞 Evidence Summary
${evidenceSummary}

## 鲁班 Available Tools
${toolLines}
${clientMemorySection}${industryMemorySection}${feedbackSection}
---
Produce the prioritised work order now. Return ONLY the JSON object.`
}

function formatScores(scores: DiagnosticScores): string {
  const dims = ['seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor'] as const
  return dims
    .map(d => {
      const v = scores[d]
      const display = v == null ? 'null (skipped)' : `${v}/100`
      return `  ${d}: ${display}`
    })
    .join('\n')
}

function formatFindings(findings: DiagnosticFinding[], mode: ZhugePromptMode = 'long'): string {
  if (findings.length === 0) return '  (no findings)'
  // Sort: critical → high → medium → low
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4))
  // DAPE W2 — short mode keeps only the top 8 to stay within ~500 token budget.
  const limit = mode === 'short' ? 8 : 20
  return sorted
    .slice(0, limit)
    .map(f => `  [${f.severity.toUpperCase()}] ${f.dimension}/${f.finding_type}: ${f.title}`)
    .join('\n')
}

function formatTools(tools: LubanTool[]): string {
  if (tools.length === 0) return '  (none — all actions require FDE or external handling)'
  return tools
    .map(t => `  ${t.name} (${t.flywheel}/${t.execution_mode}): ${t.description}`)
    .join('\n')
}

function formatBusinessContext(ctx: BusinessContext): string {
  const parts: string[] = []
  if (ctx.monthly_budget_aud != null) parts.push(`Budget: AUD $${ctx.monthly_budget_aud}/month`)
  if (ctx.primary_goal) parts.push(`Primary goal: ${ctx.primary_goal}`)
  if (ctx.blockers.length > 0) parts.push(`Blockers: ${ctx.blockers.join(', ')}`)
  parts.push(`FDE assigned: ${ctx.has_fde ? 'yes' : 'no'}`)
  return parts.map(p => `  ${p}`).join('\n')
}

function formatEvidenceSummary(input: ZhugeInput): string {
  const ev = input.discoveryEvidence
  const lines: string[] = []

  if (ev.business) {
    lines.push(`  Industry: ${ev.business.industry.join(', ')}`)
    lines.push(`  Location: ${ev.business.location.city ?? ''}, ${ev.business.location.country}`)
  }
  if (ev.semrush_snapshot) {
    const s = ev.semrush_snapshot
    lines.push(`  SEMrush: traffic=${s.monthly_traffic ?? 'n/a'}, trust_score=${s.trust_score ?? 'n/a'}, keywords=${s.keyword_count ?? 'n/a'}`)
    if (s.top_keywords.length > 0) {
      const kws = s.top_keywords.slice(0, 3).map(k => `${k.keyword}(#${k.position})`).join(', ')
      lines.push(`  Top keywords: ${kws}`)
    }
  }
  if (ev.ai_visibility_results && ev.ai_visibility_results.length > 0) {
    const notMentioned = ev.ai_visibility_results.filter(r => !r.client_mentioned).length
    lines.push(`  AI visibility: ${notMentioned}/${ev.ai_visibility_results.length} queries — client NOT mentioned`)
  }
  if (ev.social_profiles.length > 0) {
    const platforms = ev.social_profiles.map(s => s.platform).join(', ')
    lines.push(`  Social profiles found: ${platforms}`)
  }
  if (ev.gbp) {
    lines.push(`  GBP rating: ${ev.gbp.rating ?? 'n/a'} (${ev.gbp.review_count ?? 0} reviews)`)
  }
  if (ev.meta_ads) {
    lines.push(`  Meta ads: ${ev.meta_ads.active_ads_count} active ads, spend=${ev.meta_ads.estimated_spend}`)
  }

  return lines.length > 0 ? lines.join('\n') : '  (no evidence snapshot available)'
}

// ── Output parser ─────────────────────────────────────────────────────────────

function parseOutput(raw: string): PriorityAction[] {
  const repaired = jsonrepair(raw.trim())
  const parsed = JSON.parse(repaired) as { top_actions?: unknown }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.top_actions)) {
    throw new Error('Conductor response missing top_actions array')
  }

  return parsed.top_actions.map((item, i) => validateAction(item, i + 1))
}

// Prompt schema uses 'geo'; runtime must normalise to canonical 'ai_visibility'
const GEO_ALIASES: Record<string, string> = { geo: 'ai_visibility' }
const VALID_DIMENSIONS = new Set(['seo', 'ai_visibility', 'ads', 'social'])
const VALID_IMPACTS = new Set(['low', 'medium', 'high'])
const VALID_MODES = new Set(['in_house', 'third_party', 'external_manual'])

function validateAction(raw: unknown, fallbackRank: number): PriorityAction {
  if (!raw || typeof raw !== 'object') throw new Error(`Action ${fallbackRank} is not an object`)
  const a = raw as Record<string, unknown>

  const rawDim = typeof a.dimension === 'string' ? (GEO_ALIASES[a.dimension] ?? a.dimension) : ''
  const dimension = VALID_DIMENSIONS.has(rawDim)
    ? (rawDim as PriorityAction['dimension'])
    : 'seo'

  return {
    rank: typeof a.rank === 'number' ? a.rank : fallbackRank,
    dimension,
    action_type: typeof a.action_type === 'string' ? a.action_type : 'manual_review',
    why_now: typeof a.why_now === 'string' ? a.why_now : '',
    evidence_refs: Array.isArray(a.evidence_refs)
      ? (a.evidence_refs as unknown[]).filter((r): r is string => typeof r === 'string')
      : [],
    expected_impact: VALID_IMPACTS.has(a.expected_impact as string)
      ? (a.expected_impact as PriorityAction['expected_impact'])
      : 'medium',
    effort: VALID_IMPACTS.has(a.effort as string)
      ? (a.effort as PriorityAction['effort'])
      : 'medium',
    execution_mode: VALID_MODES.has(a.execution_mode as string)
      ? (a.execution_mode as PriorityAction['execution_mode'])
      : 'external_manual',
    executable_by: typeof a.executable_by === 'string' ? a.executable_by : null,
  }
}

// ── Main conductor function ───────────────────────────────────────────────────

/**
 * Call the 诸葛亮 conductor with a structured evidence bundle.
 * Returns a prioritised work order (up to MAX_ACTIONS actions).
 *
 * DAPE W2 — Honors `input.promptMode` ('short' for self-serve, 'long' for FDE).
 * Defaults to 'long' to preserve backward compatibility with existing callers.
 *
 * Throws if the Claude API call fails or the response cannot be parsed.
 */
export async function conductPriorityActions(input: ZhugeInput): Promise<ZhugeOutput> {
  const mode: ZhugePromptMode = input.promptMode ?? 'long'
  const userPrompt = buildUserPrompt(input)
  const systemPrompt = pickSystemPrompt(mode)
  const maxOutputTokens =
    mode === 'short' ? MAX_OUTPUT_TOKENS_SHORT : MAX_OUTPUT_TOKENS_LONG
  const actionCap = mode === 'short' ? MAX_ACTIONS_SHORT : MAX_ACTIONS

  // DAPE W2 — observable memory hit logging (spec §3.x metrics requirement).
  // One line per call so we can grep production logs and prove memory is read.
  console.info('[zhuge/conductor] memory hits', JSON.stringify({
    client_id: input.client.id,
    mode,
    memory_l1: Boolean(input.memoryContext?.has_content),
    memory_l1_counts: input.memoryContext ? {
      preferences: input.memoryContext.preferences.length,
      proven_patterns: input.memoryContext.proven_patterns.length,
      failed_experiments: input.memoryContext.failed_experiments.length,
      recent_decisions: input.memoryContext.recent_decisions.length,
    } : null,
    memory_l2: Boolean(input.industryBenchmarkSummary?.has_content),
    memory_l2_dimensions: input.industryBenchmarkSummary?.dimensions.length ?? 0,
    feedback_loop: Boolean(input.feedbackSummary?.has_content),
    feedback_total: input.feedbackSummary?.total ?? 0,
  }))

  const result = await callClaudeChat({
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens,
  })

  const top_actions = parseOutput(result.text)

  return {
    top_actions: top_actions.slice(0, actionCap),
    generated_at: new Date().toISOString(),
    cost_usd: result.cost_usd,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
  }
}

// ── Exported helpers (used by P12.G.2 wiring) ────────────────────────────────

export { buildUserPrompt, parseOutput, validateAction }
export { MAX_ACTIONS, MAX_ACTIONS_SHORT }
// DAPE W2 — kept for downstream tests that need to assert against system prompts.
export { SYSTEM_PROMPT_LONG, SYSTEM_PROMPT_SHORT }
