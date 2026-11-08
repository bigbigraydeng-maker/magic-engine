/**
 * C-i 漏斗分段体检 · 纯呈现适配（从 EntityTree 的 winnerBaseline 出文案，无 I/O）。
 */

import { ACCOUNT_WINNER_MIN_LEADS, type FunnelRates } from './funnel-baseline'

export interface FunnelCiSummaryLine {
  readonly segment: string
  readonly state: 'comparable' | 'unknown'
  readonly detail: string
}

export function summarizeFunnelCiCheck(winner: FunnelRates | null): {
  readonly winnerHold: boolean
  readonly minLeads: number
  readonly lines: readonly FunnelCiSummaryLine[]
} {
  const winnerHold = winner !== null
  const lines: FunnelCiSummaryLine[] = [
    {
      segment: '钩子（3 秒播放率）',
      state: winnerHold && winner.hook !== null ? 'comparable' : 'unknown',
      detail: winnerHold ? '有爆款基线，可与各广告对照' : `UNKNOWN（样本门槛 ≥${ACCOUNT_WINNER_MIN_LEADS} 条留资）`,
    },
    {
      segment: '点击率',
      state: winnerHold && winner.linkCtr !== null ? 'comparable' : 'unknown',
      detail: winnerHold ? '有爆款基线' : '缺可比 winner',
    },
    {
      segment: '点击→留资',
      state: winnerHold && winner.completion !== null ? 'comparable' : 'unknown',
      detail: winnerHold ? '有爆款基线' : '缺可比 winner',
    },
    {
      segment: '千次展示成本',
      state: winnerHold && winner.cpm !== null ? 'comparable' : 'unknown',
      detail: winnerHold ? '有爆款基线' : '缺可比 winner',
    },
  ]
  return { winnerHold, minLeads: ACCOUNT_WINNER_MIN_LEADS, lines }
}
