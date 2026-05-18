/**
 * Score Explainer — Synthesis layer (P8.10.S3.3)
 *
 * For each dimension score AND the overall score, asks Claude Sonnet to write a
 * short Markdown caption (~60–120 words) answering "why is the score THIS
 * number?". Unlike the dimension narrator (P8.10.S3.2 — 200–400-word three-beat
 * narrative), these are caption-style blurbs anchored to the math: which
 * findings dragged the number down, which signals propped it up, and (for the
 * overall) how the weighted average resolves.
 *
 * One Claude call returns ALL explanations in a single JSON object — cheaper
 * than N calls and lets the model reason across dimensions when explaining the
 * overall score.
 *
 * Persistence: the caller (Report Composer in P8.10.S4) decides whether to
 * write each explanation to `diagnostic_narratives` (P8.10.S3.5).
 */

import { callClaudeWithDocs, MODEL_SONNET } from '@/lib/anthropic/client'
import type { NewFinding } from '@/lib/diagnostic/types'
import type { DiagnosticDimension } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScoreDimensionInput {
  dimension: DiagnosticDimension
  /** 0–100 integer, or null when the dimension is not configured. */
  score: number | null
  /** Weight in the overall score (0–1). Matches DIMENSION_WEIGHTS. */
  weight: number
  /** Findings the collector produced for this dimension. */
  findings: NewFinding[]
}

export interface ScoreExplainerInput {
  clientBrandName: string
  clientDomain: string
  /** Weighted overall score 0–100. */
  overallScore: number
  /** One entry per dimension that should be explained. Must be non-empty. */
  dimensions: ScoreDimensionInput[]
  /** Optional formatted brief excerpt for brand voice / positioning context. */
  briefText?: string
}

export type ScoreExplanationTarget = 'overall' | DiagnosticDimension

export interface ScoreExplanation {
  target: ScoreExplanationTarget
  /** Mirrors the input score (or overallScore for `target === 'overall'`). */
  score: number | null
  /** Short Markdown paragraph — ~60–120 words. */
  explanation_md: string
  /** finding_type values that backed this explanation ('overall' = union of all dimensions). */
  evidence_refs: string[]
}

export interface ScoreExplainerResult {
  explanations: ScoreExplanation[]
  cost_usd: number
  model_used: string
  generated_at: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTPUT_TOKENS = 1500
const WORD_BUDGET_MIN = 60
const WORD_BUDGET_MAX = 120

const SYSTEM_PROMPT = `You are a senior brand-health analyst writing the "why
this score?" captions for a diagnostic report on an AU/NZ business.

You will receive:
- The client's overall score (weighted 0–100).
- A list of dimensions, each with its score (or null = not configured), its
  weight in the overall average, and its findings.

Your job: write ONE short caption per dimension AND one caption for the
overall score. Each caption is ${WORD_BUDGET_MIN}–${WORD_BUDGET_MAX} words of
plain Markdown prose (no headings, no bullets). Each caption must:

  - Name the score explicitly ("X/100" or "not configured").
  - Anchor to the SPECIFIC findings that drove the number (cite finding_type
    or title) — drag-downs first, lift-ups second when applicable.
  - For the OVERALL caption, explain how the weighted average resolves —
    name the 1–2 dimensions that mattered most given their weight × gap.
  - For a dimension with a null score, explain what's missing (the
    "not configured" blocker) instead of inventing a number.

Use AU/NZ English spelling. No hedging filler. Never invent metrics not
present in the input.

RULES:
- Output ONLY a JSON object, no prose around it, no markdown fences.
- Schema:
  {
    "explanations": [
      { "target": "overall" | "<dimension>", "explanation_md": "string" },
      ...
    ]
  }
- You MUST include exactly one entry with target = "overall" plus one entry
  per dimension you were given. Do not invent dimensions.
- Each "explanation_md" stays inside the ${WORD_BUDGET_MIN}–${WORD_BUDGET_MAX} word budget.`

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function explainScores(
  input: ScoreExplainerInput,
): Promise<ScoreExplainerResult> {
  validateInput(input)

  const userMessage = buildUserMessage(input)

  const claudeResult = await callClaudeWithDocs({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })

  const parsed = parseClaudeResponse(claudeResult.text)
  const explanations = reconcileExplanations(parsed, input)

  return {
    explanations,
    cost_usd: claudeResult.cost_usd,
    model_used: MODEL_SONNET,
    generated_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateInput(input: ScoreExplainerInput): void {
  if (input.dimensions.length === 0) {
    throw new Error('Score explainer: at least one dimension is required.')
  }
  if (
    !Number.isFinite(input.overallScore) ||
    input.overallScore < 0 ||
    input.overallScore > 100
  ) {
    throw new Error(
      `Score explainer: overallScore must be 0–100, got ${input.overallScore}.`,
    )
  }
  for (const d of input.dimensions) {
    if (d.score === null) continue
    if (!Number.isFinite(d.score) || d.score < 0 || d.score > 100) {
      throw new Error(
        `Score explainer: dimension "${d.dimension}" score must be 0–100 or null, got ${d.score}.`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildUserMessage(input: ScoreExplainerInput): string {
  const parts: string[] = []

  parts.push(`Write the "why this score?" captions for the diagnostic report.`)
  parts.push('')

  parts.push(`## CLIENT`)
  parts.push(`- Brand: ${input.clientBrandName}`)
  parts.push(`- Domain: ${input.clientDomain}`)
  parts.push('')

  parts.push(`## OVERALL`)
  parts.push(`- Score: ${input.overallScore}/100`)
  parts.push('')

  if (input.briefText && input.briefText.trim().length > 0) {
    parts.push(`## CLIENT BRIEF EXCERPT`)
    parts.push(input.briefText.trim())
    parts.push('')
  }

  parts.push(`## DIMENSIONS (${input.dimensions.length})`)
  for (const d of input.dimensions) {
    parts.push(formatDimensionBlock(d))
  }

  parts.push('---')
  parts.push(
    `Output the JSON object now. Include exactly one "overall" entry and one entry per dimension above.`,
  )
  return parts.join('\n')
}

function formatDimensionBlock(d: ScoreDimensionInput): string {
  const lines: string[] = []
  lines.push(`### ${d.dimension}`)
  lines.push(
    `- Score: ${d.score === null ? 'null (not configured)' : `${d.score}/100`}`,
  )
  lines.push(`- Weight: ${d.weight}`)
  lines.push(`- Findings: ${d.findings.length}`)
  for (const f of d.findings) {
    lines.push(formatFindingLine(f))
  }
  lines.push('')
  return lines.join('\n')
}

function formatFindingLine(f: NewFinding): string {
  const ev = compactEvidence(f.evidence)
  const evidencePart = ev ? ` | evidence: ${ev}` : ''
  return `  • [${f.severity}] ${f.finding_type} — ${f.title} (fix: ${f.fix_type}, prio: ${f.priority_score})${evidencePart}`
}

function compactEvidence(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== 'object') return null
  try {
    const json = JSON.stringify(evidence)
    if (!json || json === '{}' || json === 'null') return null
    return json.length > 300 ? json.slice(0, 300) + '…' : json
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Response parsing & reconciliation
// ---------------------------------------------------------------------------

interface RawClaudeResponse {
  explanations?: unknown
}

interface RawExplanation {
  target?: unknown
  explanation_md?: unknown
}

function parseClaudeResponse(raw: string): RawExplanation[] {
  const stripped = stripCodeFence(raw).trim()

  let json: RawClaudeResponse
  try {
    json = JSON.parse(stripped) as RawClaudeResponse
  } catch {
    const match = stripped.match(/\{[\s\S]+\}/)
    if (!match) {
      throw new Error('Score explainer: Claude returned non-JSON output.')
    }
    try {
      json = JSON.parse(match[0]) as RawClaudeResponse
    } catch {
      throw new Error('Score explainer: Claude returned malformed JSON.')
    }
  }

  if (!Array.isArray(json.explanations) || json.explanations.length === 0) {
    throw new Error('Score explainer: response missing non-empty explanations array.')
  }
  return json.explanations as RawExplanation[]
}

function reconcileExplanations(
  raw: RawExplanation[],
  input: ScoreExplainerInput,
): ScoreExplanation[] {
  const requested = new Set<ScoreExplanationTarget>([
    'overall',
    ...input.dimensions.map(d => d.dimension),
  ])

  const scoreFor = (target: ScoreExplanationTarget): number | null => {
    if (target === 'overall') return input.overallScore
    return input.dimensions.find(d => d.dimension === target)?.score ?? null
  }

  const refsFor = (target: ScoreExplanationTarget): string[] => {
    if (target === 'overall') {
      return input.dimensions.flatMap(d => d.findings.map(f => f.finding_type as string))
    }
    const dim = input.dimensions.find(d => d.dimension === target)
    return dim ? dim.findings.map(f => f.finding_type as string) : []
  }

  const out: ScoreExplanation[] = []
  const seen = new Set<ScoreExplanationTarget>()

  for (const entry of raw) {
    if (typeof entry.target !== 'string') continue
    const target = entry.target as ScoreExplanationTarget
    if (!requested.has(target) || seen.has(target)) continue

    if (
      typeof entry.explanation_md !== 'string' ||
      entry.explanation_md.trim().length === 0
    ) {
      throw new Error(
        `Score explainer: explanation_md missing or empty for target "${target}".`,
      )
    }

    out.push({
      target,
      score: scoreFor(target),
      explanation_md: entry.explanation_md,
      evidence_refs: refsFor(target),
    })
    seen.add(target)
  }

  if (!seen.has('overall')) {
    throw new Error('Score explainer: response missing "overall" explanation.')
  }

  return out
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/m)
  return fenced ? fenced[1] : text
}
