'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import type { AdsPlaybook } from '@/lib/ads-strategy/playbooks'
import type { AdsScorecard } from '@/lib/ads-strategy/portfolio/scorecard'
import type { ClientGrowthView } from '@/lib/ads-strategy/agents/growth-client-view'
import { CORE_METRIC_NOUN } from '@/lib/ads-strategy/rules/core-metric'
import { summarizeResultsByType, type ResultSummary } from '@/lib/ads-strategy/portfolio/result-summary'
import type { LiveTodayView } from '@/lib/ads-strategy/heartbeat/live-view'
import { HeldCards } from '@/components/confirmation-card/HeldCards'
import { AdsExecutionReviewPanel } from '../_components/AdsExecutionReviewPanel'
import { MeButton, MePill, MeStatCard, MeTable } from '@/components/ui/me-primitives'
import AdsNextStepCard from './ads-next-step-card'
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

const ROW_META: Record<Verdict, { label: string; tone: 'rej' | 'exec' | 'track' | 'attn' }> = {
  alert: { label: '该动手', tone: 'rej' },
  watch: { label: '留意', tone: 'exec' },
  healthy: { label: '健康', tone: 'track' },
  insufficient_history: { label: '数据积累中', tone: 'attn' },
  paused: { label: '已停投', tone: 'attn' },
}

function weekTotals(campaigns: readonly CampaignNarrative[]) {
  const spend = campaigns.reduce((s, c) => s + c.latest_spend_7d, 0)
  const results = campaigns.reduce((s, c) => s + c.latest_results_7d, 0)
  const per = results > 0 ? spend / results : null
  return { spend: spend > 0 ? spend : null, results: campaigns.length > 0 ? results : null, per }
}

function sumSpendToday(view: LiveTodayView) {
  let sum = 0
  let any = false
  const currencies = new Set<string>()
  for (const acc of view.accounts) {
    if (acc.readState === 'unreadable') continue
    for (const a of acc.active) {
      if (a.spendToday === null) continue
      sum += a.spendToday
      any = true
      if (acc.currency) currencies.add(acc.currency)
    }
  }
  if (!any) return { spend: null as number | null, currency: currencies.size === 1 ? [...currencies][0] : null }
  return { spend: sum, currency: currencies.size === 1 ? [...currencies][0] : null }
}

function useTodaySpend(clientId: string) {
  const [spendToday, setSpendToday] = useState<number | null>(null)
  const [capMajor, setCapMajor] = useState<number | null>(null)
  const [currency, setCurrency] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(`/api/clients/${clientId}/ad-health/live`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
      fetch(`/api/clients/${clientId}/ad-accounts`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
    ]).then(([liveJson, acctJson]) => {
      if (!alive) return
      const view = (liveJson as { view?: LiveTodayView } | null)?.view ?? null
      const capCents = (acctJson as { client_total_cap_cents?: unknown } | null)?.client_total_cap_cents
      setCapMajor(typeof capCents === 'number' ? capCents / 100 : null)
      if (!view) { setSpendToday(null); setCurrency(null); return }
      const { spend, currency: cur } = sumSpendToday(view)
      setSpendToday(spend)
      setCurrency(cur)
    }).catch(() => { if (alive) { setSpendToday(null); setCapMajor(null); setCurrency(null) } })
    return () => { alive = false }
  }, [clientId])
  return { spendToday, capMajor, currency }
}

function useConfirmCardCount(clientId: string, refreshKey: number) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    void fetch(`/api/clients/${encodeURIComponent(clientId)}/confirmation-cards`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (!alive) return
        const cards = body && typeof body === 'object' && Array.isArray((body as { cards?: unknown }).cards)
          ? (body as { cards: unknown[] }).cards.length : 0
        setCount(cards)
      })
      .catch(() => { if (alive) setCount(0) })
    return () => { alive = false }
  }, [clientId, refreshKey])
  return count
}

function statusCopy(rows: readonly { verdict: Verdict }[]) {
  const live = rows.filter(c => c.verdict !== 'paused')
  const alert = live.filter(c => c.verdict === 'alert').length
  const watch = live.filter(c => c.verdict === 'watch').length
  const healthy = live.filter(c => c.verdict === 'healthy').length
  if (!live.length) return { pill: 'attn' as const, label: '暂无在投', line: '现在没有在投的广告系列。' }
  if (alert > 0) {
    return {
      pill: 'rej' as const,
      label: '要处理',
      line: `${live.length} 条在投：${alert} 条要处理${watch ? `，${watch} 条留意` : ''}${healthy ? `，${healthy} 条正常` : ''}。`,
    }
  }
  if (watch) return { pill: 'exec' as const, label: '留意', line: `${live.length} 条在投：${watch} 条留意，其余正常。` }
  return { pill: 'track' as const, label: '正常', line: `${live.length} 条在投，目前都在正常范围。` }
}

function fmtMoney(n: number | null, cur: string | null) {
  if (n === null) return '—'
  return `$${n.toFixed(0)}${cur && cur !== 'USD' ? ` ${cur}` : ''}`
}

function Accordion({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <details className="group rounded-xl border border-me-stone bg-white shadow-card open:pb-4" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer list-none px-5 py-4 font-medium text-me-charcoal marker:content-none">
        <span className="flex items-center justify-between gap-3">{title}<span className="text-me-charcoal/35 group-open:rotate-180 transition-transform" aria-hidden>⌄</span></span>
      </summary>
      <div className="border-t border-me-stone/80 px-5 pt-4">{children}</div>
    </details>
  )
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
  overallTint: string
  overallDot: string
  overallText: string
}

export function AdsHealthTodayTab(props: TodayTabProps) {
  const {
    clientId, loading, error, playbook, growth, todayCrmLeads, campaigns, liveCampaigns,
    overallHeadline, insightDate, evaluated, scorecard, refreshKey, overallTint, overallDot, overallText,
  } = props
  const week = weekTotals(campaigns)
  const today = useTodaySpend(clientId)
  const confirmCardCount = useConfirmCardCount(clientId, refreshKey)
  const status = statusCopy(liveCampaigns)
  const pace = growth?.goal_pace ?? null
  const typed: ResultSummary | null = scorecard && !('error' in scorecard) ? summarizeResultsByType(scorecard.units) : null
  const goalTarget = growth && 'payload' in growth ? growth.payload?.goal?.target : growth && 'goal' in growth ? growth.goal?.target : null
  const results7d = typed?.rows[0]?.results ?? week.results
  const perResult7d = typed?.rows[0]?.costPerResult ?? week.per

  const sevenFooter = typed?.rows.length ? (
    <div className="space-y-0.5 text-me-charcoal/55">
      {typed.rows.map(row => (
        <p key={row.type}>{row.results} 个{CORE_METRIC_NOUN[row.type]}{row.costPerResult !== null ? `，平均 $${row.costPerResult.toFixed(1)} 一个` : ''}</p>
      ))}
    </div>
  ) : results7d === 0 ? (
    <p className="text-me-charcoal/55">一个{playbook.resultNoun}都没来</p>
  ) : results7d != null && perResult7d != null && results7d > 0 ? (
    <p className="text-me-charcoal/55">{results7d} 个{playbook.resultNoun}，平均 ${perResult7d.toFixed(1)} 一个</p>
  ) : results7d != null ? (
    <p className="text-me-charcoal/55">{results7d} 个{playbook.resultNoun}</p>
  ) : null

  return (
    <>
      {!loading && !error && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[24px] border border-black/10 bg-white p-5 shadow-card">
            <p className="text-xs font-medium text-me-charcoal/55">现在怎么样</p>
            <div className="mt-2"><MePill tone={status.pill}>{status.label}</MePill></div>
            <p className="mt-3 text-sm leading-relaxed text-me-charcoal">{status.line}</p>
            {confirmCardCount > 0 && <p className="mt-2 text-xs text-me-ochre">有 {confirmCardCount} 张确认卡等你点</p>}
          </div>
          <MeStatCard value={fmtMoney(today.spendToday, today.currency)} label="今天花了" tone="ochre" goldValue footer={
            today.capMajor != null && today.spendToday != null ? (
              <p className="text-me-charcoal/55">日上限 ${today.capMajor.toFixed(0)}，还剩 ${Math.max(0, today.capMajor - today.spendToday).toFixed(0)}</p>
            ) : today.spendToday != null ? <p className="text-me-charcoal/55">日上限读不到</p> : null
          } />
          <MeStatCard
            value={todayCrmLeads == null ? '—' : `${todayCrmLeads}`}
            label={`今天来了（${playbook.resultNoun}）`}
            tone="track"
            footer={
              todayCrmLeads == null ? <p className="text-me-charcoal/55">今天进线读不到</p>
                : goalTarget != null && pace?.verdict === 'behind' ? <p className="text-me-ochre">今天目标 {goalTarget} 个，按时间算有点慢</p>
                : goalTarget != null ? <p className="text-me-charcoal/55">今天目标 {goalTarget} 个</p> : null
            }
          />
          <MeStatCard value={week.spend === null ? '—' : fmtMoney(week.spend, null)} label="过去 7 天" tone="stone" footer={sevenFooter} />
        </div>
      )}

      {confirmCardCount > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-me-gold/50 bg-me-gold/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-me-charcoal">现在请您：看 {confirmCardCount} 张确认卡</p>
          <MeButton type="button" variant="primary" size="sm" className="shrink-0" onClick={() => document.getElementById('confirmation-cards')?.scrollIntoView({ behavior: 'smooth' })}>
            去看确认卡 ↓
          </MeButton>
        </div>
      )}

      <section id="confirmation-cards" className="mb-6 rounded-xl border border-dashed border-me-ochre/40 bg-me-ochre/5 p-4 md:p-5" aria-label="等你点头的确认卡">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-me-charcoal">等你想点 · {confirmCardCount > 0 ? `${confirmCardCount} 张` : ''}确认卡</h2>
          <Link href={`/dashboard/clients/${clientId}/confirmation-cards`} className="text-sm text-me-ochre hover:text-me-charcoal">去确认卡页面看全部 →</Link>
        </div>
        <p className="mt-1 text-xs text-me-charcoal/55">在你点确认之前，预算和投放都不会改。</p>
        <HeldCards clientId={clientId} refreshKey={refreshKey} hideWhenEmpty />
      </section>

      <section className="mb-6">
        <AdsExecutionReviewPanel clientId={clientId} />
      </section>

      <AdsNextStepCard clientId={clientId} refreshKey={refreshKey} />

      {!loading && !error && liveCampaigns.length > 0 && (
        <section className="mb-6 rounded-[24px] border border-black/10 bg-white p-5 shadow-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-me-charcoal">每条广告 · 最紧要的排最前</h2>
            <Link href={`/dashboard/clients/${clientId}/ads-health?tab=ads`} className="text-sm font-medium text-me-ochre hover:text-me-charcoal">看每条的细节 →</Link>
          </div>
          <div className="overflow-x-auto">
            <MeTable>
              <thead>
                <tr className="border-b border-me-stone text-left text-xs text-me-charcoal/55">
                  <th className="py-2 pr-3 font-medium">广告</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 pr-3 font-medium text-right">近 7 天花费</th>
                  <th className="py-2 pr-3 font-medium text-right">留资</th>
                  <th className="py-2 pr-3 font-medium text-right">每个留资</th>
                  <th className="py-2 pr-3 font-medium text-right">看腻程度</th>
                  <th className="py-2 font-medium">一句话</th>
                </tr>
              </thead>
              <tbody>
                {liveCampaigns.map(row => {
                  const meta = ROW_META[row.verdict]
                  const cpl = row.latest_results_7d > 0 ? row.latest_spend_7d / row.latest_results_7d : null
                  const line = row.headline.trim() || (cpl != null ? `${playbook.costPerResultLabel} $${cpl.toFixed(1)}` : '—')
                  return (
                    <tr key={row.campaign_id} className="border-b border-me-stone/60 text-sm text-me-charcoal">
                      <td className="py-2.5 pr-3 align-top">
                        <p className="font-medium">{row.campaign_name}</p>
                        {confirmCardCount > 0 && <p className="mt-0.5 text-xs text-me-ochre">↑ 上面有确认卡</p>}
                      </td>
                      <td className="py-2.5 pr-3 align-top"><MePill tone={meta.tone}>{meta.label}</MePill></td>
                      <td className="py-2.5 pr-3 text-right tabular-nums align-top">${row.latest_spend_7d.toFixed(0)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums align-top">{row.latest_results_7d}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums align-top">{cpl === null ? '—' : `$${cpl.toFixed(1)}`}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums align-top">{row.frequency_7d == null ? '—' : row.frequency_7d.toFixed(2)}</td>
                      <td className="py-2.5 align-top text-sm text-me-charcoal/75">{line}</td>
                    </tr>
                  )
                })}
              </tbody>
            </MeTable>
          </div>
        </section>
      )}

      {loading && <div className="py-8 text-center text-sm text-me-charcoal/45">加载中…</div>}
      {error && <div className="mb-4 rounded-xl border border-status-rej/30 bg-status-rej/10 p-4 text-sm text-status-rej">加载出错:{error}</div>}
      {!loading && !error && !overallHeadline && (
        <div className="mb-4 rounded-xl border border-me-stone bg-me-ivory p-8 text-center text-sm text-me-charcoal/55">
          <p>广告数据还在积累中，暂时没有健康报告。</p>
          <p className="mt-2 text-xs text-me-charcoal/45">系统每天凌晨自动体检，数据够了这里就会出现。</p>
        </div>
      )}

      {!loading && !error && overallHeadline && (
        <div className="space-y-3">
          <Accordion title="今天按小时看进线"><HourlyLeadsPanel clientId={clientId} /></Accordion>
          <Accordion title="跟自己以前比" defaultOpen>
            <p className="mb-3 text-xs text-me-charcoal/55">每个系列和它自己最好的一周比，不看目标成本（跟作战地图是两把尺子）</p>
            <div className={`rounded-xl border p-4 ${overallTint}`}>
              <div className="flex items-center gap-2.5">
                <span className={`inline-block h-3 w-3 rounded-full ${overallDot}`} />
                <span className={`text-base font-semibold ${overallText}`}>{overallHeadline}</span>
              </div>
              {insightDate ? <p className="mt-1.5 text-xs text-me-charcoal/45">体检日期 {insightDate} · 共 {evaluated} 条广告</p> : null}
            </div>
          </Accordion>
          <Accordion title="广告成绩单（内部看）" defaultOpen>
            {growth && !('viewer' in growth) ? (
              <>
                <ScorecardSection scorecard={growth.payload?.scorecard} clientId={clientId} />
                {growth.payload?.scorecard && !('error' in growth.payload.scorecard) && (
                  <QualifiedPanel block={growth.payload.scorecard.qualified} />
                )}
              </>
            ) : <p className="text-sm text-me-charcoal/55">内部员工才看得到成绩单。</p>}
          </Accordion>
          <Accordion title="为什么这样判断">
            <TodayGoalProgress state={growth} clientId={clientId} todayCrmLeads={todayCrmLeads} liveNote={growth && 'goal_live' in growth ? goalLiveNote(growth.goal_live) : undefined} />
            <WarMapPanel clientId={clientId} />
          </Accordion>
          <Accordion title="自动化和每天上限">
            <LiveTodayPanel clientId={clientId} part="today" />
            <LivePacingPanel clientId={clientId} />
          </Accordion>
        </div>
      )}
    </>
  )
}
