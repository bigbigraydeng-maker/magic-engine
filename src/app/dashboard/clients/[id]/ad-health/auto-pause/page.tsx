'use client'

/**
 * Ads D3 自动暂停——一键批准页。
 *
 * 列出这个客户当前等人点头的暂停建议，点「批准」立刻暂停（不用去 Meta 后台），
 * 点「驳回」就不停。读 `GET .../ad-health/auto-pause`，写
 * `POST .../ad-health/auto-pause/[runId]/decision`。
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface PendingItem {
  flywheelActionId: string
  actionRunId: string | null
  adsetId: string | null
  adsetName: string | null
  adAccountId: string | null
  diagnosisTitle: string | null
  insightDate: string | null
  createdAt: string
}

export default function AdsAutoPausePage() {
  const params = useParams()
  const clientId = params?.id as string
  const [items, setItems] = useState<PendingItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyRunId, setBusyRunId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const res = await fetch(`/api/clients/${clientId}/ad-health/auto-pause`)
    if (!res.ok) {
      setError(`读取失败（${res.status}）`)
      return
    }
    const json = await res.json()
    setItems(json.items ?? [])
  }, [clientId])

  useEffect(() => {
    if (clientId) void load()
  }, [clientId, load])

  const decide = async (runId: string, resolution: 'approve' | 'reject') => {
    setBusyRunId(runId)
    setError(null)
    try {
      const reason = resolution === 'reject' ? window.prompt('为什么不批准？（必填）') ?? '' : undefined
      if (resolution === 'reject' && !reason) {
        setBusyRunId(null)
        return
      }
      const res = await fetch(`/api/clients/${clientId}/ad-health/auto-pause/${runId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, ...(reason ? { reason } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) {
        setError(json.error ?? `操作失败（${res.status}）`)
        return
      }
      await load()
    } finally {
      setBusyRunId(null)
    }
  }

  if (!items) return <div style={{ padding: 24 }}>{error ?? '加载中…'}</div>

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>广告自动暂停 · 等你点头</h1>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        系统发现这些广告组连续花钱没结果，建议暂停。点「批准」立刻暂停（不用去 Meta 后台），点「驳回」就不停。
      </p>
      {error && <div style={{ color: '#b91c1c', marginBottom: 12 }}>{error}</div>}
      {items.length === 0 && <div style={{ color: '#64748b' }}>目前没有等你点头的暂停建议。</div>}
      {items.map((it) => (
        <div key={it.flywheelActionId} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{it.diagnosisTitle ?? '花钱没结果'}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            广告组：{it.adsetName ?? it.adsetId ?? '未知'} · 诊断日：{it.insightDate ?? '未知'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={!it.actionRunId || busyRunId === it.actionRunId}
              onClick={() => it.actionRunId && decide(it.actionRunId, 'approve')}
              style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}
            >
              批准（立刻暂停）
            </button>
            <button
              disabled={!it.actionRunId || busyRunId === it.actionRunId}
              onClick={() => it.actionRunId && decide(it.actionRunId, 'reject')}
              style={{ background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}
            >
              驳回
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
