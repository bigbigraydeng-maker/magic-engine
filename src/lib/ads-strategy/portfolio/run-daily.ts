/**
 * 每日只读诊断入口（被 google-data-pullback-daily 调用）：加载 → 诊断 → 并进当天体检记录 → 内部版日报。
 * 尽力而为，不抛：诊断失败不能影响数据同步和体检。
 */

import { loadDiagnosisInput } from './diagnostics/loader'
import { runDiagnostics } from './diagnostics/run'
import { persistAndSendInternalDigest } from './internal-digest'

export interface DailyDiagnosticsResult {
  success: boolean
  hits: number
  not_comparable: number
  excluded: number
  digest_decision?: string
  digest_sent?: boolean
  recipients_dropped?: number
  error?: string
}

export async function runPortfolioDiagnostics(
  clientId: string,
  clientName: string,
  insightDate: string,
  configuredRecipients: string[],
): Promise<DailyDiagnosticsResult> {
  try {
    const evaluatedAt = new Date().toISOString()
    const input = await loadDiagnosisInput(clientId, insightDate, evaluatedAt)
    const run = runDiagnostics({ ...input, digestRecipients: configuredRecipients })
    const digest = await persistAndSendInternalDigest({ clientId, clientName, date: insightDate, run, configuredRecipients })
    return {
      success: !digest.error,
      hits: run.diagnoses.filter(d => d.status === 'hit').length,
      not_comparable: run.diagnoses.filter(d => d.status === 'not_comparable').length,
      excluded: run.excluded.length,
      digest_decision: digest.decision,
      digest_sent: digest.sent,
      recipients_dropped: digest.recipients_dropped,
      error: digest.error,
    }
  } catch (err) {
    return { success: false, hits: 0, not_comparable: 0, excluded: 0, error: err instanceof Error ? err.message : String(err) }
  }
}
