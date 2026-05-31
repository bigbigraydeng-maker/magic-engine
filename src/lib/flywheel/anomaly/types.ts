/**
 * Shared types for the AnomalyDetector subsystem (Phase 22.D).
 *
 * AnomalyDetectorJob (rule engine) → AnomalySignal[]
 *   ↓ persisted to anomaly_signals table
 * POST /api/ai/zhugeliang/proactive (P22.D.2) consumes fresh signals
 */

import type { FlywheelName } from '../adapters/types'

export type { FlywheelName }

export type AnomalySeverity = 'high' | 'medium' | 'low'

/** Output of the rule engine — one signal per triggered rule per client. */
export interface AnomalySignal {
  clientId: string
  flywheel: FlywheelName
  metricKey: string
  ruleId: string
  severity: AnomalySeverity
  currentValue: number
  referenceValue: number
  /** Signed percentage change: negative = drop */
  deltaPct: number
  description: string
}

/** A single detection rule. */
export interface AnomalyRule {
  /** Unique identifier, stored in anomaly_signals.rule_id */
  id: string
  flywheel: FlywheelName
  metricKey: string
  severity: AnomalySeverity
  /**
   * Evaluate whether this rule fires.
   * @param current  Most recent metric value
   * @param history  Ordered older values (oldest first), may be empty
   * @returns detection result or null if no anomaly
   */
  detect(
    current: number,
    history: number[]
  ): { deltaPct: number; description: string } | null
}

/** Row structure expected from flywheel_metrics for each metric query. */
export interface MetricDataPoint {
  metric_value: number
  measured_at: string
}
