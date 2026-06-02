/**
 * Phase 22.C.2 — Intelligence Context Loader for AI Factory
 *
 * loadIntelligenceContext():
 *   Fetches the latest 28-day MetricSummaryTile data for the 7 spotlight
 *   metrics from flywheel_metrics and returns a compact "intelligence block"
 *   string ready to be appended to the AI Factory system prompt.
 *
 * Design constraints:
 *   - Single Supabase query (< 50ms on average)
 *   - No new DB tables or migrations
 *   - Returns null gracefully if no data exists (factory still works without it)
 *   - Pure string output — caller decides where to inject it in the prompt
 *
 * Reference: ROADMAP.md P22.C.2
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { SPOTLIGHT_METRIC_KEYS } from '@/lib/flywheel/intelligence/metric-catalog'
import { getMetricMeta } from '@/lib/flywheel/intelligence/metric-catalog'
import type { MetricDirection, MetricUnit } from '@/lib/flywheel/intelligence/types'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the last 28-day intelligence signals for a client.
 * Returns a formatted string block for prompt injection, or null when no data.
 *
 * @param supabase  Any Supabase client (admin or user-scoped)
 * @param clientId  The client to load signals for
 */
export async function loadIntelligenceContext(
  supabase: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  try {
    const now    = new Date()
    const cutoff = new Date(now.getTime() - 30 * 86_400_000)

    const { data: rows, error } = await supabase
      .from('flywheel_metrics')
      .select('metric_key, metric_value, measured_at')
      .eq('client_id', clientId)
      .in('metric_key', SPOTLIGHT_METRIC_KEYS)
      .gte('measured_at', cutoff.toISOString())
      .order('measured_at', { ascending: true })

    if (error || !rows || rows.length === 0) return null

    // Group by metric_key, take first + last value for delta calculation
    const groups = new Map<string, { first: number; last: number; count: number }>()
    for (const row of rows) {
      const key = row.metric_key as string
      const val = row.metric_value as number
      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, { first: val, last: val, count: 1 })
      } else {
        existing.last = val
        existing.count++
        groups.set(key, existing)
      }
    }

    const signals: SignalLine[] = []
    for (const metricKey of SPOTLIGHT_METRIC_KEYS) {
      const group = groups.get(metricKey)
      if (!group || group.last === null) continue

      const meta     = getMetricMeta(metricKey)
      const deltaPct = computeDelta(group.last, group.first)

      signals.push({
        label:     meta.label,
        current:   group.last,
        deltaPct,
        unit:      meta.unit,
        direction: meta.direction,
      })
    }

    if (signals.length === 0) return null

    return buildIntelligenceBlock(signals)
  } catch {
    // Never throw — factory generation must work even if intelligence fails
    return null
  }
}

// ─── Prompt formatter ─────────────────────────────────────────────────────────

interface SignalLine {
  label:     string
  current:   number
  deltaPct:  number | null
  unit:      MetricUnit
  direction: MetricDirection
}

function buildIntelligenceBlock(signals: SignalLine[]): string {
  const lines: string[] = ['## Data Intelligence Signals (Last 28 Days)', '']

  // Separate into improving, declining, and stable
  const improving = signals.filter(s => isImproving(s))
  const declining = signals.filter(s => isDeclining(s))
  const stable    = signals.filter(s => !isImproving(s) && !isDeclining(s))

  if (improving.length > 0) {
    lines.push('**Performing well (prioritise these angles):**')
    for (const s of improving) {
      lines.push(`- ${s.label}: ${formatValue(s.current, s.unit)} (${formatDelta(s.deltaPct)} vs 28d ago)`)
    }
    lines.push('')
  }

  if (declining.length > 0) {
    lines.push('**Needs attention (address in content where relevant):**')
    for (const s of declining) {
      lines.push(`- ${s.label}: ${formatValue(s.current, s.unit)} (${formatDelta(s.deltaPct)} vs 28d ago)`)
    }
    lines.push('')
  }

  if (stable.length > 0) {
    lines.push('**Stable:**')
    for (const s of stable) {
      lines.push(`- ${s.label}: ${formatValue(s.current, s.unit)}`)
    }
    lines.push('')
  }

  lines.push(
    'Use this data to select content angles that reinforce performing channels and address weaknesses.',
    'Do NOT cite these numbers directly in the generated content — use them to guide tone and angle selection only.',
  )

  return lines.join('\n')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const IMPROVEMENT_THRESHOLD = 10  // > +10% delta counts as "improving"
const DECLINE_THRESHOLD     = -10  // < -10% delta counts as "declining"

function isImproving(s: SignalLine): boolean {
  if (s.deltaPct === null) return false
  // For higher_is_better: positive delta = good; for lower_is_better: negative delta = good
  const effective = s.direction === 'lower_is_better' ? -(s.deltaPct) : s.deltaPct
  return effective > IMPROVEMENT_THRESHOLD
}

function isDeclining(s: SignalLine): boolean {
  if (s.deltaPct === null) return false
  const effective = s.direction === 'lower_is_better' ? -(s.deltaPct) : s.deltaPct
  return effective < DECLINE_THRESHOLD
}

function computeDelta(current: number, reference: number): number | null {
  if (reference === 0) return null
  return ((current - reference) / Math.abs(reference)) * 100
}

function formatDelta(deltaPct: number | null): string {
  if (deltaPct === null) return 'N/A'
  const sign = deltaPct >= 0 ? '+' : ''
  return `${sign}${deltaPct.toFixed(1)}%`
}

function formatValue(val: number, unit: MetricUnit): string {
  switch (unit) {
    case 'currency':   return `$${val.toFixed(2)}`
    case 'percent':    return `${(val * 100).toFixed(1)}%`
    case 'percent100': return `${val.toFixed(1)}%`
    case 'ratio':      return `${val.toFixed(2)}x`
    case 'seconds':    return `${Math.round(val)}s`
    case 'rank':       return `#${val.toFixed(1)}`
    default:           return val.toLocaleString()
  }
}
