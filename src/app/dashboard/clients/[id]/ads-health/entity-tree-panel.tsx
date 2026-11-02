'use client'

/**
 * 「每条广告」标签里的广告组 / 广告明细（只读，只给内部员工）：
 * 系列 → 广告组 → 广告，每一层各自近 7 天的花费、留资、每条留资花费，以及现在开着还是停了。
 * 数据来自 /ad-health/entities（读库里的每日数据和每日快照，不调 Meta）。
 *
 * 🔴 状态取自系统定期快照：刚开关的几个小时内可能还没反映，页面上写明这一点，不装成实时。
 * 🔴 确认不了归属的广告组不列，但要把「有 N 个没列出」写出来，不能让人以为「没在投」。
 * 🔴 系列合计里混着别家广告组的钱时，不显示系列合计。
 * 🔴 每层数字只算它自己那一层，不把下一层加上来（系列的数字不等于广告组数字之和，因为口径是 Meta 各层各报各的）。
 * 🔴 读不到就写「读不到」；403 直接不渲染（内部页面，非内部人员不该看到报错框）。
 */

import React, { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { AdNode, AdsetNode, CampaignNode, DeliveryState, EntityMetrics } from '@/lib/ads-strategy/entity-tree/build'
import { ratesFromMetrics, type FunnelRates } from '@/lib/ads-strategy/entity-tree/funnel-baseline'
import type { EntityTreeResult } from '@/lib/ads-strategy/entity-tree/load'

export type EntityTreeShowMode = 'running' | 'all'

/** 网址 `?show=`：默认只看在投；只认 running / all。 */
export function showFromQuery(raw: string | null): EntityTreeShowMode {
  return raw === 'all' ? 'all' : 'running'
}

/** 相对赢家基线差 ≥30% 才算「偏差大」（CPM 越高越差；完成率 / 播放率越低越差）。 */
export const FUNNEL_LARGE_DEVIATION_RATIO = 0.3

const STATE_META: Record<DeliveryState, { label: string; dot: string; text: string }> = {
  running: { label: '在投', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  stopped: { label: '已停', dot: 'bg-gray-300', text: 'text-gray-400' },
  unknown: { label: '状态不明', dot: 'bg-amber-400', text: 'text-amber-700' },
}

function fmtNzTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

const usd = (n: number) => `$${n.toFixed(0)}`

function Numbers({ m }: { m: EntityMetrics }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400 tabular-nums">
      <span>花费 <span className="text-gray-700">{usd(m.spend)}</span></span>
      <span>留资 <span className="text-gray-700">{m.leads}</span></span>
      <span>每条 <span className="text-gray-700">{m.costPerLead === null ? '—' : `$${m.costPerLead.toFixed(1)}`}</span></span>
      <span>链接点击率 <span className="text-gray-700">{m.ctr === null ? '—' : `${(m.ctr * 100).toFixed(1)}%`}</span></span>
    </div>
  )
}

function StateBadge({ state, status }: { state: DeliveryState; status: string | null }) {
  const meta = STATE_META[state]
  return (
    <span className={`inline-flex items-center gap-1 text-xs shrink-0 ${meta.text}`} title={status ?? '没有状态记录'}>
      <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

function pct(n: number | null): string {
  return n === null ? '—' : `${(n * 100).toFixed(1)}%`
}

function money1(n: number | null): string {
  return n === null ? '—' : `$${n.toFixed(1)}`
}

function isStoppedDelivery(state: DeliveryState): boolean {
  return state === 'stopped'
}

export interface RunningFilterResult {
  campaign: CampaignNode
  hiddenAdsetCount: number
  hiddenAdCount: number
  hiddenAdsets: AdsetNode[]
  hiddenAdsUnderRunningAdsets: AdNode[]
}

/** 在投系列下藏已停广告组 / 已停广告；状态不明的不当已停。 */
export function applyRunningEntityFilter(c: CampaignNode): RunningFilterResult {
  const hiddenAdsets: AdsetNode[] = []
  const hiddenAdsUnderRunningAdsets: AdNode[] = []
  const visibleAdsets: AdsetNode[] = []
  let hiddenAdsetCount = 0
  let hiddenAdCount = 0

  for (const s of c.adsets) {
    if (isStoppedDelivery(s.state)) {
      hiddenAdsetCount++
      hiddenAdCount += s.ads.length
      hiddenAdsets.push(s)
      continue
    }
    const visibleAds = s.ads.filter(a => !isStoppedDelivery(a.state))
    const stoppedAds = s.ads.filter(a => isStoppedDelivery(a.state))
    hiddenAdCount += stoppedAds.length
    hiddenAdsUnderRunningAdsets.push(...stoppedAds)
    visibleAdsets.push({ ...s, ads: visibleAds })
  }

  return {
    campaign: { ...c, adsets: visibleAdsets },
    hiddenAdsetCount,
    hiddenAdCount,
    hiddenAdsets,
    hiddenAdsUnderRunningAdsets,
  }
}

export function funnelMetricDeviationClass(
  own: number | null,
  winner: number | null,
  higherIsBetter: boolean,
): string {
  if (own === null || winner === null || winner === 0) return 'text-gray-600'
  const ratio = FUNNEL_LARGE_DEVIATION_RATIO
  const bad = higherIsBetter
    ? own < winner * (1 - ratio)
    : own > winner * (1 + ratio)
  return bad ? 'text-amber-800 font-medium' : 'text-gray-600'
}

function versus(own: string, winner: FunnelRates | null, base: number | null, fmt: (n: number) => string): string {
  if (winner === null) return `${own}（样本不足）`
  return `${own}（赢家 ${base === null ? '—' : fmt(base)}）`
}

function CollapsedFunnelMetrics({ ad, winner }: { ad: AdNode; winner: FunnelRates | null }) {
  const rates = ratesFromMetrics(ad.metrics)
  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer text-gray-400 select-none">千次展示费用 · 表单完成率 · 3 秒播放率</summary>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-1">
        <span className={funnelMetricDeviationClass(rates.cpm, winner?.cpm ?? null, false)}>
          千次展示费用 {versus(money1(rates.cpm), winner, winner?.cpm ?? null, money1)}
        </span>
        <span className={funnelMetricDeviationClass(rates.completion, winner?.completion ?? null, true)}>
          表单完成率 {versus(pct(rates.completion), winner, winner?.completion ?? null, pct)}
        </span>
        <span className={funnelMetricDeviationClass(rates.hook, winner?.hook ?? null, true)}>
          3 秒播放率 {versus(pct(rates.hook), winner, winner?.hook ?? null, pct)}
        </span>
      </div>
    </details>
  )
}

function AdTable({ ads, winner }: { ads: AdNode[]; winner: FunnelRates | null }) {
  if (ads.length === 0) return null
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs tabular-nums">
        <thead>
          <tr className="border-b border-gray-100 text-left text-gray-400">
            <th className="py-1 pr-2 font-normal w-[72px]">状态</th>
            <th className="py-1 pr-2 font-normal">广告名</th>
            <th className="py-1 pr-2 font-normal text-right w-[56px]">花费</th>
            <th className="py-1 pr-2 font-normal text-right w-[44px]">留资</th>
            <th className="py-1 pr-2 font-normal text-right w-[64px]">每条成本</th>
            <th className="py-1 font-normal text-right w-[72px]">链接点击率</th>
          </tr>
        </thead>
        <tbody>
          {ads.map(ad => (
            <React.Fragment key={ad.id}>
              <tr className="text-gray-700">
                <td className="py-1.5 pr-2 align-top"><StateBadge state={ad.state} status={ad.effectiveStatus} /></td>
                <td className="py-1.5 pr-2 align-top max-w-[200px]">
                  <span className="block truncate" title={ad.name}>{ad.name}</span>
                </td>
                <td className="py-1.5 pr-2 text-right align-top">{usd(ad.metrics.spend)}</td>
                <td className="py-1.5 pr-2 text-right align-top">{ad.metrics.leads}</td>
                <td className="py-1.5 pr-2 text-right align-top">
                  {ad.metrics.costPerLead === null ? '—' : `$${ad.metrics.costPerLead.toFixed(1)}`}
                </td>
                <td className="py-1.5 text-right align-top">
                  {ad.metrics.ctr === null ? '—' : `${(ad.metrics.ctr * 100).toFixed(1)}%`}
                </td>
              </tr>
              <tr>
                <td colSpan={6} className="pb-2 pl-2">
                  <CollapsedFunnelMetrics ad={ad} winner={winner} />
                </td>
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HiddenStoppedSummary({
  hiddenAdsetCount,
  hiddenAdCount,
  hiddenAdsets,
  hiddenAdsUnderRunningAdsets,
  winner,
}: {
  hiddenAdsetCount: number
  hiddenAdCount: number
  hiddenAdsets: AdsetNode[]
  hiddenAdsUnderRunningAdsets: AdNode[]
  winner: FunnelRates | null
}) {
  if (hiddenAdsetCount === 0 && hiddenAdCount === 0) return null
  return (
    <details className="mt-2 text-xs text-gray-500">
      <summary className="cursor-pointer select-none">
        另有 {hiddenAdsetCount} 个已停广告组、{hiddenAdCount} 条已停广告（点开看）
      </summary>
      <div className="mt-2 space-y-2 border-l-2 border-gray-100 pl-3">
        {hiddenAdsets.map(s => (
          <div key={s.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-600 truncate" title={s.name}>广告组 · {s.name}</span>
              <StateBadge state={s.state} status={s.effectiveStatus} />
            </div>
            <AdTable ads={s.ads} winner={winner} />
          </div>
        ))}
        {hiddenAdsUnderRunningAdsets.length > 0 && (
          <div>
            <p className="text-gray-400 mb-1">在投广告组里的已停广告</p>
            <AdTable ads={hiddenAdsUnderRunningAdsets} winner={winner} />
          </div>
        )}
      </div>
    </details>
  )
}

function AdsetRow({ s, winner }: { s: AdsetNode; winner: FunnelRates | null }) {
  return (
    <div className="mt-2.5 ml-2 border-l-2 border-gray-100 pl-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700 truncate" title={s.name}>广告组 · {s.name}</span>
        <StateBadge state={s.state} status={s.effectiveStatus} />
      </div>
      <div className="text-xs text-gray-400">
        {s.dailyBudget === null ? '每天预算：设在系列上，或读不到' : `每天预算 ${s.currency ?? ''} ${s.dailyBudget.toFixed(0)}`}
      </div>
      <Numbers m={s.metrics} />
      <AdTable ads={s.ads} winner={winner} />
    </div>
  )
}

function CampaignBlock({
  c,
  winner,
  runningOnly,
}: {
  c: CampaignNode
  winner: FunnelRates | null
  runningOnly: boolean
}) {
  const filtered = runningOnly ? applyRunningEntityFilter(c) : null
  const view = filtered ?? {
    campaign: c,
    hiddenAdsetCount: 0,
    hiddenAdCount: 0,
    hiddenAdsets: [] as AdsetNode[],
    hiddenAdsUnderRunningAdsets: [] as AdNode[],
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-800 truncate" title={view.campaign.name}>系列 · {view.campaign.name}</span>
        <StateBadge state={view.campaign.state} status={view.campaign.effectiveStatus} />
      </div>
      <p className="text-xs text-gray-400">在投 {view.campaign.runningAdsets} 个广告组、{view.campaign.runningAds} 条广告</p>
      {view.campaign.metricsShared
        ? <p className="text-xs text-amber-700">这个系列的合计里混着不是这个客户的广告组，系列合计不显示；看下面各广告组的数字。</p>
        : <Numbers m={view.campaign.metrics} />}
      {view.campaign.unplacedAds.count > 0 && (
        <p className="text-xs text-gray-400">
          另有 {view.campaign.unplacedAds.count} 条广告（多半已删除）花了 {usd(view.campaign.unplacedAds.spend)}、留资 {view.campaign.unplacedAds.leads}，归不到具体广告组，已含在上面广告组的数字里。
        </p>
      )}
      {view.campaign.adsets.map(s => (
        <AdsetRow key={s.id} s={s} winner={winner} />
      ))}
      {runningOnly && (
        <HiddenStoppedSummary
          hiddenAdsetCount={view.hiddenAdsetCount}
          hiddenAdCount={view.hiddenAdCount}
          hiddenAdsets={view.hiddenAdsets}
          hiddenAdsUnderRunningAdsets={view.hiddenAdsUnderRunningAdsets}
          winner={winner}
        />
      )}
    </div>
  )
}

function ShowModeToggle({ mode, onChange }: { mode: EntityTreeShowMode; onChange: (m: EntityTreeShowMode) => void }) {
  const btn = (key: EntityTreeShowMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(key)}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        mode === key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500">显示范围</span>
      {btn('running', '只看在投')}
      {btn('all', '全部')}
    </div>
  )
}

export default function EntityTreePanel({ clientId }: { clientId: string }) {
  const [result, setResult] = useState<EntityTreeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const showMode = showFromQuery(searchParams.get('show'))
  const runningOnly = showMode === 'running'

  function setShowMode(mode: EntityTreeShowMode) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('show', mode)
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }

  useEffect(() => {
    let alive = true
    fetch(`/api/clients/${clientId}/ad-health/entities`)
      .then(async r => {
        if (r.status === 403) { if (alive) setHidden(true); return null }
        const json = (await r.json()) as Partial<EntityTreeResult> & { error?: string }
        if (!r.ok || !json.tree) throw new Error(json.error ?? '读不到')
        return json as EntityTreeResult
      })
      .then(t => { if (alive && t) setResult(t) })
      .catch(() => alive && setError('读不到广告组和广告明细'))
    return () => { alive = false }
  }, [clientId])

  if (hidden) return null
  if (error) return <p className="mb-4 text-sm text-gray-500">{error}</p>
  if (!result) return <p className="mb-4 text-sm text-gray-400">广告组和广告加载中…</p>
  const { tree, hiddenAdsets, noPageRegistered } = result
  const winner = tree.winnerBaseline

  const running = tree.campaigns.filter(c => c.state === 'running' || c.runningAdsets > 0)
  const unclear = tree.campaigns.filter(c => !running.includes(c) && c.state === 'unknown')
  const stopped = tree.campaigns.filter(c => !running.includes(c) && c.state !== 'unknown')

  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold text-gray-800">广告组和广告（近 {tree.window.days} 天）</h2>
      <ShowModeToggle mode={showMode} onChange={setShowMode} />
      <p className="mb-3 text-xs text-gray-400">
        {tree.window.since} 到 {tree.window.until}
        {tree.snapshotAt
          ? ` · 开关状态来自 ${fmtNzTime(tree.snapshotAt)} 快照 · 今天在 Ads Manager 里刚开关的，明早 01:30 以后才会反映`
          : ' · 没有状态快照，开关状态读不到'}
      </p>
      {noPageRegistered && <p className="mb-3 text-sm text-amber-700">这个客户没有登记 Facebook 主页，没法确认哪些广告是它的，所以一条都没列出。</p>}
      {hiddenAdsets > 0 && <p className="mb-3 text-xs text-gray-400">另有 {hiddenAdsets} 个广告组没有列出（属于别的主页，或确认不了归属），不代表它们没在投。</p>}
      {running.length === 0 && !noPageRegistered && <p className="text-sm text-gray-500">能确认是这个客户的广告组里，快照显示现在没有在投的。</p>}
      <div className="grid gap-3">
        {running.map(c => <CampaignBlock key={c.id} c={c} winner={winner} runningOnly={runningOnly} />)}
      </div>
      {unclear.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-sm text-amber-700">状态还没确认的系列 {unclear.length} 个（审核中、有问题或还没有快照，不能说它们停了）</p>
          <div className="grid gap-3">
            {unclear.map(c => <CampaignBlock key={c.id} c={c} winner={winner} runningOnly={runningOnly} />)}
          </div>
        </div>
      )}
      {stopped.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-gray-500">已停的系列 {stopped.length} 个（点开看）</summary>
          <div className="mt-3 grid gap-3">
            {stopped.map(c => <CampaignBlock key={c.id} c={c} winner={winner} runningOnly={runningOnly} />)}
          </div>
        </details>
      )}
    </section>
  )
}
