'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import type { AdsNextStepRow, AdsNextStepView, HealthRedLightsView } from '@/lib/ads-strategy/ads-next-step/types'

type LoadStatus = 'loading' | 'done' | 'failed'

function healthRowText(
  status: LoadStatus,
  row: HealthRedLightsView | undefined,
): React.ReactNode {
  if (status === 'loading') return <span className="text-gray-500">读取中…</span>
  if (status === 'failed' || row === undefined) {
    return <span className="text-gray-500">没读到</span>
  }
  if (row.kind === 'staff_only') {
    return (
      <span className="text-gray-500">
        详细体检结论仅内部可见；请看下方「今天看这里」和每条广告。
      </span>
    )
  }
  return rowText(status, row, (data) => (
    <ul className="list-disc pl-4 space-y-0.5">
      {data.items.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  ), '今天没有需要优先处理的体检红灯')
}

function rowText<T>(
  status: LoadStatus,
  row: AdsNextStepRow<T> | undefined,
  renderOk: (data: T) => React.ReactNode,
  emptyLabel: string,
): React.ReactNode {
  if (status === 'loading') return <span className="text-gray-500">读取中…</span>
  if (status === 'failed' || row === undefined) {
    return <span className="text-gray-500">没读到</span>
  }
  if (row.kind === 'unreadable') return <span className="text-gray-500">没读到</span>
  if (row.kind === 'empty') return <span className="text-gray-500">{emptyLabel}</span>
  return renderOk(row.data)
}

export default function AdsNextStepCard({
  clientId,
  refreshKey = 0,
}: {
  readonly clientId: string
  readonly refreshKey?: number
}) {
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [view, setView] = useState<AdsNextStepView | null>(null)

  useEffect(() => {
    let alive = true
    setLoadStatus('loading')
    setView(null)
    fetch(`/api/clients/${clientId}/ad-health/next-step`)
      .then(async (res) => {
        if (!res.ok) {
          if (!alive) return
          setLoadStatus('failed')
          return
        }
        const json = await res.json() as { view?: AdsNextStepView }
        if (!alive) return
        if (!json.view) {
          setLoadStatus('failed')
          return
        }
        setView(json.view)
        setLoadStatus('done')
      })
      .catch(() => {
        if (alive) setLoadStatus('failed')
      })
    return () => { alive = false }
  }, [clientId, refreshKey])

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
            {healthRowText(loadStatus, view?.healthRedLights)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">待批动作</dt>
          <dd className="mt-0.5 text-slate-800">
            {rowText(loadStatus, view?.pendingActions, (data) => (
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
            {rowText(loadStatus, view?.prescription, (data) => {
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
