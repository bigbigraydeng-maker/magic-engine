'use client'

/**
 * 今日实时（只读，只给内部员工）：官方广告账户里「现在」在投的广告组，今天花了多少、出了多少曝光、
 * 日预算多少、什么状态，以及读取时间。数据来自 /ad-health/live（直接读 Meta，服务端缓存 60 秒）。
 *
 * 🔴 读不到就写「读不到」，不画成 0 或「正常」。403 直接不渲染（内部页面，非内部人员不该看到报错框）。
 * part='today'：在投的广告组列表；part='new'：今天新建/重建的广告组（还没有日数据，体检里看不到）。
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { LiveAdset, LiveAccountView, LiveTodayView } from '@/lib/ads-strategy/heartbeat/live-view'

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

function money(n: number | null, cur: string | null): string {
  return n === null ? '读不到' : `${n.toFixed(2)} ${cur ?? ''}`.trim()
}

function AdsetRow({ a, cur }: { a: LiveAdset; cur: string | null }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-1.5 pr-3 text-gray-800">{a.name ?? a.adsetId}{a.createdToday && <span className="ml-1.5 rounded bg-sky-100 px-1.5 text-xs text-sky-700">今天新建</span>}</td>
      <td className="py-1.5 pr-3 text-gray-600">{a.status ?? '读不到'}</td>
      <td className="py-1.5 pr-3 text-right">{money(a.spendToday, cur)}</td>
      <td className="py-1.5 pr-3 text-right">{a.impressionsToday === null ? '读不到' : a.impressionsToday.toLocaleString('en-US')}</td>
      <td className="py-1.5 text-right">{a.budgetLevel === 'campaign' ? '预算在系列层' : money(a.dailyBudget, cur)}</td>
    </tr>
  )
}

function AccountBlock({ acc, part }: { acc: LiveAccountView; part: 'today' | 'new' }) {
  const rows = part === 'today' ? acc.active : acc.newToday
  return (
    <div className="mt-3">
      <p className="text-xs text-gray-400">账户 {acc.adAccountId}{acc.accountDay ? ` · 账户日 ${acc.accountDay}` : ''}</p>
      {acc.readState !== 'ok' && (
        <p className={`mt-1 text-sm ${acc.readState === 'unreadable' ? 'text-red-700' : 'text-amber-700'}`}>
          {acc.readState === 'unreadable' ? '这个账户现在读不到：' : '部分数据没读到（下面标「读不到」的格子不是 0）：'}{acc.reason ?? ''}
        </p>
      )}
      {acc.readState !== 'unreadable' && rows.length === 0 && (
        <p className="mt-1 text-sm text-gray-500">{part === 'today' ? '现在没有状态为「投放中」的广告组。' : '今天没有新建或重建的广告组。'}</p>
      )}
      {rows.length > 0 && (
        <table className="mt-1 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400">
              <th className="font-normal">广告组</th><th className="font-normal">状态</th>
              <th className="text-right font-normal">今天已花</th><th className="text-right font-normal">曝光</th><th className="text-right font-normal">日预算</th>
            </tr>
          </thead>
          <tbody>{rows.map(a => <AdsetRow key={a.adsetId} a={a} cur={acc.currency} />)}</tbody>
        </table>
      )}
      {part === 'new' && rows.some(a => a.adCount > 0) && (
        <p className="mt-1 text-xs text-gray-400">{rows.map(a => `${a.name ?? a.adsetId}：${a.adCount} 条广告`).join(' · ')}</p>
      )}
    </div>
  )
}

export default function LiveTodayPanel({ clientId, part }: { clientId: string; part: 'today' | 'new' }) {
  const [view, setView] = useState<LiveTodayView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-health/live`, { cache: 'no-store' })
      if (res.status === 403) { setHidden(true); return }
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.view) { setError(body.error ?? '读不到今日实时数据'); setView(null); return }
      setError(null); setView(body.view as LiveTodayView)
    } catch {
      setError('读不到今日实时数据（网络出错）'); setView(null)
    } finally {
      setBusy(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  if (hidden) return null
  const title = part === 'today' ? '今日实时' : '今天新建/重建的广告组'
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        <button type="button" onClick={() => void load()} disabled={busy} className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50">
          {busy ? '读取中…' : '刷新'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {view && (
        <>
          <p className="mt-1 text-xs text-gray-400">读取时间 {fmtTime(view.readAtIso)}（60 秒内重复刷新不会重读 Meta）</p>
          {view.accounts.length === 0 && <p className="mt-2 text-sm text-gray-500">没有可读取的正式广告账户（被隐藏的旧账户不在这里看）。</p>}
          {view.accounts.map(acc => <AccountBlock key={acc.adAccountId} acc={acc} part={part} />)}
        </>
      )}
    </div>
  )
}
