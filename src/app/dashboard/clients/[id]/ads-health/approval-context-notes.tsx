'use client'

import React, { useEffect, useState } from 'react'
import type { AdsetApprovalContext } from '@/lib/ads-strategy/approval-run-context/types'
import { readbackDisplayLabel } from '@/lib/ads-strategy/approval-run-context/types'
import { formatCooldownNote } from '@/lib/ads-strategy/approval-run-context/load-adset-approval-context'

export function ApprovalContextNotes({
  clientId,
  adsetId,
  runId,
  runStatus,
  showThisRunReadback,
}: {
  readonly clientId: string
  readonly adsetId: string | null
  readonly runId: string
  readonly runStatus?: string
  readonly showThisRunReadback?: boolean
}) {
  const [ctx, setCtx] = useState<AdsetApprovalContext | null>(null)

  useEffect(() => {
    if (!adsetId) return
    let alive = true
    const q = new URLSearchParams({ adset_id: adsetId, run_id: runId })
    fetch(`/api/clients/${clientId}/ad-health/approval-context?${q}`)
      .then(async (res) => (res.ok ? res.json() as Promise<{ context?: AdsetApprovalContext }> : null))
      .then((json) => { if (alive && json?.context) setCtx(json.context) })
      .catch(() => { /* 展示没读到 */ })
    return () => { alive = false }
  }, [clientId, adsetId, runId])

  if (!adsetId) return null

  const cooldownLine = ctx ? formatCooldownNote(ctx.cooldown) : '冷却期：没读到'

  let lastLine = '上次动作：没读到'
  if (ctx?.lastOnAdset.kind === 'none') lastLine = '上次动作：这个广告组还没有过内核记录'
  if (ctx?.lastOnAdset.kind === 'ok') {
    const { summary, finishedAt, readback } = ctx.lastOnAdset.data
    lastLine = `上次动作：${summary}（${new Date(finishedAt).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' })}）· ${readbackDisplayLabel(readback)}`
  }

  const terminal = runStatus
    && ['succeeded', 'failed', 'dead_letter', 'denied'].includes(runStatus)
  const showReadback = showThisRunReadback ?? Boolean(terminal)

  return (
    <div style={{ fontSize: 12, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
      <p>{lastLine}</p>
      {cooldownLine && <p>{cooldownLine}</p>}
      {showReadback && ctx && (
        <p>本条读回：{readbackDisplayLabel(ctx.thisRunReadback)}</p>
      )}
      {!ctx && <p>上下文：没读到</p>}
    </div>
  )
}
