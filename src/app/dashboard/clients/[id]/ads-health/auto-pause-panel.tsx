'use client'

/**
 * 「等你点头」标签的内容：Ads D3 自动暂停的一键批准。
 *
 * 这个文件是从 `clients/[id]/ad-health/auto-pause/page.tsx` **整段搬过来**的
 * （设计稿 `docs/specs/2026-10-18-ads-door-merge-design-v0.1.md` §5 步 2）。
 * 搬的只是位置：组件改成收 `clientId` 入参而不是自己读路由参数，
 * 🔴 **两个接口的网址、方法、请求体、409 的处理一个字都没动** —— 那是这一刀的全部红线。
 *
 * 原页面保留为跳转（旧网址和已发出的待办不失效）。
 *
 * 🔴 `expectedDecisionId` 是这份数据的版本号：点的时候原样带回去。
 *    服务端对不上会回 409（你看的不是最新的 / 已经在别处处理了）—— 这时一律重拉列表
 *    让人重看，**绝不**自己换一个新 id 再提交（那等于替人盲签）。
 */

import React, { useCallback, useEffect, useState } from 'react'

interface PendingItem {
  runId: string
  expectedDecisionId: string | null
  adsetId: string | null
  adsetName: string | null
  adAccountId: string | null
  diagnosisTitle: string | null
  insightDate: string | null
  createdAt: string
}

export default function AutoPausePanel({ clientId }: { readonly clientId: string }) {
  const [items, setItems] = useState<PendingItem[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyRunId, setBusyRunId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/ad-health/auto-pause`)
    if (!res.ok) {
      // 保留前一条提示（比如 409 的原因），别让「刷新也失败」把它盖掉
      setError((prev) => (prev ? `${prev}；刷新也失败了（${res.status}）` : `读取失败（${res.status}）`))
      return
    }
    const json = await res.json()
    setItems(json.items ?? [])
    setHasMore(json.hasMore === true)
  }, [clientId])

  useEffect(() => {
    if (clientId) void load()
  }, [clientId, load])

  const decide = async (it: PendingItem, resolution: 'approve' | 'reject') => {
    if (!it.expectedDecisionId) return
    const reason = resolution === 'reject' ? window.prompt('为什么不批准？（必填）') ?? '' : undefined
    if (resolution === 'reject' && !reason) return
    setBusyRunId(it.runId)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-health/auto-pause/${it.runId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, expectedDecisionId: it.expectedDecisionId, ...(reason ? { reason } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setError(`${json.error ?? '这条已经变了'}（列表已刷新，请再看一遍）`)
        await load()
        return
      }
      if (!res.ok || json.error) {
        setError(json.error ?? `操作失败（${res.status}）`)
        return
      }
      // 🔴 批准签了、但暂停没成（执行失败 / 被挡）时接口回 200 + ok:false —— 必须说出来，
      //    不然卡片一消失，人会以为广告已经停了。但「别人刚批了、正在执行」不是没成，不能说广告还在投
      if (json.kind === 'in_progress' || json.kind === 'idempotent_hit') {
        setError('这条刚被别人批了，正在暂停——过一会儿刷新看结果，不用再点')
      } else if (json.ok === false) {
        setError(`没暂停成：${json.humanReason ?? '原因未知'}——广告还在投`)
      }
      await load()
    } finally {
      setBusyRunId(null)
    }
  }

  if (!items) return <div>{error ?? '加载中…'}</div>

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        系统发现这些广告组连续花钱没结果，建议暂停。点「批准」立刻暂停（不用去 Meta 后台），点「驳回」就不停。
      </p>
      {error && <div style={{ color: '#b91c1c', marginBottom: 12 }}>{error}</div>}
      {items.length === 0 && <div style={{ color: '#64748b' }}>目前没有等你点头的暂停建议。</div>}
      {hasMore && (
        <div style={{ color: '#b45309', marginBottom: 12 }}>还有更早的建议没列出来——先处理完这些，刷新后会接着显示。</div>
      )}
      {items.map((it) => (
        <div key={it.runId} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{it.diagnosisTitle ?? '花钱没结果'}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            广告组：{it.adsetName ?? '（名字没记下）'}（编号 {it.adsetId ?? '未知'}）· 诊断日：{it.insightDate ?? '未知'}
          </div>
          {!it.expectedDecisionId && (
            <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>
              这条的审批记录对不上，先别点——它不会自己执行。回我一句「查一下这条暂停建议」我来理顺。
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={!it.expectedDecisionId || busyRunId === it.runId}
              onClick={() => decide(it, 'approve')}
              style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}
            >
              批准（立刻暂停）
            </button>
            <button
              disabled={!it.expectedDecisionId || busyRunId === it.runId}
              onClick={() => decide(it, 'reject')}
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
