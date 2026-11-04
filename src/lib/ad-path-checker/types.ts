export type CheckState = 'detected' | 'not_detected' | 'unknown' | 'needs_connection'

export interface Check {
  id: string
  title: string
  state: CheckState
  detail: string
  evidence: string[]
  sources: string[]
}

export interface Suggestion {
  title: string
  reason: string
  action: string
  checkIds: string[]
}

export interface ScanReport {
  version: 1
  scannedAt: string
  site: string
  sourceUrl: string
  mode: 'live' | 'example'
  headline: string
  summary: string
  path: { label: string; confirmed: boolean }[]
  checks: Check[]
  suggestions: Suggestion[]
  coverage: { pages: number; scripts: number; incomplete: boolean }
}

export const STATE_LABELS: Record<CheckState, string> = {
  detected: '已检测到',
  not_detected: '未检测到',
  unknown: '本次公开扫描无法确认',
  needs_connection: '需要授权连接后检查',
}
