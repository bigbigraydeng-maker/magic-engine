'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import type { AdsNextStepRow, AdsNextStepView } from '@/lib/ads-strategy/ads-next-step/types'

function rowText<T>(
  row: AdsNextStepRow<T>,
  renderOk: (data: T) => React.ReactNode,
  emptyLabel: string,
): React.ReactNode {
  if (row.kind === 'unreadable') return <span className="text-gray-500">没读到</span>
  if (row.kind === 'empty') return <span className="text-gray-500">{emptyLabel}</span>
  return renderOk(row.data)
}

export default function AdsNextStepCard({ clientId }: { readonly clientId: string }) {
  const [view, setView] = useState<AdsNextStepView | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/clients/${clientId}/ad-health/next-step`)
      .then(async (res) => (res.ok ? res.json() as Promise<{ view?: AdsNextStepView }> : null))
      .then((json) => { if (alive && json?.view) setView(json.view) })
      .catch(() => { /* 保持 null → 三行都显示没读到 */ })
    return () => { alive = false }
  }, [clientId])

  const health = view?.healthRedLights ?? { kind: 'unreadable' as const }
  const pending = view?.pendingActions ?? { kind: 'unreadable' as const }
  const rx = view?.prescription ?? { kind: 'unreadable' as const }

  return (
    <section
      className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-label="广告下一步"
    >
      <h2 className="text-sm font-semibold text-slate-800">广告下一步</h2>
      <p className="mt-0.5 text-xs text-slate-400">体检红灯、等人批的动作、华佗处方 —— 只读汇总</p>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-slate-500">体检红灯</dt>
          <dd className="mt-0.5 text-slate-800">
            {rowText(health, (data) => (
              <ul className="list-disc pl-4 space-y-0.5">
                {data.items.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ), '今天没有需要优先处理的体检红灯')}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">待批动作</dt>
          <dd className="mt-0.5 text-slate-800">
            {rowText(pending, (data) => (
              <ul className="space-y-1">
                {data.items.map((item) => (
                  <li key={`${item.href}:${item.summary}`}>
                    <Link href={item.href} className="text-sky-700 hover:underline">
                      {item.summary}
                    </Link>
                  </li>
                ))}
              </ul>
            ), '目前没有等人批的广告动作')}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">处方状态</dt>
          <dd className="mt-0.5 text-slate-800">
            {rowText(rx, (data) => {
              const when = data.approvedAt
                ? ` · 批准 ${new Date(data.approvedAt).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })}`
                : ''
              return (
                <span>
                  第 {data.version} 版 · {data.statusLabel}
                  {when}
                </span>
              )
            }, '还没有华佗处方')}
          </dd>
        </div>
      </dl>
    </section>
  )
}
