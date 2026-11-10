'use client'

import React from 'react'
import type { AdsPlaybook } from '@/lib/ads-strategy/playbooks'
import type { AdsScorecard } from '@/lib/ads-strategy/portfolio/scorecard'
import type { ClientGrowthView } from '@/lib/ads-strategy/agents/growth-client-view'
import { summarizeResultsByType } from '@/lib/ads-strategy/portfolio/result-summary'
import { HeldCards } from '@/components/confirmation-card/HeldCards'
import { AdsHealthSummaryStats } from './ads-health-summary-stats'
import { AdsHealthConfirmCta } from './ads-health-confirm-cta'
import { AdsHealthCampaignTable, type CampaignTableRow } from './ads-health-campaign-table'
import { AdsHealthAccordions } from './ads-health-accordions'
import { TodayGoalProgress } from './today-goal-progress'
import HourlyLeadsPanel from './hourly-leads-panel'
import LiveTodayPanel from './live-today-panel'
import LivePacingPanel from './live-pacing-panel'
import WarMapPanel from './war-map-panel'
import ScorecardSection from './scorecard-section'
import QualifiedPanel from './qualified-panel'
import type { GrowthStateView } from './growth-panel'
import { goalLiveNote } from './growth-panel'

type Verdict = 'healthy' | 'watch' | 'alert' | 'insufficient_history' | 'paused'

interface CampaignNarrative {
  campaign_id: string
  campaign_name: string
  verdict: Verdict
  headline: string
  latest_spend_7d: number
  latest_results_7d: number
  frequency_7d: number | null
}

interface TodayTabProps {
  clientId: string
  loading: boolean
  error: string | null
  playbook: AdsPlaybook
  growth?: GrowthStateView | ClientGrowthView | null
  todayCrmLeads?: number | null
  campaigns: readonly CampaignNarrative[]
  liveCampaigns: readonly CampaignNarrative[]
  overallHeadline: string | null
  insightDate: string | null
  evaluated: number
  scorecard?: AdsScorecard | { error: string }
  refreshKey: number
  confirmCardCount: number
  onConfirmCardCount: (n: number) => void
  overallTint: string
  overallDot: string
  overallText: string
}

function weekTotals(campaigns: readonly CampaignNarrative[]) {
  const spend = campaigns.reduce((s, c) => s + c.latest_spend_7d, 0)
  const results = campaigns.reduce((s, c) => s + c.latest_results_7d, 0)
  const per = results > 0 ? spend / results : null
  return {
    spend: spend > 0 ? spend : null,
    results: campaigns.length > 0 ? results : null,
    per,
  }
}

export function AdsHealthTodayTab(props: TodayTabProps) {
  const {
    clientId, loading, error, playbook, growth, todayCrmLeads, campaigns, liveCampaigns,
    overallHeadline, insightDate, evaluated, scorecard, refreshKey, confirmCardCount,
    onConfirmCardCount, overallTint, overallDot, overallText,
  } = props

  const week = weekTotals(campaigns)
  const typed = scorecard && !('error' in scorecard) ? summarizeResultsByType(scorecard.units) : null
  const tableRows: CampaignTableRow[] = liveCampaigns.map(c => ({
    ...c,
    hasConfirmCard: confirmCardCount > 0,
  }))

  return (
    <>
      {!loading && !error && (
        <AdsHealthSummaryStats
          clientId={clientId}
          campaigns={liveCampaigns}
          spend7d={week.spend}
          results7d={typed?.rows[0]?.results ?? week.results}
          perResult7d={typed?.rows[0]?.costPerResult ?? week.per}
          resultNoun={playbook.resultNoun}
          todayCrmLeads={todayCrmLeads}
          growth={growth}
          confirmCardCount={confirmCardCount}
          scorecard={scorecard}
        />
      )}

      <AdsHealthConfirmCta count={confirmCardCount} />

      <section
        id="confirmation-cards"
        className="mb-6 rounded-xl border border-dashed border-me-ochre/40 bg-me-ochre/5 p-4 md:p-5"
        aria-label="等你点头的确认卡"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-me-charcoal">
            等你想点 · {confirmCardCount > 0 ? `${confirmCardCount} 张` : ''}确认卡
          </h2>
          <a
            href={`/dashboard/clients/${clientId}/confirmation-cards`}
            className="text-sm text-me-ochre hover:text-me-charcoal"
          >
            去确认卡页面看全部 →
          </a>
        </div>
        <p className="mt-1 text-xs text-me-charcoal/55">在你点确认之前，预算和投放都不会改。</p>
        <HeldCards
          clientId={clientId}
          refreshKey={refreshKey}
          layout="ads-health"
          hideWhenEmpty
          onCountChange={onConfirmCardCount}
        />
      </section>

      {!loading && !error && liveCampaigns.length > 0 && (
        <AdsHealthCampaignTable
          clientId={clientId}
          rows={tableRows}
          costPerResultLabel={playbook.costPerResultLabel}
        />
      )}

      {loading && <div className="py-8 text-center text-sm text-me-charcoal/45">加载中…</div>}
      {error && (
        <div className="mb-4 rounded-xl border border-status-rej/30 bg-status-rej/10 p-4 text-sm text-status-rej">
          加载出错:{error}
        </div>
      )}
      {!loading && !error && !overallHeadline && (
        <div className="mb-4 rounded-xl border border-me-stone bg-me-ivory p-8 text-center text-sm text-me-charcoal/55">
          <p>广告数据还在积累中，暂时没有健康报告。</p>
          <p className="mt-2 text-xs text-me-charcoal/45">系统每天凌晨自动体检，数据够了这里就会出现。</p>
        </div>
      )}

      {!loading && !error && overallHeadline && (
        <AdsHealthAccordions
          sections={[
            {
              title: '今天按小时看进线',
              body: <HourlyLeadsPanel clientId={clientId} />,
            },
            {
              title: '跟自己以前比',
              defaultOpen: true,
              body: (
                <>
                  <p className="mb-3 text-xs text-me-charcoal/55">
                    每个系列和它自己最好的一周比，不看目标成本（跟作战地图是两把尺子）
                  </p>
                  <div className={`rounded-xl border p-4 ${overallTint}`}>
                    <div className="flex items-center gap-2.5">
                      <span className={`inline-block h-3 w-3 rounded-full ${overallDot}`} />
                      <span className={`text-base font-semibold ${overallText}`}>{overallHeadline}</span>
                    </div>
                    {insightDate ? (
                      <p className="mt-1.5 text-xs text-me-charcoal/45">
                        体检日期 {insightDate} · 共 {evaluated} 条广告
                      </p>
                    ) : null}
                  </div>
                </>
              ),
            },
            {
              title: '广告成绩单（内部看）',
              defaultOpen: true,
              body: growth && !('viewer' in growth) ? (
                <>
                  <ScorecardSection scorecard={growth.payload?.scorecard} clientId={clientId} />
                  {growth.payload?.scorecard && !('error' in growth.payload.scorecard) && (
                    <QualifiedPanel block={growth.payload.scorecard.qualified} />
                  )}
                </>
              ) : (
                <p className="text-sm text-me-charcoal/55">内部员工才看得到成绩单。</p>
              ),
            },
            {
              title: '为什么这样判断',
              body: (
                <>
                  <TodayGoalProgress
                    state={growth}
                    clientId={clientId}
                    todayCrmLeads={todayCrmLeads}
                    liveNote={
                      growth && 'goal_live' in growth ? goalLiveNote(growth.goal_live) : undefined
                    }
                  />
                  <WarMapPanel clientId={clientId} />
                </>
              ),
            },
            {
              title: '自动化和每天上限',
              body: (
                <>
                  <LiveTodayPanel clientId={clientId} part="today" />
                  <LivePacingPanel clientId={clientId} />
                </>
              ),
            },
          ]}
        />
      )}
    </>
  )
}
