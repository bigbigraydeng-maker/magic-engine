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
import type { AdNode, AdsetNode, CampaignNode, DeliveryState, EntityMetrics } from '@/lib/ads-strategy/entity-tree/build'
import type { EntityTreeResult } from '@/lib/ads-strategy/entity-tree/load'

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
      <span>点击率 <span className="text-gray-700">{m.ctr === null ? '—' : `${(m.ctr * 100).toFixed(1)}%`}</span></span>
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

function AdRow({ ad }: { ad: AdNode }) {
  return (
    <div className="ml-5 mt-1.5 border-l border-gray-100 pl-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-gray-600 truncate" title={ad.name}>广告 · {ad.name}</span>
        <StateBadge state={ad.state} status={ad.effectiveStatus} />
      </div>
      <Numbers m={ad.metrics} />
    </div>
  )
}

function AdsetRow({ s }: { s: AdsetNode }) {
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
      {s.ads.map(ad => <AdRow key={ad.id} ad={ad} />)}
    </div>
  )
}

function CampaignBlock({ c }: { c: CampaignNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-800 truncate" title={c.name}>系列 · {c.name}</span>
        <StateBadge state={c.state} status={c.effectiveStatus} />
      </div>
      <p className="text-xs text-gray-400">在投 {c.runningAdsets} 个广告组、{c.runningAds} 条广告</p>
      {c.metricsShared
        ? <p className="text-xs text-amber-700">这个系列的合计里混着不是这个客户的广告组，系列合计不显示；看下面各广告组的数字。</p>
        : <Numbers m={c.metrics} />}
      {c.unplacedAds.count > 0 && (
        <p className="text-xs text-gray-400">
          另有 {c.unplacedAds.count} 条广告（多半已删除）花了 {usd(c.unplacedAds.spend)}、留资 {c.unplacedAds.leads}，归不到具体广告组，已含在上面广告组的数字里。
        </p>
      )}
      {c.adsets.map(s => <AdsetRow key={s.id} s={s} />)}
    </div>
  )
}

export default function EntityTreePanel({ clientId }: { clientId: string }) {
  const [result, setResult] = useState<EntityTreeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)

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

  const running = tree.campaigns.filter(c => c.state === 'running' || c.runningAdsets > 0)
  const unclear = tree.campaigns.filter(c => !running.includes(c) && c.state === 'unknown')
  const stopped = tree.campaigns.filter(c => !running.includes(c) && c.state !== 'unknown')

  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold text-gray-800">广告组和广告（近 {tree.window.days} 天）</h2>
      <p className="mb-3 text-xs text-gray-400">
        {tree.window.since} 到 {tree.window.until}
        {tree.snapshotAt ? ` · 开关状态来自系统定期快照（最近一次记录 ${fmtNzTime(tree.snapshotAt)}），刚开关的几个小时内可能还没反映` : ' · 没有状态快照，开关状态读不到'}
      </p>
      {noPageRegistered && <p className="mb-3 text-sm text-amber-700">这个客户没有登记 Facebook 主页，没法确认哪些广告是它的，所以一条都没列出。</p>}
      {hiddenAdsets > 0 && <p className="mb-3 text-xs text-gray-400">另有 {hiddenAdsets} 个广告组没有列出（属于别的主页，或确认不了归属），不代表它们没在投。</p>}
      {running.length === 0 && !noPageRegistered && <p className="text-sm text-gray-500">能确认是这个客户的广告组里，快照显示现在没有在投的。</p>}
      <div className="grid gap-3">
        {running.map(c => <CampaignBlock key={c.id} c={c} />)}
      </div>
      {unclear.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-sm text-amber-700">状态还没确认的系列 {unclear.length} 个（审核中、有问题或还没有快照，不能说它们停了）</p>
          <div className="grid gap-3">
            {unclear.map(c => <CampaignBlock key={c.id} c={c} />)}
          </div>
        </div>
      )}
      {stopped.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-gray-500">已停的系列 {stopped.length} 个（点开看）</summary>
          <div className="mt-3 grid gap-3">
            {stopped.map(c => <CampaignBlock key={c.id} c={c} />)}
          </div>
        </details>
      )}
    </section>
  )
}
