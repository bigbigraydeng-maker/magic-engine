'use client'

/**
 * 「ME 外改动」：前后两次广告快照对得上、但附近没有本系统动作记录的预算 / 新广告组 / 新广告。
 * 只读。403（客户自己看这页）不渲染。
 */

import React, { useEffect, useState } from 'react'
import { formatNzWhen, OUTSIDE_TAG, type OutsideChange } from '@/lib/ads-strategy/outside-change/detect'

const SHOWN = 20

export default function OutsideChangePanel({ clientId }: { clientId: string }) {
  const [changes, setChanges] = useState<OutsideChange[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/clients/${clientId}/ad-health/outside-changes`)
      .then(async (res) => {
        if (res.status === 403) return []
        if (!res.ok) throw new Error('unreadable')
        const json = (await res.json()) as { changes?: unknown }
        return Array.isArray(json.changes) ? json.changes as OutsideChange[] : []
      })
      .then((rows) => { if (alive) setChanges(rows) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [clientId])

  if (error) return <p className="mb-4 text-sm text-gray-500">系统外的改动这次没读到。</p>
  if (!changes || changes.length === 0) return null
  const shown = changes.slice(0, SHOWN)

  return (
    <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4" aria-label={OUTSIDE_TAG}>
      <h2 className="text-sm font-semibold text-amber-950">{OUTSIDE_TAG}</h2>
      <p className="mt-1 text-xs leading-relaxed text-amber-900">
        这些变化写在前后两次广告快照里，附近没有本系统的动作记录。时间是快照记下来的时间（新西兰时间），实际改动可能更早一点。
      </p>
      <ul className="mt-3 grid gap-2">
        {shown.map((change) => (
          <li key={`${change.kind}:${change.entityId}:${change.capturedAt}`} className="text-sm leading-snug text-gray-800">
            <span className="mr-2 inline-block rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-950">{OUTSIDE_TAG}</span>
            {change.where} · {change.what} · 大约 {formatNzWhen(change.capturedAt)}
          </li>
        ))}
      </ul>
      {changes.length > shown.length && (
        <p className="mt-2 text-xs text-amber-900">还有 {changes.length - shown.length} 条，这里只列最近 {SHOWN} 条。</p>
      )}
    </section>
  )
}
