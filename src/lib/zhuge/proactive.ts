/**
 * 诸葛亮 Proactive — Phase 22.D.2
 *
 * Reads fresh anomaly_signals and decides:
 *   1. Whether to act on each signal (threshold + noise-filter)
 *   2. What flywheel_action to create (action_type, priority, description)
 *
 * This is the "intelligence layer" between the rule engine (AnomalyDetectorJob)
 * and the execution kanban. Unlike the full conductor flow which requires a
 * complete discovery bundle, this function works directly from metric anomalies.
 *
 * Flow per client:
 *   fresh anomaly_signals  →  Claude (Haiku, cheap)  →  ProactiveDecision[]
 *     → flywheel_actions(source='proactive_signal')
 *     → execution_items(source='proactive_signal', status='pending')
 *     → anomaly_signals.status = 'processed' | 'dismissed'
 *
 * Reference: ROADMAP.md § Phase 22.D
 */

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { getAnthropicClient, MODEL_HAIKU } from '@/lib/anthropic/client'
import { jsonrepair } from 'jsonrepair'
import type { AnomalySeverity } from '@/lib/flywheel/anomaly/types'

// Haiku pricing (per million tokens)
const HAIKU_PRICE_IN  = 0.80
const HAIKU_PRICE_OUT = 4.00

// ── Types ─────────────────────────────────────────────────────────────────────

/** One fresh signal row from anomaly_signals table. */
interface FreshSignal {
  id: string
  client_id: string
  flywheel: string
  metric_key: string
  rule_id: string
  severity: AnomalySeverity
  current_value: number
  reference_value: number
  delta_pct: number
  description: string
  detected_at: string
}

/** Claude's decision for one anomaly signal. */
interface ProactiveDecision {
  signal_id: string
  should_act: boolean
  /** If should_act=false, why we dismissed it (for logging). */
  dismiss_reason?: string
  /** action_type slug for flywheel_actions (required when should_act=true). */
  action_type?: string
  /** One-line Chinese description of the recommended action. */
  action_description?: string
  expected_impact: 'low' | 'medium' | 'high'
}

export interface ProactiveResult {
  client_id: string
  signals_read: number
  acted: number
  dismissed: number
  cost_usd: number
  errors: string[]
}

export interface BatchProactiveResult {
  clients_processed: number
  total_acted: number
  total_dismissed: number
  total_cost_usd: number
  errors: string[]
  results: ProactiveResult[]
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are 诸葛亮's Proactive Lens — a lightweight decision filter inside Magic Engine.

Your job: given a list of automatically detected metric anomalies for a client, decide which ones warrant creating a proactive task, and what that task should be.

## Decision rules
- "high" severity anomalies → almost always act (should_act: true), unless the data is clearly noisy (e.g. delta_pct only slightly over threshold, reference_value is zero or near-zero)
- "medium" severity → act only if the anomaly is sustained and actionable
- dismiss if: the metric_key is unfamiliar, the values seem nonsensical, or we already have an obvious structural reason (new client, no data history)
- Never create duplicate or vague tasks — action_type must be a concrete snake_case slug

## Output format
Respond with ONLY a JSON array. No markdown, no prose.
Each element:
{
  "signal_id": "<string>",
  "should_act": true | false,
  "dismiss_reason": "<string or omit>",
  "action_type": "<snake_case slug — required when should_act=true>",
  "action_description": "<1 sentence Chinese — required when should_act=true>",
  "expected_impact": "low" | "medium" | "high"
}`

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildUserPrompt(clientName: string, signals: FreshSignal[]): string {
  const lines = signals.map((s) =>
    `- id=${s.id} flywheel=${s.flywheel} rule=${s.rule_id} severity=${s.severity} ` +
    `delta_pct=${s.delta_pct.toFixed(1)}% current=${s.current_value} reference=${s.reference_value} ` +
    `description="${s.description}"`
  )
  return `Client: ${clientName}
Anomaly signals (${signals.length} fresh):
${lines.join('\n')}

Evaluate each signal and return your decisions as a JSON array.`
}

// ── Response parser ────────────────────────────────────────────────────────────

const VALID_IMPACTS = new Set(['low', 'medium', 'high'])

function parseDecisions(raw: string, signalIds: Set<string>): ProactiveDecision[] {
  const repaired = jsonrepair(raw.trim())
  const parsed = JSON.parse(repaired) as unknown[]

  if (!Array.isArray(parsed)) {
    throw new Error('Proactive response is not an array')
  }

  return parsed
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter((item) => typeof item.signal_id === 'string' && signalIds.has(item.signal_id))
    .map((item) => ({
      signal_id: item.signal_id as string,
      should_act: item.should_act === true,
      dismiss_reason: typeof item.dismiss_reason === 'string' ? item.dismiss_reason : undefined,
      action_type: typeof item.action_type === 'string' ? item.action_type : undefined,
      action_description: typeof item.action_description === 'string' ? item.action_description : undefined,
      expected_impact: VALID_IMPACTS.has(item.expected_impact as string)
        ? (item.expected_impact as ProactiveDecision['expected_impact'])
        : 'medium',
    }))
}

// ── Per-client processing ──────────────────────────────────────────────────────

async function processClient(
  clientId: string,
  signals: FreshSignal[],
  errors: string[]
): Promise<{ acted: number; dismissed: number; cost_usd: number }> {
  // Fetch client name for the prompt
  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('name')
    .eq('id', clientId)
    .single()

  const clientName = (clientRow as { name?: string } | null)?.name ?? clientId

  // Call Claude (Haiku — cheap, this runs daily)
  const signalIds = new Set(signals.map((s) => s.id))
  const userPrompt = buildUserPrompt(clientName, signals)

  let decisions: ProactiveDecision[] = []
  let cost_usd = 0

  try {
    const anthropic = getAnthropicClient()
    const message = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    cost_usd =
      (message.usage.input_tokens / 1_000_000) * HAIKU_PRICE_IN +
      (message.usage.output_tokens / 1_000_000) * HAIKU_PRICE_OUT
    decisions = parseDecisions(text, signalIds)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`client ${clientId} Claude call failed: ${msg}`)
    // Fall back: dismiss all signals so they don't pile up
    decisions = signals.map((s) => ({
      signal_id: s.id,
      should_act: false,
      dismiss_reason: 'claude_call_failed',
      expected_impact: 'low' as const,
    }))
  }

  // Any signal not in Claude's response: default to dismiss
  const decidedIds = new Set(decisions.map((d) => d.signal_id))
  for (const sig of signals) {
    if (!decidedIds.has(sig.id)) {
      decisions.push({
        signal_id: sig.id,
        should_act: false,
        dismiss_reason: 'no_decision_returned',
        expected_impact: 'low',
      })
    }
  }

  const toAct = decisions.filter((d) => d.should_act && d.action_type)
  const toDismiss = decisions.filter((d) => !d.should_act)

  // Build a lookup map for signal metadata
  const sigMap = new Map(signals.map((s) => [s.id, s]))

  // Persist acted decisions
  if (toAct.length > 0) {
    const flywheelRows = toAct.map((d) => {
      const sig = sigMap.get(d.signal_id)!
      return {
        client_id: clientId,
        flywheel: sig.flywheel,
        action_type: d.action_type!,
        execution_mode: 'in_house' as const,
        payload: {
          source: 'proactive_signal',
          anomaly_signal_id: sig.id,
          rule_id: sig.rule_id,
          severity: sig.severity,
          delta_pct: sig.delta_pct,
          description: sig.description,
          action_description: d.action_description,
        },
        expected_metric: sig.metric_key,
        executed_at: new Date().toISOString(),
      }
    })

    const { data: insertedActions, error: actionError } = await supabaseAdmin
      .from('flywheel_actions')
      .insert(flywheelRows)
      .select('id')

    if (actionError) {
      errors.push(`client ${clientId} flywheel_actions insert: ${actionError.message}`)
    } else {
      // Also write to execution_items for kanban visibility
      const actionIds = (insertedActions as { id: string }[] | null) ?? []
      const execRows = toAct.map((d, i) => {
        const sig = sigMap.get(d.signal_id)!
        return {
          client_id: clientId,
          dimension: sig.flywheel === 'geo' ? 'ai_visibility' : sig.flywheel,
          title: formatActionTitle(d.action_type!),
          description: d.action_description ?? sig.description,
          fix_type: 'me_auto' as const,
          action_type: d.action_type!,
          status: 'pending' as const,
          source: 'proactive_signal' as const,
          sort_order: sig.severity === 'high' ? 1 : 2,
          payload: {
            flywheel_action_id: actionIds[i]?.id ?? null,
            anomaly_signal_id: sig.id,
          },
        }
      })

      const { error: execError } = await supabaseAdmin
        .from('execution_items')
        .insert(execRows)

      if (execError) {
        errors.push(`client ${clientId} execution_items insert: ${execError.message}`)
      }

      // Link flywheel_actions back to anomaly_signals
      const actionSignalUpdates = toAct.map((d, i) => ({
        id: d.signal_id,
        flywheel_action_id: actionIds[i]?.id ?? null,
        status: 'processed' as const,
      }))

      for (const upd of actionSignalUpdates) {
        await supabaseAdmin
          .from('anomaly_signals')
          .update({ status: upd.status, flywheel_action_id: upd.flywheel_action_id })
          .eq('id', upd.id)
          .then(
            () => { /* ok */ },
            () => { /* non-fatal */ }
          )
      }
    }
  }

  // Mark dismissed signals
  if (toDismiss.length > 0) {
    const dismissIds = toDismiss.map((d) => d.signal_id)
    await supabaseAdmin
      .from('anomaly_signals')
      .update({ status: 'dismissed' })
      .in('id', dismissIds)
      .then(
        () => { /* ok */ },
        () => { /* non-fatal */ }
      )
  }

  return { acted: toAct.length, dismissed: toDismiss.length, cost_usd }
}

// ── Batch entry point ──────────────────────────────────────────────────────────

/**
 * Process all fresh anomaly_signals across all clients.
 * Called by POST /api/ai/zhugeliang/proactive (P22.D.2)
 * and the daily cron at /api/cron/anomaly-detector (P22.D.3).
 */
export async function runProactivePass(): Promise<BatchProactiveResult> {
  const errors: string[] = []

  // Fetch all fresh signals (up to 200 — avoids runaway queries)
  const { data: rawSignals, error: fetchErr } = await supabaseAdmin
    .from('anomaly_signals')
    .select('id, client_id, flywheel, metric_key, rule_id, severity, current_value, reference_value, delta_pct, description, detected_at')
    .eq('status', 'fresh')
    .order('detected_at', { ascending: false })
    .limit(200)

  if (fetchErr) {
    return {
      clients_processed: 0,
      total_acted: 0,
      total_dismissed: 0,
      total_cost_usd: 0,
      errors: [`fetch fresh signals: ${fetchErr.message}`],
      results: [],
    }
  }

  const signals = (rawSignals ?? []) as FreshSignal[]

  if (signals.length === 0) {
    return {
      clients_processed: 0,
      total_acted: 0,
      total_dismissed: 0,
      total_cost_usd: 0,
      errors: [],
      results: [],
    }
  }

  // Group by client
  const byClient = new Map<string, FreshSignal[]>()
  for (const sig of signals) {
    const arr = byClient.get(sig.client_id) ?? []
    arr.push(sig)
    byClient.set(sig.client_id, arr)
  }

  const results: ProactiveResult[] = []
  let totalActed = 0
  let totalDismissed = 0
  let totalCost = 0

  for (const [clientId, clientSignals] of Array.from(byClient)) {
    const clientErrors: string[] = []
    try {
      const { acted, dismissed, cost_usd } = await processClient(clientId, clientSignals, clientErrors)
      totalActed += acted
      totalDismissed += dismissed
      totalCost += cost_usd
      results.push({
        client_id: clientId,
        signals_read: clientSignals.length,
        acted,
        dismissed,
        cost_usd,
        errors: clientErrors,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`client ${clientId}: ${msg}`)
      results.push({
        client_id: clientId,
        signals_read: clientSignals.length,
        acted: 0,
        dismissed: 0,
        cost_usd: 0,
        errors: [msg],
      })
    }
    if (clientErrors.length > 0) errors.push(...clientErrors)
  }

  return {
    clients_processed: byClient.size,
    total_acted: totalActed,
    total_dismissed: totalDismissed,
    total_cost_usd: totalCost,
    errors,
    results,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatActionTitle(actionType: string): string {
  const slug = actionType.includes('.') ? actionType.split('.').pop()! : actionType
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
