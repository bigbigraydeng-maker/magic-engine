/**
 * POST /api/clients/[id]/zhuge/conduct
 *
 * Assemble the full evidence bundle for a client (张骞 discovery +
 * 华佗 diagnostic run + findings), call the 诸葛亮 conductor, and return
 * a prioritised work order (up to 5 PriorityAction items).
 *
 * Body (all optional):
 *   businessContext?: Partial<BusinessContext>  — caller overrides for
 *     market, budget, goals, blockers, has_fde
 *
 * Responses:
 *   200  { success: true,  output: ZhugeOutput, context_used: {...} }
 *   404  client not found
 *   422  no 张骞 discovery data exists yet (run discovery first)
 *   500  DB or Claude API error
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md Phase 12.G (P12.G.2)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { assembleZhugeInput } from '@/lib/zhuge/assembler'
import { conductPriorityActions } from '@/lib/zhuge/conductor'
import { persistZhugeActions, type PersistZhugeActionsResult } from '@/lib/zhuge/action-persister'
import {
  loadIndustryBenchmarkSummary,
  loadZhugeFeedbackSummary,
} from '@/lib/zhuge/memory-loader'
import type { BusinessContext, ZhugePromptMode } from '@/lib/zhuge/types'
import { loadMemoryForClient } from '@/lib/memory'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: {
    businessContext?: Partial<BusinessContext>
    promptMode?: ZhugePromptMode
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    // Empty body is valid — all fields optional
  }

  // DAPE W2 — Self-Serve callers can pass promptMode='short' to save tokens.
  // FDE callers omit it (defaults to 'long', backward-compat).
  const promptMode: ZhugePromptMode | undefined =
    body.promptMode === 'short' || body.promptMode === 'long' ? body.promptMode : undefined

  // Assemble ZhugeInput from real DB data
  let assembled: Awaited<ReturnType<typeof assembleZhugeInput>>
  try {
    assembled = await assembleZhugeInput(supabaseAdmin, clientId, body.businessContext)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg === 'NO_DISCOVERY') {
      return NextResponse.json(
        {
          success: false,
          error:
            '张骞 discovery data not found for this client. Run discovery first before calling the conductor.',
        },
        { status: 422 },
      )
    }

    if (msg === 'CLIENT_NOT_FOUND') {
      return NextResponse.json(
        { success: false, error: `Client ${clientId} not found.` },
        { status: 404 },
      )
    }

    console.error('[zhuge/conduct] assembler error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }

  // Phase 23.D: Load L3 memory context (non-blocking — failure returns empty context)
  const memoryContext = await loadMemoryForClient(supabaseAdmin, clientId, { maxRecentDecisions: 5 })

  // DAPE W2 — Load Layer 2 (industry benchmarks) + zhuge self-feedback loop.
  // Both are non-blocking; failure yields empty summaries that the conductor
  // formatter renders as zero-length strings (backward-compat).
  const [industryBenchmarkSummary, feedbackSummary] = await Promise.all([
    loadIndustryBenchmarkSummary(supabaseAdmin, clientId),
    loadZhugeFeedbackSummary(supabaseAdmin, clientId),
  ])

  // Call the 诸葛亮 conductor (with memory injected)
  let output: Awaited<ReturnType<typeof conductPriorityActions>>
  try {
    output = await conductPriorityActions({
      ...assembled.input,
      memoryContext,
      industryBenchmarkSummary,
      feedbackSummary,
      promptMode,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[zhuge/conduct] conductor error:', msg)
    return NextResponse.json({ success: false, error: `Conductor failed: ${msg}` }, { status: 500 })
  }

  // Persist priority actions to flywheel_actions (non-blocking — failure logged, not thrown)
  let persisted: PersistZhugeActionsResult | null = null
  try {
    persisted = await persistZhugeActions(supabaseAdmin, {
      clientId,
      discoveryId: assembled.discovery_id,
      diagnosticRunId: assembled.diagnostic_run_id,
      output,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[zhuge/conduct] persist error:', msg)
  }

  return NextResponse.json({
    success: true,
    output,
    context_used: {
      discovery_id: assembled.discovery_id,
      diagnostic_run_id: assembled.diagnostic_run_id,
      findings_count: assembled.findings_count,
      prompt_mode: promptMode ?? 'long',
      memory_loaded: memoryContext.has_content,
      memory_stats: {
        preferences: memoryContext.preferences.length,
        proven_patterns: memoryContext.proven_patterns.length,
        failed_experiments: memoryContext.failed_experiments.length,
        recent_decisions: memoryContext.recent_decisions.length,
      },
      // DAPE W2 — Layer 2 (industry) + self-feedback diagnostics
      industry_memory_loaded: industryBenchmarkSummary.has_content,
      industry_memory_stats: {
        sub_industry: industryBenchmarkSummary.sub_industry,
        dimensions: industryBenchmarkSummary.dimensions.length,
      },
      feedback_loop_loaded: feedbackSummary.has_content,
      feedback_loop_stats: {
        total: feedbackSummary.total,
        state_counts: feedbackSummary.state_counts,
        dismissed_keys: feedbackSummary.dismissed_keys.length,
        irrelevant_keys: feedbackSummary.irrelevant_keys.length,
      },
    },
    persisted,
  })
}
