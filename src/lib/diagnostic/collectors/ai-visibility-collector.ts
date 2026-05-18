import type { SupabaseClient } from '@supabase/supabase-js'
import type { CollectorResult, NewFinding } from '../types'
import { makeEvidence } from '../types'
import {
  runProbeWithTimeout,
  type LiveProbe,
  type LiveProbeResult,
} from '../ai-visibility-live-probe'

// ---------------------------------------------------------------------------
// Snapshot shape (subset of ai_visibility_snapshots columns)
// ---------------------------------------------------------------------------

interface VisibilitySnapshot {
  avg_rank: number | null
  mentions_count: number
  total_runs: number
  week_of: string
}

interface ClientRow {
  name: string
}

interface BriefRow {
  brand_name: string | null
}

// ---------------------------------------------------------------------------
// AiVisibilityCollector
// ---------------------------------------------------------------------------

export class AiVisibilityCollector {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly liveProbe: LiveProbe | null = null,
  ) {}

  async collect(
    clientId: string,
    _domain: string,
    _keywords: string[],
  ): Promise<CollectorResult> {
    try {
      const { data, error } = await this.supabase
        .from('ai_visibility_snapshots')
        .select('avg_rank, mentions_count, total_runs, week_of')
        .eq('client_id', clientId)
        .order('week_of', { ascending: false })
        .limit(1)

      // P8.5.22: DB error → cannot evaluate, not "zero score"
      if (error) return { score: null, findings: [] }

      const snapshot = (data as VisibilitySnapshot[] | null)?.[0] ?? null

      // P8.10.S2.5: run real-time probe so a freshly-onboarded client (no
      // snapshot yet) still gets a real signal in this diagnostic. The probe
      // is also useful when the snapshot is stale or shows 0 mentions — the
      // probe can either confirm or contradict the cached state.
      const probe = await this.maybeRunLiveProbe(clientId)

      if (!snapshot) {
        // No weekly snapshot — fall back to live probe results when present.
        if (probe && !probe.skipped && probe.runs > 0) {
          return this.buildFromLiveProbe(clientId, probe)
        }
        return {
          score: null,
          findings: [this.makeAiVisibilityNotTrackedFinding(clientId)],
        }
      }

      // Snapshot exists with 0 mentions → real signal: client is invisible to AI
      if (snapshot.mentions_count === 0) {
        return {
          score: 0,
          findings: [this.makeNotMentionedFinding(clientId, probe)],
        }
      }

      return this.buildResult(clientId, snapshot, probe)
    } catch {
      return { score: null, findings: [] }
    }
  }

  // ---------------------------------------------------------------------------
  // Live probe orchestration
  // ---------------------------------------------------------------------------

  private async maybeRunLiveProbe(clientId: string): Promise<LiveProbeResult | null> {
    if (!this.liveProbe) return null
    try {
      const brandName = await this.loadBrandName(clientId)
      if (!brandName) return null
      return await runProbeWithTimeout(this.liveProbe, { clientId, brandName })
    } catch {
      return null
    }
  }

  private async loadBrandName(clientId: string): Promise<string | null> {
    try {
      const { data: client } = await this.supabase
        .from('clients')
        .select('name')
        .eq('id', clientId)
        .single()
      const clientRow = client as ClientRow | null

      const { data: brief } = await this.supabase
        .from('master_briefs')
        .select('brand_name')
        .eq('client_id', clientId)
        .eq('status', 'active')
        .maybeSingle()
      const briefRow = brief as BriefRow | null

      const name = briefRow?.brand_name?.trim() || clientRow?.name?.trim()
      return name || null
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Finding builders
  // ---------------------------------------------------------------------------

  private makeAiVisibilityNotTrackedFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'ai_visibility',
      finding_type: 'ai_visibility_not_tracked',
      severity: 'critical',
      title: 'AI Visibility Tracker not yet enabled',
      description:
        'No AI Visibility snapshot exists for this client — AI Tracker has never queried ChatGPT / Perplexity / Gemini for this brand. AI engine visibility is a core differentiator in the current GEO landscape; without tracking we cannot measure or improve it.',
      evidence: makeEvidence({ parsed: { snapshots: 0 } }),
      recommendation:
        'Enable weekly AI Tracker: configure 10–20 priority brand/category questions in Client Settings → AI Visibility, then wait for the next Monday cron run (or trigger an ad-hoc run via Run-once button).',
      fix_type: 'me_auto',
      priority_score: 88,
    }
  }

  // ---------------------------------------------------------------------------
  // Result composition
  // ---------------------------------------------------------------------------

  private buildResult(
    clientId: string,
    snapshot: VisibilitySnapshot,
    probe: LiveProbeResult | null,
  ): CollectorResult {
    const findings: NewFinding[] = []
    const mentionRate = snapshot.mentions_count / Math.max(1, snapshot.total_runs)

    const rankScore =
      snapshot.avg_rank !== null
        ? Math.max(0, (5 - snapshot.avg_rank) / 4)
        : 0

    const score = Math.min(100, Math.max(0, Math.round(mentionRate * 70 + rankScore * 30)))

    if (snapshot.avg_rank !== null && snapshot.avg_rank > 3) {
      findings.push({
        client_id: clientId,
        dimension: 'ai_visibility',
        finding_type: 'low_ai_rank',
        severity: 'high',
        title: 'Low AI Ranking Position',
        description: `Your brand appears at an average position of ${snapshot.avg_rank.toFixed(1)} in AI responses, below the recommended threshold of 3.`,
        evidence: makeEvidence({
          parsed: {
            avg_rank: snapshot.avg_rank,
            mentions_count: snapshot.mentions_count,
            total_runs: snapshot.total_runs,
            week_of: snapshot.week_of,
            live_probe: probeEvidence(probe),
          },
        }),
        recommendation:
          'Strengthen your brand\'s online authority by creating comprehensive FAQ content, earning mentions on authoritative sites, and implementing GEO directives in your content.',
        fix_type: 'fde_manual',
        priority_score: 70,
      })
    }

    // P8.10.S2.5: when the live probe contradicts a healthy snapshot
    // (0 mentions across 3 fresh questions), surface the regression early.
    if (probe && !probe.skipped && probe.runs > 0 && probe.mentions === 0 && snapshot.mentions_count > 0) {
      findings.push({
        client_id: clientId,
        dimension: 'ai_visibility',
        finding_type: 'live_probe_no_mention',
        severity: 'high',
        title: 'Live AI probe found no mentions',
        description: `The diagnostic-time probe ran ${probe.runs} priority question(s) on ChatGPT and your brand was not mentioned, even though last week's snapshot showed ${snapshot.mentions_count} mention(s). This may indicate a regression in AI visibility.`,
        evidence: makeEvidence({
          parsed: {
            snapshot_mentions: snapshot.mentions_count,
            live_probe: probeEvidence(probe),
          },
        }),
        recommendation:
          'Re-run the AI Tracker to confirm the trend, then prioritise GEO content updates and authoritative citations to restore visibility.',
        fix_type: 'fde_manual',
        priority_score: 75,
      })
    }

    return { score, findings }
  }

  private buildFromLiveProbe(clientId: string, probe: LiveProbeResult): CollectorResult {
    const mentionRate = probe.mentions / Math.max(1, probe.runs)
    const rankScore =
      probe.avg_rank !== null ? Math.max(0, (5 - probe.avg_rank) / 4) : 0
    const score = Math.min(100, Math.max(0, Math.round(mentionRate * 70 + rankScore * 30)))

    const findings: NewFinding[] = []
    if (probe.mentions === 0) {
      findings.push({
        client_id: clientId,
        dimension: 'ai_visibility',
        finding_type: 'brand_not_mentioned',
        severity: 'critical',
        title: 'Brand Not Mentioned by AI (live probe)',
        description: `A diagnostic-time probe ran ${probe.runs} priority question(s) on ChatGPT and your brand was not mentioned. AI-powered search is growing rapidly — missing from AI results means missing a key discovery channel.`,
        evidence: makeEvidence({ parsed: { live_probe: probeEvidence(probe) } }),
        recommendation:
          'Add GEO directives to your content, create entity-rich FAQ pages, and build citations on authoritative NZ/AU sites to improve AI visibility. Enable the weekly AI Tracker to monitor progress.',
        fix_type: 'fde_manual',
        priority_score: 95,
      })
    } else if (probe.avg_rank !== null && probe.avg_rank > 3) {
      findings.push({
        client_id: clientId,
        dimension: 'ai_visibility',
        finding_type: 'low_ai_rank',
        severity: 'high',
        title: 'Low AI Ranking Position (live probe)',
        description: `Your brand appeared at an average position of ${probe.avg_rank.toFixed(1)} in a ${probe.runs}-question diagnostic probe, below the recommended threshold of 3.`,
        evidence: makeEvidence({ parsed: { live_probe: probeEvidence(probe) } }),
        recommendation:
          'Strengthen your brand\'s online authority by creating comprehensive FAQ content, earning mentions on authoritative sites, and implementing GEO directives in your content.',
        fix_type: 'fde_manual',
        priority_score: 70,
      })
    }

    return { score, findings }
  }

  private makeNotMentionedFinding(clientId: string, probe: LiveProbeResult | null): NewFinding {
    return {
      client_id: clientId,
      dimension: 'ai_visibility',
      finding_type: 'brand_not_mentioned',
      severity: 'critical',
      title: 'Brand Not Mentioned by AI',
      description:
        'Your brand was not mentioned in any AI engine responses this week. AI-powered search is growing rapidly — missing from AI results means missing a key discovery channel.',
      evidence: probe && !probe.skipped
        ? makeEvidence({ parsed: { live_probe: probeEvidence(probe) } })
        : null,
      recommendation:
        'Add GEO directives to your content, create entity-rich FAQ pages, and build citations on authoritative NZ/AU sites to improve AI visibility.',
      fix_type: 'fde_manual',
      priority_score: 95,
    }
  }
}

// ---------------------------------------------------------------------------
// Evidence serialiser — keeps live-probe shape consistent across findings.
// ---------------------------------------------------------------------------

function probeEvidence(probe: LiveProbeResult | null): Record<string, unknown> | null {
  if (!probe || probe.skipped) return null
  return {
    runs: probe.runs,
    mentions: probe.mentions,
    avg_rank: probe.avg_rank,
    questions: probe.questions,
    latency_ms: probe.latency_ms,
  }
}
