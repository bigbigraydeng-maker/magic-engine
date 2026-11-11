'use client'

/**
 * 「ME 外改动」：前后两次广告快照对得上、但附近没有 Kernel 动作记录的预算 / 开停 / 新广告组 / 新广告。
 * 只读。403（客户自己看这页）不渲染。
 */

import React, { useEffect, useState } from 'react'
import { MePanel, MePill } from '@/components/ui/me-primitives'
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

  if (error) return <p className="mb-6 text-sm text-me-charcoal/55">系统外的改动这次没读到。</p>
  if (!changes || changes.length === 0) return null
  const shown = changes.slice(0, SHOWN)

  return (
    <section className="mb-6" aria-label={OUTSIDE_TAG}>
      <MePanel>
        <div className="mb-2"><MePill tone="exec">{OUTSIDE_TAG}</MePill></div>
        <p className="text-sm leading-relaxed text-me-charcoal/70">
          这些变化写在前后两次广告快照里，附近没有本系统的动作记录。时间是快照记下来的时间（新西兰时间），实际改动可能更早一点。
        </p>
        <ul className="mt-3 grid gap-2">
          {shown.map((change) => (
            <li key={`${change.kind}:${change.entityId}:${change.capturedAt}`} className="text-sm leading-snug text-me-charcoal">
              {change.where} · {change.what} · 大约 {formatNzWhen(change.capturedAt)}
            </li>
          ))}
        </ul>
        {changes.length > shown.length && (
          <p className="mt-2 text-xs text-me-charcoal/55">还有 {changes.length - shown.length} 条，这里只列最近 {SHOWN} 条。</p>
        )}
      </MePanel>
    </section>
  )
}
