/**
 * Phase B — ClientContext Loader
 *
 * Loads all client data in a single parallel query batch.
 * Every agent in the orchestration chain receives the same snapshot,
 * preventing the "stale data" inconsistency where agents called minutes
 * apart see different client states.
 *
 * Usage:
 *   const ctx = await loadClientContext(supabase, clientId)
 *   // pass ctx to all agents — do NOT let agents query clients/master_briefs independently
 *
 * Reference: ROADMAP.md Phase B
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMemoryForClient } from '@/lib/memory/service'
import type {
  ClientContext,
  ClientSummary,
  MasterBriefSummary,
  RecentOutcomeSummary,
} from './types'

const RECENT_OUTCOMES_DAYS = 30
const RECENT_OUTCOMES_LIMIT = 20

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load a unified ClientContext for the given client.
 *
 * Never throws — missing data degrades gracefully:
 *   - masterBrief: null if not found
 *   - memory: empty MemoryContext (has_content=false)
 *   - recentOutcomes: [] if table empty or query fails
 *
 * Throws only if the client row itself is missing (caller should 404).
 */
export async function loadClientContext(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientContext> {
  const snapshotAt = new Date().toISOString()

  // Load client row first — fail fast if not found
  const client = await loadClient(supabase, clientId)

  // Load remaining data in parallel — failures degrade gracefully
  const [masterBrief, memory, recentOutcomes] = await Promise.all([
    loadMasterBrief(supabase, clientId),
    loadMemoryForClient(supabase, clientId).catch(() => ({
      preferences: [],
      proven_patterns: [],
      failed_experiments: [],
      recent_decisions: [],
      has_content: false as const,
    })),
    loadRecentOutcomes(supabase, clientId),
  ])

  return {
    client,
    masterBrief,
    memory,
    recentOutcomes,
    snapshotAt,
  }
}

// ─── Private loaders ─────────────────────────────────────────────────────────

async function loadClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientSummary> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, domain, primary_keywords, brand_aliases, competitor_domains, industry, semrush_db')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    throw new Error(`Client not found: ${clientId}`)
  }

  return {
    id: data.id,
    name: data.name,
    domain: data.domain,
    primary_keywords: data.primary_keywords ?? null,
    brand_aliases: data.brand_aliases ?? null,
    competitor_domains: data.competitor_domains ?? null,
    industry: data.industry ?? null,
    market: (data.semrush_db === 'nz' ? 'NZ' : 'AU') as 'AU' | 'NZ',
    semrush_db: data.semrush_db ?? 'au',
  }
}

async function loadMasterBrief(
  supabase: SupabaseClient,
  clientId: string,
): Promise<MasterBriefSummary | null> {
  const { data } = await supabase
    .from('master_briefs')
    .select('brand_name, core_proposition, target_audience, content_pillars, keyword_seeds')
    .eq('client_id', clientId)
    .maybeSingle()

  if (!data) return null

  return {
    brand_name: data.brand_name ?? null,
    core_proposition: data.core_proposition ?? null,
    target_audience: data.target_audience ?? null,
    content_pillars: Array.isArray(data.content_pillars) ? data.content_pillars : null,
    keyword_seeds: Array.isArray(data.keyword_seeds) ? data.keyword_seeds : null,
  }
}

async function loadRecentOutcomes(
  supabase: SupabaseClient,
  clientId: string,
): Promise<RecentOutcomeSummary[]> {
  const since = new Date()
  since.setDate(since.getDate() - RECENT_OUTCOMES_DAYS)

  const { data } = await supabase
    .from('flywheel_outcomes')
    .select('action_id, metric_key, delta_pct, verdict, computed_at, flywheel_actions!inner(action_type, flywheel)')
    .eq('client_id', clientId)
    .gte('computed_at', since.toISOString())
    .in('verdict', ['confirmed', 'reversed', 'inconclusive'])
    .order('computed_at', { ascending: false })
    .limit(RECENT_OUTCOMES_LIMIT)
    .returns<Array<{
      metric_key: string
      delta_pct: number | null
      verdict: 'confirmed' | 'reversed' | 'inconclusive'
      computed_at: string
      flywheel_actions: { action_type: string; flywheel: string }
    }>>()

  if (!data) return []

  return data.map(row => ({
    action_type: row.flywheel_actions.action_type,
    flywheel: row.flywheel_actions.flywheel,
    verdict: row.verdict,
    metric_key: row.metric_key,
    delta_pct: row.delta_pct,
    computed_at: row.computed_at,
  }))
}
