'use client'

/**
 * 「每条广告」标签里的广告组 / 广告明细（只读，只给内部员工）：
 * 系列 → 广告组 → 广告，每一层各自近 7 天的花费、留资、每条留资花费，以及现在开着还是停了。
 * 数据来自 /ad-health/entities（读库里的每日数据和每日快照，不调 Meta）。
 *
 * 🔴 状态取自每日快照：今天刚开的广告组最晚明天才出现，页面上写明这一点，不装成实时。
 * 🔴 每层数字只算它自己那一层，不把下一层加上来（系列的数字不等于广告组数字之和，因为口径是 Meta 各层各报各的）。
 * 🔴 读不到就写「读不到」；403 直接不渲染（内部页面，非内部人员不该看到报错框）。
 */

import React, { useEffect, useState } from 'react'
import type { AdNode, AdsetNode, CampaignNode, DeliveryState, EntityMetrics, EntityTree } from '@/lib/ads-strategy/entity-tree/build'

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
        {s.dailyBudget === null ? '每天预算：读不到' : `每天预算 ${s.currency ?? ''} ${s.dailyBudget.toFixed(0)}`}
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
      <Numbers m={c.metrics} />
      {c.adsets.map(s => <AdsetRow key={s.id} s={s} />)}
    </div>
  )
}

export default function EntityTreePanel({ clientId }: { clientId: string }) {
  const [tree, setTree] = useState<EntityTree | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/clients/${clientId}/ad-health/entities`)
      .then(async r => {
        if (r.status === 403) { if (alive) setHidden(true); return null }
        const json = (await r.json()) as { tree?: EntityTree; error?: string }
        if (!r.ok || !json.tree) throw new Error(json.error ?? '读不到')
        return json.tree
      })
      .then(t => { if (alive && t) setTree(t) })
      .catch(() => alive && setError('读不到广告组和广告明细'))
    return () => { alive = false }
  }, [clientId])

  if (hidden) return null
  if (error) return <p className="mb-4 text-sm text-gray-500">{error}</p>
  if (!tree) return <p className="mb-4 text-sm text-gray-400">广告组和广告加载中…</p>

  const running = tree.campaigns.filter(c => c.state === 'running' || c.runningAdsets > 0)
  const rest = tree.campaigns.filter(c => !running.includes(c))

  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold text-gray-800">广告组和广告（近 {tree.window.days} 天）</h2>
      <p className="mb-3 text-xs text-gray-400">
        {tree.window.since} 到 {tree.window.until}
        {tree.snapshotAt ? ` · 开关状态取自 ${fmtNzTime(tree.snapshotAt)} 的每日快照，今天新开的最晚明天下午才会出现在这里` : ' · 没有状态快照，开关状态读不到'}
      </p>
      {running.length === 0 && <p className="text-sm text-gray-500">快照里现在没有在投的广告组。</p>}
      <div className="grid gap-3">
        {running.map(c => <CampaignBlock key={c.id} c={c} />)}
      </div>
      {rest.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-gray-500">已停的系列 {rest.length} 个（点开看）</summary>
          <div className="mt-3 grid gap-3">
            {rest.map(c => <CampaignBlock key={c.id} c={c} />)}
          </div>
        </details>
      )}
    </section>
  )
}
