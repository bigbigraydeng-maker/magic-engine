/**
 * IMPACT 批次 B · 类型 + 纯呈现（无 I/O）。
 */

import { esc } from '@/lib/pm-todo/daily-todo'
import { ACCOUNT_WINNER_MIN_LEADS } from '@/lib/ads-strategy/entity-tree/funnel-baseline'

export type ImpactGapStatus = 'ok' | 'gap' | 'unknown'

export interface M2SpendAccountSlice {
  readonly adAccountId: string
  readonly spend7d: number | null
  readonly currency: string | null
}

export interface M2SpendVsCapSlice {
  readonly status: ImpactGapStatus
  readonly windowLabel: string
  readonly accounts: readonly M2SpendAccountSlice[]
  readonly spend7dTotal: number | null
  readonly currency: string | null
  readonly mixedCurrency: boolean
  readonly clientDailyCapCents: number | null
  readonly capSource: 'me_settings' | 'missing' | 'unreadable'
  readonly gaps: readonly string[]
  readonly settingsHref: string
}

export interface I1BriefFieldGap {
  readonly key: string
  readonly label: string
}

export interface I1BusinessProfileSlice {
  readonly status: ImpactGapStatus
  readonly hasActiveBrief: boolean
  readonly missingFields: readonly I1BriefFieldGap[]
  readonly gaps: readonly string[]
  readonly settingsHref: string
}

export interface C3EvidenceLine {
  readonly kind: 'fatigue' | 'audience' | 'action'
  readonly summary: string
}

export interface C3WeeklyCheckSlice {
  readonly status: ImpactGapStatus
  readonly lines: readonly C3EvidenceLine[]
  readonly gaps: readonly string[]
  readonly adsHealthHref: string
}

export interface CiFunnelSegment {
  readonly name: string
  readonly state: 'comparable' | 'unknown'
  readonly note: string
}

export interface CiFunnelCheckSlice {
  readonly status: ImpactGapStatus
  readonly winnerHold: boolean
  readonly minLeads: number
  readonly segments: readonly CiFunnelSegment[]
  readonly gaps: readonly string[]
  readonly entityTreeHref: string
}

export interface ClientImpactGapBundle {
  readonly clientId: string
  readonly m2: M2SpendVsCapSlice
  readonly i1: I1BusinessProfileSlice
  readonly c3: C3WeeklyCheckSlice
  readonly ci: CiFunnelCheckSlice
}

function capMajor(cents: number | null): string {
  if (cents === null) return '—'
  return (cents / 100).toFixed(0)
}

export function presentM2Lines(slice: M2SpendVsCapSlice): string[] {
  const lines: string[] = []
  lines.push(`时间窗：${slice.windowLabel} · 花费口径：各账户 campaign 级日数据合计（7 天）`)
  if (slice.mixedCurrency) {
    lines.push('多个账户币种不一致，未做跨币种合计')
  } else if (slice.spend7dTotal !== null && slice.currency) {
    lines.push(`近 7 天实花：${slice.currency} ${slice.spend7dTotal.toFixed(2)}`)
  } else if (slice.spend7dTotal !== null) {
    lines.push(`近 7 天实花：${slice.spend7dTotal.toFixed(2)}（币种未读到）`)
  } else {
    lines.push('近 7 天实花：没读到')
  }
  for (const acc of slice.accounts) {
    const spend =
      acc.spend7d === null ? '—' : `${acc.currency ?? '?'} ${acc.spend7d.toFixed(2)}`
    lines.push(`账户 …${acc.adAccountId.slice(-4)}：${spend}`)
  }
  if (slice.capSource === 'missing') {
    lines.push('客户日总上限：未在 ME 设置里填写（须 Ray 在广告健康「设置」补，本切片不代填）')
  } else if (slice.capSource === 'unreadable') {
    lines.push('客户日总上限：没读到')
  } else if (slice.clientDailyCapCents !== null) {
    lines.push(
      `客户日总上限（ME 设置）：${slice.currency ?? ''} ${capMajor(slice.clientDailyCapCents)}/天 · 注意：上限按「日」配置，不与 7 天实花直接比`,
    )
  }
  for (const g of slice.gaps) lines.push(`缺口：${g}`)
  lines.push(`去补：${slice.settingsHref}`)
  return lines
}

export function presentI1Lines(slice: I1BusinessProfileSlice): string[] {
  const lines: string[] = []
  if (!slice.hasActiveBrief) {
    lines.push('生意档案：没有生效中的 Master Brief')
  } else if (slice.missingFields.length === 0) {
    lines.push('生意档案：主要字段已填')
  } else {
    lines.push(
      `生意档案缺项：${slice.missingFields.map(f => f.label).join('、')}`,
    )
  }
  for (const g of slice.gaps) lines.push(`缺口：${g}`)
  lines.push(`去补：${slice.settingsHref}`)
  return lines
}

export function presentC3Lines(slice: C3WeeklyCheckSlice): string[] {
  const lines: string[] = []
  if (slice.lines.length === 0) {
    lines.push('本周没有可引用的疲劳 / 受众 / 动作结论')
  } else {
    for (const row of slice.lines) {
      const tag = row.kind === 'fatigue' ? '疲劳' : row.kind === 'audience' ? '受众' : '动作'
      lines.push(`${tag}：${row.summary}`)
    }
  }
  for (const g of slice.gaps) lines.push(`缺口：${g}`)
  lines.push(`去看：${slice.adsHealthHref}`)
  return lines
}

export function presentCiLines(slice: CiFunnelCheckSlice): string[] {
  const lines: string[] = []
  if (!slice.winnerHold) {
    lines.push(
      `漏斗爆款基线：UNKNOWN（账户内尚无 ≥${slice.minLeads} 条留资的赢家广告，不能做对爆款分段体检）`,
    )
  } else {
    lines.push(`漏斗爆款基线：已有（样本门槛 ≥${slice.minLeads} 条留资）`)
  }
  for (const seg of slice.segments) {
    lines.push(`${seg.name}：${seg.state === 'comparable' ? '可对照' : 'UNKNOWN'} · ${seg.note}`)
  }
  for (const g of slice.gaps) lines.push(`缺口：${g}`)
  lines.push(`去看：${slice.entityTreeHref}`)
  return lines
}

export function presentImpactGapBlock(bundle: ClientImpactGapBundle): string {
  const sections = [
    { emoji: '💰', title: 'M-2 花费与上限（只读）', lines: presentM2Lines(bundle.m2) },
    { emoji: '📋', title: 'I-1 生意档案', lines: presentI1Lines(bundle.i1) },
    { emoji: '📊', title: 'C-3 周检结论引用', lines: presentC3Lines(bundle.c3) },
    { emoji: '🪜', title: 'C-i 漏斗分段体检', lines: presentCiLines(bundle.ci) },
  ]
  const body = sections
    .map((s) => {
      const inner = s.lines.map((t) => `<p style="margin:0 0 4px;font-size:13px;color:#334155">${esc(t)}</p>`).join('')
      return `<div style="margin:0 0 8px"><p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#0f172a">${s.emoji} ${esc(s.title)}</p>${inner}</div>`
    })
    .join('')
  return `<div style="margin:0 0 10px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0f172a">IMPACT 只读事实 / 缺口</p>
    ${body}
  </div>`
}

/** 广告下一步卡：每项一段，≤5 行。 */
export function presentImpactGapNextStepSummary(bundle: ClientImpactGapBundle): {
  readonly m2: string
  readonly i1: string
  readonly c3: string
  readonly ci: string
} {
  const join = (lines: string[]) => lines.slice(0, 5).join('\n')
  return {
    m2: join(presentM2Lines(bundle.m2)),
    i1: join(presentI1Lines(bundle.i1)),
    c3: join(presentC3Lines(bundle.c3)),
    ci: join(presentCiLines(bundle.ci)),
  }
}
