/**
 * AnomalyDetector types — P22.D.1
 *
 * AnomalySignal is the output unit of AnomalyDetectorJob.
 * Each fired rule produces one AnomalySignal which is persisted to
 * the anomaly_signals table and consumed by the Zhugeliang proactive
 * advisory layer (P22.D.2).
 */

export type AnomalySeverity = 'high' | 'medium' | 'low'
export type AnomalyStatus   = 'new' | 'acknowledged' | 'resolved'

/** Matches the anomaly_signals table schema (P22.D.1 migration). */
export interface AnomalySignal {
  id?:             string          // UUID, set by DB on insert
  clientId:        string
  flywheel:        'seo' | 'geo' | 'ads' | 'social' | 'competitor'
  metricKey:       string          // e.g. 'seo.gsc.avg_position'
  ruleId:          string          // e.g. 'seo.avg_position.drop_5_3days'
  severity:        AnomalySeverity
  currentValue:    number | null
  baselineValue:   number | null
  pctChange:       number | null   // positive = increase, negative = decrease
  sourceRef:       Record<string, unknown>
  status:          AnomalyStatus
  detectedAt:      string          // ISO-8601
}

/**
 * Definition of one detection rule.
 * AnomalyDetectorJob iterates over RULES and calls each rule's detect()
 * for every client.
 */
export interface DetectionRule {
  ruleId:    string
  flywheel:  AnomalySignal['flywheel']
  metricKey: string
  severity:  AnomalySeverity
  detect(clientId: string): Promise<AnomalySignal | null>
}
