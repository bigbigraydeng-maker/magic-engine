'use client'

/**
 * 节奏 / 收盘预测（只读）。仅用既有 `/ad-health/live`；缺日内 10 分钟历史时不假造预测。
 * 刷新间隔最多 120 秒。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { LiveAccountView, LiveTodayView } from '@/lib/ads-strategy/heartbeat/live-view'
import {
  LIVE_PACING_ALGO_VERSION,
  REPORT_LAG_MINUTES,
} from '@/lib/ads-strategy/live-pacing'

const REFRESH_MS = 120_000

const INSUFFICIENT_INTRADAY =
  '数据不足：老 ME 尚未有 campaign 级日内 10 分钟累计样本，无法做节奏外推。'

function fmtNzdt(iso: string | null): string {
  if (!iso) return '读不到'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function sumSpendToday(acc: LiveAccountView): number | null {
  if (acc.readState === 'unreadable') return null
  let sum = 0
  let any = false
  for (const a of acc.active) {
    if (a.spendToday === null) continue
    sum += a.spendToday
    any = true
  }
  return any ? sum : null
}

function money(n: number | null, cur: string | null): string {
  if (n === null) return '读不到'
  return `${n.toFixed(2)} ${cur ?? ''}`.trim()
}

type MetricRowProps = {
  label: string
  available: boolean
  children: React.ReactNode
}

function MetricRow({ label, available, children }: MetricRowProps) {
  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="py-2 pr-3 text-xs text-gray-500">{label}</td>
      <td className="py-2 text-sm text-gray-800">
        {available ? children : <span className="text-amber-700">{INSUFFICIENT_INTRADAY}</span>}
      </td>
    </tr>
  )
}

function AccountPacingBlock({ acc }: { acc: LiveAccountView }) {
  const spend = sumSpendToday(acc)
  const hasIntradayHistory = false

  return (
    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/80 p-3">
      <p className="text-xs text-gray-400">
        账户 {acc.adAccountId}
        {acc.accountDay ? ` · 账户日 ${acc.accountDay}` : ''}
        {acc.currency ? ` · ${acc.currency}` : ''}
      </p>
      {acc.readState !== 'ok' && (
        <p className="mt-1 text-sm text-amber-700">
          {acc.readState === 'unreadable' ? '这个账户读不到，以下指标不可用。' : '部分字段读不到。'}
        </p>
      )}
      <table className="mt-2 w-full">
        <tbody>
          <tr className="align-top">
            <td className="py-2 pr-3 text-xs text-gray-500">今日累计花费</td>
            <td className="py-2 text-sm text-gray-800">{money(spend, acc.currency)}</td>
          </tr>
          <MetricRow label="收盘预测 · 花费" available={hasIntradayHistory}>
            —
          </MetricRow>
          <MetricRow label="收盘预测 · 结果" available={hasIntradayHistory}>
            —
          </MetricRow>
          <MetricRow label="收盘预测 · 链接点击" available={hasIntradayHistory}>
            —
          </MetricRow>
          <MetricRow label="近 7 天同刻对比" available={hasIntradayHistory}>
            —
          </MetricRow>
          <MetricRow label="分段花费 / 效率 (CTR·CPC·CPM)" available={hasIntradayHistory}>
            —
          </MetricRow>
        </tbody>
      </table>
    </div>
  )
}

export default function LivePacingPanel({ clientId }: { clientId: string }) {
  const [view, setView] = useState<LiveTodayView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-health/live`, { cache: 'no-store' })
      if (res.status === 403) {
        setHidden(true)
        return
      }
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.view) {
        setError(body.error ?? '读不到今日实时数据')
        setView(null)
        return
      }
      setError(null)
      setView(body.view as LiveTodayView)
    } catch {
      setError('读不到今日实时数据（网络出错）')
      setView(null)
    } finally {
      setBusy(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => {
      void load()
    }, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const dataLabel = useMemo(() => fmtNzdt(view?.readAtIso ?? null), [view?.readAtIso])

  if (hidden) return null

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">节奏 / 收盘预测</h2>
        <span className="text-xs text-gray-400">约每 2 分钟自动刷新</span>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        数据时间 {dataLabel}（NZDT 标注）· 假定报表延迟 {REPORT_LAG_MINUTES} 分钟 · 算法 {LIVE_PACING_ALGO_VERSION}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        以下为参考区间，不构成预算承诺；CRM 表单进线预测见上方「今天每小时进线」，与此处 Meta 花费节奏无关。
      </p>
      {busy && !view && <p className="mt-2 text-sm text-gray-500">读取中…</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {view && (
        <>
          {view.accounts.length === 0 && (
            <p className="mt-2 text-sm text-gray-500">没有可读取的正式广告账户。</p>
          )}
          {view.accounts.map((acc) => (
            <AccountPacingBlock key={acc.adAccountId} acc={acc} />
          ))}
        </>
      )}
      <p className="mt-3 text-xs text-gray-500">
        需要处理投放问题？
        <Link href={`/dashboard/clients/${clientId}/ads-health?tab=approvals`} className="ml-1 text-sky-700 hover:underline">
          去已有动作卡 / 待批准
        </Link>
      </p>
    </div>
  )
}
