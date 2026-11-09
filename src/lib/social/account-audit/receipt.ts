/** Compact receipt for one audited client (what goes into cron_run_logs.summary). Pure. */
import type { AuditResult, Finding, MetricResult } from './audit'

export interface ClientAuditReceipt {
  client_id: string
  as_of: string
  reel_count: number
  metrics: Array<Pick<MetricResult, 'key' | 'label' | 'status' | 'value'>>
  findings: Finding[]
  over: number
  not_measured: number
  error: string | null
}

export function clientReceipt(clientId: string, result: AuditResult): ClientAuditReceipt {
  return {
    client_id: clientId,
    as_of: result.asOf,
    reel_count: result.reelCount,
    metrics: result.metrics.map((m) => ({ key: m.key, label: m.label, status: m.status, value: m.value })),
    findings: result.findings,
    over: result.metrics.filter((m) => m.status === 'over').length,
    not_measured: result.metrics.filter((m) => m.status === 'not_measured').length,
    error: null,
  }
}

export function failedReceipt(clientId: string, asOf: string, message: string): ClientAuditReceipt {
  return { client_id: clientId, as_of: asOf, reel_count: 0, metrics: [], findings: [], over: 0, not_measured: 0, error: message.slice(0, 200) }
}
