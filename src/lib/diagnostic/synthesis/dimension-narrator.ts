/**
 * Dimension Narrator — Synthesis layer (P8.10.S3.2)
 *
 * For each of the 6 diagnostic dimensions (seo / ai_visibility / ads / social /
 * reputation / competitor), asks Claude Sonnet to write a single 200–400-word
 * Markdown narrative covering three beats a human consultant would write:
 *
 *   1. Current state  — what the data shows right now (with the score)
 *   2. Root cause     — *why* the score is where it is, anchored to findings
 *   3. Opportunities  — what to do next, anchored to findings + fix_type
 *
 * Why a dedicated module (not co-located with the collectors)?
 *   - Collectors stay deterministic / cheap. Narration is opt-in for full reports.
 *   - One Claude call per dimension keeps prompts focused and parsing simple.
 *
 * Persistence: the caller (Report Composer in P8.10.S4) decides whether to
 * write each narrative to `diagnostic_narratives` (P8.10.S3.5).
 */

import { callClaudeWithDocs, MODEL_SONNET } from '@/lib/anthropic/client'
import type { NewFinding } from '@/lib/diagnostic/types'
import type { DiagnosticDimension } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DimensionNarratorInput {
  clientBrandName: string
  clientDomain: string
  dimension: DiagnosticDimension
  /** 0–100 integer, or null when the dimension is not configured. */
  score: number | null
  /** Findings the collector produced for this dimension. Must be non-empty. */
  findings: NewFinding[]
  /** Optional formatted brief excerpt for brand voice / positioning context. */
  briefText?: string
}

export interface DimensionNarrativeResult {
  dimension: DiagnosticDimension
  narrative_md: string
  /** finding_type values of the findings that backed this narrative. */
  evidence_refs: string[]
  cost_usd: number
  model_used: string
  generated_at: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTPUT_TOKENS = 1024
const WORD_BUDGET_MIN = 200
const WORD_BUDGET_MAX = 400

const SYSTEM_PROMPT = `You are a senior brand-health analyst writing one section of a
diagnostic report for an AU/NZ business. The section covers ONE dimension at a
time (one of: seo, ai_visibility, ads, social, reputation, competitor).

Write a single Markdown narrative of ${WORD_BUDGET_MIN}–${WORD_BUDGET_MAX} words covering
exactly three beats, each as a bolded inline label inside the prose (NOT as
separate H2 headings):

  1. **Current state.** What the data actually shows for this dimension. Cite
     the dimension score (X/100) and reference the top 1–2 findings by their
     finding_type or title. If the score is null, say the dimension is "not
     yet configured" and name the blocker.

  2. **Root cause.** Why the score is where it is. Anchor to specific findings
     — e.g. severity, evidence values, fix_type. Do NOT invent metrics.

  3. **Opportunities.** What to do next. Two or three concrete moves, each tied
     to a finding's recommendation or fix_type. Prefer "me_auto" wins first
     (the platform can execute), then "fde_manual" / "third_party".

The narrative starts with an H2 heading naming the dimension (e.g. "## SEO",
"## AI Visibility"). Use AU/NZ English spelling. No hedging filler.

RULES:
- Output ONLY a JSON object, no prose around it, no markdown fences.
- Schema:
  {
    "narrative_md": "string — single Markdown narrative, starts with ## heading"
  }
- The narrative MUST contain the literal phrases "Current state", "Root cause",
  and "Opportunities" so downstream tooling can split it.
- Never invent metrics not present in the input.
- Stay inside the ${WORD_BUDGET_MIN}–${WORD_BUDGET_MAX} word budget.`

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function narrateDimension(
  input: DimensionNarratorInput,
): Promise<DimensionNarrativeResult> {
  if (input.findings.length === 0) {
    throw new Error(
      `Dimension narrator: at least one finding is required for "${input.dimension}".`,
    )
  }

  const userMessage = buildUserMessage(input)

  const claudeResult = await callClaudeWithDocs({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })

  const parsed = parseClaudeResponse(claudeResult.text)

  return {
    dimension: input.dimension,
    narrative_md: parsed.narrative_md,
    evidence_refs: input.findings.map(f => f.finding_type as string),
    cost_usd: claudeResult.cost_usd,
    model_used: MODEL_SONNET,
    generated_at: new Date().toISOString(),
  }
}

/**
 * Convenience: narrate a list of dimensions sequentially. Dimensions with no
 * findings are silently skipped (rather than failing the whole batch) so the
 * Report Composer can pass in all six dimensions and get whatever is narratable.
 */
export async function narrateAllDimensions(
  inputs: DimensionNarratorInput[],
): Promise<DimensionNarrativeResult[]> {
  const out: DimensionNarrativeResult[] = []
  for (const input of inputs) {
    if (input.findings.length === 0) continue
    out.push(await narrateDimension(input))
  }
  return out
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildUserMessage(input: DimensionNarratorInput): string {
  const parts: string[] = []

  parts.push(`Write the narrative for ONE dimension of the diagnostic report.`)
  parts.push('')

  parts.push(`## CLIENT`)
  parts.push(`- Brand: ${input.clientBrandName}`)
  parts.push(`- Domain: ${input.clientDomain}`)
  parts.push('')

  parts.push(`## DIMENSION`)
  parts.push(`- Key: ${input.dimension}`)
  parts.push(`- Score: ${input.score === null ? 'null (not configured)' : `${input.score}/100`}`)
  parts.push('')

  if (input.briefText && input.briefText.trim().length > 0) {
    parts.push(`## CLIENT BRIEF EXCERPT`)
    parts.push(input.briefText.trim())
    parts.push('')
  }

  parts.push(`## FINDINGS (${input.findings.length})`)
  for (const f of input.findings) {
    parts.push(formatFindingBlock(f))
  }

  parts.push('---')
  parts.push('Output the JSON object now. narrative_md required.')
  return parts.join('\n')
}

function formatFindingBlock(f: NewFinding): string {
  const lines: string[] = []
  lines.push(`### ${f.finding_type} (${f.severity})`)
  lines.push(`- Title: ${f.title}`)
  lines.push(`- Description: ${f.description}`)
  lines.push(`- Recommendation: ${f.recommendation}`)
  lines.push(`- Fix type: ${f.fix_type}`)
  lines.push(`- Priority: ${f.priority_score}`)
  if (f.evidence && typeof f.evidence === 'object') {
    const compact = compactEvidence(f.evidence)
    if (compact) lines.push(`- Evidence: ${compact}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** Flatten evidence to a single inline string, bounded so prompts stay small. */
function compactEvidence(evidence: Record<string, unknown>): string | null {
  try {
    const json = JSON.stringify(evidence)
    if (!json || json === '{}' || json === 'null') return null
    return json.length > 600 ? json.slice(0, 600) + '…' : json
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface RawClaudeResponse {
  narrative_md?: unknown
}

function parseClaudeResponse(raw: string): { narrative_md: string } {
  const stripped = stripCodeFence(raw).trim()

  let json: RawClaudeResponse
  try {
    json = JSON.parse(stripped) as RawClaudeResponse
  } catch {
    const match = stripped.match(/\{[\s\S]+\}/)
    if (!match) {
      throw new Error('Dimension narrator: Claude returned non-JSON output.')
    }
    try {
      json = JSON.parse(match[0]) as RawClaudeResponse
    } catch {
      throw new Error('Dimension narrator: Claude returned malformed JSON.')
    }
  }

  if (typeof json.narrative_md !== 'string' || json.narrative_md.trim().length === 0) {
    throw new Error('Dimension narrator: response missing narrative_md.')
  }

  return { narrative_md: json.narrative_md }
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/m)
  return fenced ? fenced[1] : text
}
