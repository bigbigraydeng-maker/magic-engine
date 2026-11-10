'use client'

import React, { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import type { CardPayload } from '@/components/confirmation-card/HeldCards'
import { MeButton, MePanel, MePill, MeStatCard } from '@/components/ui/me-primitives'
import { ApprovalContextNotes } from '../../ads-health/approval-context-notes'
import { useAutoPauseData, type PendingItem } from './use-auto-pause-data'

const REJECT_REASONS = ['刚改过，观察一下', '品牌曝光优先', '季节性投放', '其他'] as const

function matchPauseCard(p: PendingItem, cards: readonly CardPayload[]): CardPayload | null {
  const name = p.adsetName?.trim()
  if (!name) return null
  return cards.find((c) => c.what.includes(name) || c.scope.includes(name) || c.account.includes(name)) ?? null
}

function CardShell({ children, id }: { children: React.ReactNode; id?: string }) {
  return <div id={id} className="rounded-2xl border border-me-stone bg-white p-5 shadow-card">{children}</div>
}

export function AutoPausePageView({
  clientId,
  variant = 'page',
  onPendingAdsChanged,
}: {
  readonly clientId: string
  readonly variant?: 'page' | 'embed'
  readonly onPendingAdsChanged?: () => void
}) {
  const { pending, hasMore, cards, ledger, dryRun, error, reload } = useAutoPauseData(clientId)
  const [banner, setBanner] = useState<string | null>(null)
  const [busyRunId, setBusyRunId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  const dismissed = useMemo(() => ledger.filter((r) => r.status === 'rejected'), [ledger])
  const pausedRows = useMemo(() => ledger.filter((r) => r.status === 'paused'), [ledger])
  const failedRows = useMemo(() => ledger.filter((r) => r.status === 'failed'), [ledger])

  const counts = useMemo(() => {
    if (!pending) return { waiting: 0, issued: cards.length, paused: pausedRows.length, dismissed: dismissed.length }
    const waiting = pending.filter((p) => !matchPauseCard(p, cards)).length
    return { waiting, issued: pending.length - waiting + cards.length, paused: pausedRows.length, dismissed: dismissed.length }
  }, [pending, cards, pausedRows.length, dismissed.length])

  const decide = useCallback(async (it: PendingItem, resolution: 'approve' | 'reject', reason?: string) => {
    if (!it.expectedDecisionId) return
    setBusyRunId(it.runId)
    setBanner(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-health/auto-pause/${it.runId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, expectedDecisionId: it.expectedDecisionId, ...(reason ? { reason } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 202 || json.status === 'awaiting_confirmation') {
        setBanner(json.humanReason ?? '确认卡已出，还没暂停。')
      } else if (res.status === 409) {
        setBanner(`${json.error ?? '这条已经变了'}（列表已刷新，请再看一遍）`)
      } else if (!res.ok || json.error) {
        setBanner(json.error ?? `操作失败（${res.status}）`)
      } else if (json.ok === false) {
        setBanner(`没暂停成：${json.humanReason ?? '原因未知'}——广告还在投`)
      } else if (resolution === 'reject') {
        setBanner('已记下：这条先不暂停。')
      }
      await reload()
      onPendingAdsChanged?.()
    } finally {
      setBusyRunId(null)
      setRejecting(null)
      setRejectReason(null)
      setRejectNote('')
    }
  }, [clientId, reload, onPendingAdsChanged])

  if (pending === null) {
    return error ? (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>{error}</p>
        <MeButton type="button" variant="ghost" size="sm" className="mt-3" onClick={() => void reload()}>重试</MeButton>
      </div>
    ) : <p className="text-me-charcoal/60">加载中…</p>
  }

  const pad = variant === 'page' ? 'px-6 py-8 md:px-10 md:py-10' : ''

  return (
    <div className={pad}>
      {variant === 'page' && (
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="font-display text-2xl font-bold text-me-charcoal md:text-3xl">自动暂停</h1>
            <p className="mt-2 text-base text-me-charcoal/70">花钱没结果时会出暂停建议；任何动作仍只走确认卡，不直接改 Meta。</p>
          </div>
          <MeButton variant="ghost" size="sm" href={`/dashboard/clients/${clientId}/ads-health?tab=settings`}>暂停规则</MeButton>
        </header>
      )}

      {dryRun === true && (
        <div className="mb-4 rounded-xl border border-me-ochre/40 bg-me-ochre/10 px-4 py-3 text-sm">这位客户仍在<strong>演练模式</strong>，命中只会记演练，不会出现在待批准列表。</div>
      )}
      {(banner || error) && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{banner ?? error}</div>
      )}

      {variant === 'page' && (
        <MePanel className="mb-8">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-bold text-me-charcoal">
              {counts.waiting + counts.issued > 0 ? `有 ${counts.waiting + counts.issued} 条暂停相关事项` : '目前没有新的暂停建议'}
            </h2>
            {counts.waiting > 0 && <MePill tone="track">广告还在投</MePill>}
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MeStatCard value={counts.waiting} label="等你出确认卡" tone="ochre" />
            <MeStatCard value={counts.issued} label="确认卡已出" tone="stone" />
            <MeStatCard value={counts.paused} label="已暂停" tone="attn" />
            <MeStatCard value="—" label="预估日浪费" tone="attn" footer={<p className="text-xs text-me-charcoal/45">暂无可靠估算</p>} />
          </div>
        </MePanel>
      )}

      <section className="space-y-4">
        {hasMore && <p className="text-sm text-me-ochre">还有更早的建议没列出——处理完这些后刷新。</p>}
        {pending.length === 0 && failedRows.length === 0 && (
          <p className="text-sm text-me-charcoal/55">这一栏目前没有等你点头的暂停建议。</p>
        )}
        {pending.map((it) => {
          const issued = Boolean(matchPauseCard(it, cards))
          return (
            <CardShell key={it.runId} id={`pause-row-${it.runId}`}>
              <MePill tone={issued ? 'exec' : 'track'}>{issued ? '确认卡已出 · 还没暂停' : '广告还在投'}</MePill>
              <h3 className="mt-2 font-display text-lg font-semibold">{it.diagnosisTitle ?? '花钱没结果'}</h3>
              <p className="mt-1 text-sm text-me-charcoal/60">{it.adsetName ? `广告组：${it.adsetName}` : '广告组名字没记下'} · 诊断日：{it.insightDate ?? '—'}</p>
              <ApprovalContextNotes clientId={clientId} adsetId={it.adsetId} runId={it.runId} runStatus="pending_approval" />
              <div className="mt-4 flex flex-wrap gap-2">
                {issued ? (
                  <MeButton variant="secondary" size="sm" href={`/dashboard/clients/${clientId}/confirmation-cards`}>去确认卡 →</MeButton>
                ) : (
                  <>
                    <MeButton type="button" variant="secondary" size="sm" disabled={!it.expectedDecisionId || busyRunId === it.runId} onClick={() => void decide(it, 'approve')}>出确认卡（暂停）</MeButton>
                    <MeButton type="button" variant="ghost" size="sm" disabled={!it.expectedDecisionId || busyRunId === it.runId} onClick={() => { setRejecting(it.runId); setRejectReason(null); setRejectNote('') }}>不用暂停</MeButton>
                  </>
                )}
              </div>
              {rejecting === it.runId && (
                <div className="mt-4 rounded-xl border border-me-stone bg-me-ivory p-4">
                  <p className="text-sm font-medium">为什么不用暂停？</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {REJECT_REASONS.map((label) => (
                      <button key={label} type="button" onClick={() => setRejectReason(label)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${rejectReason === label ? 'bg-me-charcoal text-white' : 'border border-me-stone bg-white'}`}>{label}</button>
                    ))}
                  </div>
                  {rejectReason === '其他' && (
                    <textarea className="mt-2 w-full rounded-xl border border-me-stone p-3 text-sm" rows={2} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
                  )}
                  <div className="mt-2 flex gap-2">
                    <MeButton type="button" variant="ghost" size="sm" onClick={() => setRejecting(null)}>取消</MeButton>
                    <MeButton type="button" variant="secondary" size="sm" onClick={() => {
                      const reason = rejectReason === '其他' ? rejectNote.trim() : rejectReason
                      if (reason) void decide(it, 'reject', reason)
                    }}>记下，不暂停</MeButton>
                  </div>
                </div>
              )}
            </CardShell>
          )
        })}
        {failedRows.map((row) => (
          <CardShell key={row.id}>
            <MePill tone="rej">没暂停成</MePill>
            <p className="mt-2 font-semibold">{row.adsetName ?? row.diagnosisTitle ?? '花钱没结果'}</p>
            <p className="mt-1 text-sm text-me-charcoal/70">{row.reason ?? '请重新出确认卡或问助手。'}</p>
          </CardShell>
        ))}
      </section>

      {variant === 'page' && (
        <div className="mt-8 space-y-3 text-sm text-me-charcoal/75">
          {pausedRows.length > 0 && (
            <details className="rounded-xl border border-me-stone bg-white px-5 py-4">
              <summary className="cursor-pointer font-medium">已暂停 · 可以恢复（{pausedRows.length}）</summary>
              <ul className="mt-3 space-y-2">
                {pausedRows.map((r) => <li key={r.id}>{r.adsetName ?? r.diagnosisTitle} — <Link className="underline" href={`/dashboard/clients/${clientId}/confirmation-cards`}>去确认卡恢复</Link></li>)}
              </ul>
            </details>
          )}
          {dismissed.length > 0 && (
            <details className="rounded-xl border border-me-stone bg-white px-5 py-4">
              <summary className="cursor-pointer font-medium">不用暂停（{dismissed.length}）</summary>
              <ul className="mt-3 space-y-1">{dismissed.map((r) => <li key={r.id}>{r.adsetName ?? r.diagnosisTitle}{r.reason ? ` · ${r.reason}` : ''}</li>)}</ul>
            </details>
          )}
          <details className="rounded-xl border border-me-stone bg-white px-5 py-4" open>
            <summary className="cursor-pointer font-medium">什么时候会建议暂停？</summary>
            <p className="mt-2">D3「花钱没结果」命中且客户开了自动止损（非演练）时会出现；仍要出确认卡后才暂停。完整诊断见 <Link className="underline" href={`/dashboard/clients/${clientId}/ads-health`}>广告健康</Link>。</p>
          </details>
        </div>
      )}
    </div>
  )
}
