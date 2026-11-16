/**
 * Phone calls → CRM without Inngest (2026-11-16, Inngest monthly quota exhausted until about 12-01).
 *
 * The webhooks keep storing every raw call event; only the Inngest consumers stopped. This sweep, knocked by the
 * existing Render dispatcher, does the same two jobs the Inngest sweeps do but processes in-process instead of
 * re-sending events:
 *   1. raw events stored ≥5 min ago and not processed → processRawEvent (same function the Inngest consumer runs);
 *   2. calls with a recording and no finished analysis → runCallAnalysis (same caps, same on/off switch per line).
 *
 * Safe alongside Inngest: both sides only pick work that is still unfinished, and the stored state is re-read on
 * every step. One sweep at a time per process (the dispatcher can overlap ticks). No publishing, no outbound
 * messages to guests; the only writes are the call rows, raw-event status and CRM touchpoints the Inngest path writes.
 *
 * Switch: env INNGEST_DIRECT_FALLBACK = 'off' turns this off (use once Inngest is back, if double work shows up).
 */

import { sweepStaleRawEvents, type SweepResult } from '@/lib/inngest/functions/telephony-voipline'
import { planAnalysisSweep, type SweepCandidate, type SweepDeps } from '@/lib/inngest/functions/telephony-analysis'
import type { TelephonyStore } from '@/lib/telephony/voipline/types'

export interface DirectSweepDeps {
  store: TelephonyStore
  processRaw(rawEventId: string): Promise<unknown>
  analysisDeps: SweepDeps
  analyse(c: SweepCandidate): Promise<{ status: string }>
  now?: Date
}

export interface DirectSweepReceipt {
  status: 'done' | 'busy'
  crm: (SweepResult & { processFailed: number; firstError: string | null }) | null
  analysis: { candidates: number; byStatus: Record<string, number>; failed: number; firstError: string | null } | null
  no_publish: true
}

export function directFallbackEnabled(env: Record<string, string | undefined>): boolean {
  return (env.INNGEST_DIRECT_FALLBACK ?? '').trim().toLowerCase() !== 'off'
}

// Separate guards: a slow analysis round (transcription + model, minutes) must not hold up calls → CRM.
let crmRunning = false
let analysisRunning = false

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}

export async function runDirectTelephonySweep(deps: DirectSweepDeps): Promise<DirectSweepReceipt> {
  const crm = crmRunning ? null : await runCrmPart(deps)
  const analysis = analysisRunning ? null : await runAnalysisPart(deps)
  return { status: crm === null && analysis === null ? 'busy' : 'done', crm, analysis, no_publish: true }
}

async function runCrmPart(deps: DirectSweepDeps): Promise<NonNullable<DirectSweepReceipt['crm']>> {
  crmRunning = true
  try {
    let processFailed = 0
    let firstError: string | null = null
    // A failing event must not stop the rest; the next tick retries it (raw-event attempts cap at 10).
    const result = await sweepStaleRawEvents(deps.store, async (rawEventId) => {
      try {
        await deps.processRaw(rawEventId)
      } catch (err) {
        processFailed++
        firstError ??= errText(err)
      }
    }, deps.now)
    return { ...result, processFailed, firstError }
  } finally {
    crmRunning = false
  }
}

async function runAnalysisPart(deps: DirectSweepDeps): Promise<NonNullable<DirectSweepReceipt['analysis']>> {
  analysisRunning = true
  try {
    const candidates = await planAnalysisSweep(deps.analysisDeps)
    const byStatus: Record<string, number> = {}
    let failed = 0
    let firstError: string | null = null
    for (const c of candidates) {
      try {
        const out = await deps.analyse(c)
        byStatus[out.status] = (byStatus[out.status] ?? 0) + 1
      } catch (err) {
        failed++
        firstError ??= errText(err)
      }
    }
    return { candidates: candidates.length, byStatus, failed, firstError }
  } finally {
    analysisRunning = false
  }
}
