'use client'

import React from 'react'
import { MePill, MeStatCard } from '@/components/ui/me-primitives'
import { CORE_METRIC_NOUN } from '@/lib/ads-strategy/rules/core-metric'
import { summarizeResultsByType, type ResultSummary } from '@/lib/ads-strategy/portfolio/result-summary'
import type { AdsScorecard } from '@/lib/ads-strategy/portfolio/scorecard'
import type { ClientGrowthView } from '@/lib/ads-strategy/agents/growth-client-view'
import type { GrowthStateView } from './growth-panel'
import { useTodaySpend } from './use-today-spend'

type Verdict = 'healthy' | 'watch' | 'alert' | 'insufficient_history' | 'paused'

interface CampaignRow {
  verdict: Verdict
}

function pickGoalPace(state: GrowthStateView | ClientGrowthView | null | undefined) {
  if (!state) return null
  return state.goal_pace ?? null
}

function statusCopy(rows: readonly CampaignRow[]): { pill: 'rej' | 'exec' | 'track' | 'attn'; label: string; line: string } {
  const live = rows.filter(c => c.verdict !== 'paused')
  const alert = live.filter(c => c.verdict === 'alert').length
  const watch = live.filter(c => c.verdict === 'watch').length
  const healthy = live.filter(c => c.verdict === 'healthy').length
  if (live.length === 0) {
    return { pill: 'attn', label: '暂无在投', line: '现在没有在投的广告系列。' }
  }
  if (alert > 0) {
    return {
      pill: 'rej',
      label: '要处理',
      line: `${live.length} 条在投：${alert} 条要处理${watch > 0 ? `，${watch} 条留意` : ''}${healthy > 0 ? `，${healthy} 条正常` : ''}。`,
    }
  }
  if (watch > 0) {
    return { pill: 'exec', label: '留意', line: `${live.length} 条在投：${watch} 条留意，其余正常。` }
  }
  return { pill: 'track', label: '正常', line: `${live.length} 条在投，目前都在正常范围。` }
}

function fmtMoney(n: number | null, cur: string | null): string {
  if (n === null) return '—'
  return `$${n.toFixed(0)}${cur && cur !== 'USD' ? ` ${cur}` : ''}`
}

export function AdsHealthSummaryStats({
  clientId,
  campaigns,
  spend7d,
  results7d,
  perResult7d,
  resultNoun,
  todayCrmLeads,
  growth,
  confirmCardCount,
  scorecard,
}: {
  clientId: string
  campaigns: readonly CampaignRow[]
  spend7d: number | null
  results7d: number | null
  perResult7d: number | null
  resultNoun: string
  todayCrmLeads?: number | null
  growth?: GrowthStateView | ClientGrowthView | null
  confirmCardCount: number | null
  scorecard?: AdsScorecard | { error: string }
}) {
  const today = useTodaySpend(clientId)
  const status = statusCopy(campaigns)
  const pace = pickGoalPace(growth ?? null)
  const typed: ResultSummary | null =
    scorecard && !('error' in scorecard) ? summarizeResultsByType(scorecard.units) : null
  const goalTarget = growth && 'payload' in growth ? growth.payload?.goal?.target : growth && 'goal' in growth ? growth.goal?.target : null

  const spendFooter = today.capMajor != null && today.spendToday != null ? (
    <p className="text-me-charcoal/55">
      日上限 ${today.capMajor.toFixed(0)}，还剩 ${Math.max(0, today.capMajor - today.spendToday).toFixed(0)}
    </p>
  ) : today.spendToday != null ? (
    <p className="text-me-charcoal/55">日上限读不到</p>
  ) : null

  const leadsFooter = (() => {
    const n = todayCrmLeads
    if (n === null || n === undefined) return <p className="text-me-charcoal/55">今天进线读不到</p>
    if (goalTarget != null && pace?.verdict === 'behind') {
      return <p className="text-me-ochre">今天目标 {goalTarget} 个，按时间算有点慢</p>
    }
    if (goalTarget != null) return <p className="text-me-charcoal/55">今天目标 {goalTarget} 个</p>
    return null
  })()

  const sevenFooter = (() => {
    if (typed && typed.rows.length > 0) {
      return (
        <div className="space-y-0.5 text-me-charcoal/55">
          {typed.rows.map(row => (
            <p key={row.type}>
              {row.results} 个{CORE_METRIC_NOUN[row.type]}
              {row.costPerResult !== null ? `，平均 $${row.costPerResult.toFixed(1)} 一个` : ''}
            </p>
          ))}
        </div>
      )
    }
    if (results7d != null && results7d > 0 && perResult7d != null) {
      return <p className="text-me-charcoal/55">{results7d} 个{resultNoun}，平均 ${perResult7d.toFixed(1)} 一个</p>
    }
    if (results7d === 0) {
      return <p className="text-me-charcoal/55">一个{resultNoun}都没来</p>
    }
    if (results7d != null) return <p className="text-me-charcoal/55">{results7d} 个{resultNoun}</p>
    return null
  })()

  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-card">
        <p className="text-xs font-medium text-me-charcoal/55">现在怎么样</p>
        <div className="mt-2">
          <MePill tone={status.pill}>{status.label}</MePill>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-me-charcoal">{status.line}</p>
        {confirmCardCount != null && confirmCardCount > 0 && (
          <p className="mt-2 text-xs text-me-ochre">有 {confirmCardCount} 张确认卡等你点</p>
        )}
      </div>
      <MeStatCard
        value={fmtMoney(today.spendToday, today.currency)}
        label="今天花了"
        tone="ochre"
        goldValue
        footer={spendFooter}
      />
      <MeStatCard
        value={todayCrmLeads === null || todayCrmLeads === undefined ? '—' : `${todayCrmLeads}`}
        label={`今天来了（${resultNoun}）`}
        tone="track"
        footer={leadsFooter}
      />
      <MeStatCard
        value={spend7d === null ? '—' : fmtMoney(spend7d, null)}
        label="过去 7 天"
        tone="stone"
        footer={sevenFooter}
      />
    </div>
  )
}
