/**
 * AnomalyDetectorJob — Phase 22.D.1
 *
 * Pure rule-based scanner. No AI. Runs daily via cron (P22.D.3).
 *
 * Flow:
 *   1. For each active client, fetch the last 30 days of flywheel_metrics
 *      for every monitored metric key.
 *   2. Apply each matching AnomalyRule to (current, history).
 *   3. Collect fired AnomalySignal[]  (one per triggered rule per client).
 *   4. Persist to anomaly_signals table (status = 'fresh').
 *
 * Deduplication: skips insertion if an identical (client_id, rule_id)
 * 'fresh' signal already exists from today to avoid duplicate noise.
 */

import { supabaseAdmin } from '../../supabase'
import { ANOMALY_RULES } from './rules'
import type { AnomalySignal, MetricDataPoint } from './types'

const HISTORY_DAYS = 30

// ── Public API ────────────────────────────────────────────────────────────────

export interface AnomalyDetectorResult {
  scannedClients: number
  signalsDetected: number
  signalsPersisted: number
  errors: string[]
}

/**
 * Run the anomaly detector across all active clients.
 * Called by the cron route at /api/cron/anomaly-detector (P22.D.3).
 */
export async function runAnomalyDetector(): Promise<AnomalyDetectorResult> {
  const errors: string[] = []
  let signalsDetected = 0
  let signalsPersisted = 0

  const clientIds = await fetchActiveClientIds(errors)
  if (clientIds.length === 0) {
    return { scannedClients: 0, signalsDetected: 0, signalsPersisted: 0, errors }
  }

  for (const clientId of clientIds) {
    try {
      const signals = await scanClient(clientId)
      signalsDetected += signals.length
      const persisted = await persistSignals(signals, errors)
      signalsPersisted += persisted
    } catch (err) {
      errors.push(`client ${clientId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    scannedClients: clientIds.length,
    signalsDetected,
    signalsPersisted,
    errors,
  }
}

/**
 * Run the anomaly detector for a single client.
 * Useful for on-demand scans or testing.
 */
export async function scanClient(clientId: string): Promise<AnomalySignal[]> {
  const signals: AnomalySignal[] = []
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  for (const rule of ANOMALY_RULES) {
    const dataPoints = await fetchMetricHistory(clientId, rule.metricKey, since)
    if (dataPoints.length === 0) continue

    // Most recent reading is the "current" value; the rest are history (oldest first)
    const [current, ...historyReversed] = [...dataPoints].reverse()
    const history = historyReversed.reverse()

    const result = rule.detect(current.metric_value, history.map(d => d.metric_value))
    if (!result) continue

    signals.push({
      clientId,
      flywheel: rule.flywheel,
      metricKey: rule.metricKey,
      ruleId: rule.id,
      severity: rule.severity,
      currentValue: current.metric_value,
      referenceValue: history.length > 0 ? history[history.length - 1].metric_value : current.metric_value,
      deltaPct: result.deltaPct,
      description: result.description,
    })
  }

  return signals
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function fetchActiveClientIds(errors: string[]): Promise<string[]> {
  // clients 表从来没有 status 列 —— 这里此前一直静默查空（列不存在报错被吞）。
  // 阶段 0 加了 client_status 后，按真客户闸门的本意改读它。
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('client_status', 'active')

  if (error) {
    errors.push(`fetchActiveClientIds: ${error.message}`)
    return []
  }
  return (data ?? []).map(r => r.id)
}

async function fetchMetricHistory(
  clientId: string,
  metricKey: string,
  since: string
): Promise<MetricDataPoint[]> {
  const { data, error } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_value, measured_at')
    .eq('client_id', clientId)
    .eq('metric_key', metricKey)
    .gte('measured_at', since)
    .order('measured_at', { ascending: true })

  if (error) {
    console.error(`[AnomalyDetector] fetchMetricHistory error for ${clientId}/${metricKey}:`, error.message)
    return []
  }
  return data ?? []
}

async function persistSignals(
  signals: AnomalySignal[],
  errors: string[]
): Promise<number> {
  if (signals.length === 0) return 0

  const today = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'

  // Fetch existing fresh signals from today to deduplicate
  const ruleIds = signals.map(s => s.ruleId)
  const clientId = signals[0].clientId

  const { data: existing } = await supabaseAdmin
    .from('anomaly_signals')
    .select('rule_id')
    .eq('client_id', clientId)
    .eq('status', 'fresh')
    .in('rule_id', ruleIds)
    .gte('detected_at', `${today}T00:00:00Z`)

  const alreadyFired = new Set((existing ?? []).map(r => r.rule_id))

  const toInsert = signals
    .filter(s => !alreadyFired.has(s.ruleId))
    .map(s => ({
      client_id: s.clientId,
      flywheel: s.flywheel,
      metric_key: s.metricKey,
      rule_id: s.ruleId,
      severity: s.severity,
      current_value: s.currentValue,
      reference_value: s.referenceValue,
      delta_pct: s.deltaPct,
      description: s.description,
      status: 'fresh' as const,
    }))

  if (toInsert.length === 0) return 0

  const { error } = await supabaseAdmin.from('anomaly_signals').insert(toInsert)

  if (error) {
    errors.push(`persistSignals (${clientId}): ${error.message}`)
    return 0
  }

  return toInsert.length
}
