import type { DiagnosticFinding } from '@/types/diagnostic'

// Finding shape produced by a collector — id/run_id/created_at are assigned on persist
export type NewFinding = Omit<DiagnosticFinding, 'id' | 'run_id' | 'created_at'>

export interface CollectorResult {
  /**
   * 0–100 integer when the dimension can be evaluated.
   * `null` when prerequisite data is missing (e.g. no keywords configured,
   * business not listed on Google, no social accounts linked).
   * `null` dimensions are excluded from overall_score weighting and rendered
   * as "未配置 / Not configured" in the UI.
   */
  score: number | null
  findings: NewFinding[]
}

// ---------------------------------------------------------------------------
// P8.10.S2.6 — Unified evidence schema
// ---------------------------------------------------------------------------

/** External resource a piece of evidence was derived from. */
export interface EvidenceSource {
  /** Fully qualified URL of the source (API endpoint, scraped page, …). */
  url: string
  /** ISO timestamp at which the source was fetched. */
  fetched_at: string
}

/**
 * Canonical envelope every collector wraps its finding evidence in.
 *
 * Goals (see ROADMAP P8.10.S2.6):
 *   - `parsed` — structured signals downstream renderers / synthesizers consume
 *   - `raw`    — upstream payload (HTML snippet, API JSON, scrape sample) so
 *                future re-analysis is possible without re-collecting
 *   - `sources` — auditable list of URLs that backed the parsed signals
 *   - `collected_at` — when collection happened, so staleness is detectable
 */
export interface EvidenceEnvelope {
  [key: string]: unknown
  raw: unknown
  parsed: Record<string, unknown> | null
  sources: EvidenceSource[]
  collected_at: string
}

export interface MakeEvidenceArgs {
  parsed?: Record<string, unknown> | null
  raw?: unknown
  sources?: EvidenceSource[]
  /** Override timestamp — primarily for deterministic tests. */
  collected_at?: string
}

/** Wraps structured evidence in the canonical envelope. */
export function makeEvidence(args: MakeEvidenceArgs = {}): EvidenceEnvelope {
  return {
    raw: args.raw ?? null,
    parsed: args.parsed ?? null,
    sources: args.sources ?? [],
    collected_at: args.collected_at ?? new Date().toISOString(),
  }
}

/** Convenience constructor for an EvidenceSource with `fetched_at = now`. */
export function evidenceSource(url: string, fetchedAt?: string): EvidenceSource {
  return { url, fetched_at: fetchedAt ?? new Date().toISOString() }
}

/**
 * Extracts auditable source URLs from a finding's evidence field.
 * Returns source URLs when the evidence is an EvidenceEnvelope; returns `[]` otherwise.
 * Used by the report composer to populate the evidence.json refs for each finding.
 */
export function extractEvidenceRefs(evidence: Record<string, unknown> | null | undefined): string[] {
  if (!isEvidenceEnvelope(evidence)) return []
  return evidence.sources.map(s => s.url).filter(Boolean)
}

/**
 * Type guard — true when a finding's evidence already follows the envelope shape.
 * Used by tests and downstream code that wants to safely read `parsed.*`.
 */
export function isEvidenceEnvelope(v: unknown): v is EvidenceEnvelope {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (
    'raw' in e &&
    'parsed' in e &&
    'sources' in e &&
    'collected_at' in e &&
    Array.isArray(e.sources) &&
    typeof e.collected_at === 'string'
  )
}
