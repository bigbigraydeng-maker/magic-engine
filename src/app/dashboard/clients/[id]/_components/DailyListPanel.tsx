'use client'

// 「今天到后天要发的 Reel」：开了社媒 Agent 后每天排进来的片，在这里一次放行（每条分别授权、绑定你看到的内容）。没勾的不算剔除；剔除要单独点并写原因。
// 设计稿 docs/specs/2026-11-05-daily-list-card-design-v0.1.md §9。

import { useCallback, useEffect, useState } from 'react'
import { ReelListRows, defaultChecked, readReelList, type ReelListItem } from './ReelListRows'

interface ResultLine {
  work_order_id: string
  action: 'approve' | 'exclude'
  outcome: 'armed' | 'already_armed' | 'excluded' | 'refused' | 'would_arm' | 'would_exclude'
  reason: string | null
}

interface Receipt {
  items: ResultLine[]
  receipt_saved: boolean
}

const REASON_ZH: Record<string, string> = {
  not_on_list: '这条已不在清单上，刷新再看',
  not_selectable: '这条现在不能放行',
  content_changed: '内容和你看到的不一样了，刷新再看',
  day_changed: '发布日变了，刷新再看',
  day_passed: '发布日已过',
  in_flight: '正在发或已发',
  excluded_by_card: '已被剔除',
  gate_failed: '没过发布前检查',
  reason_required: '剔除要写原因',
  write_conflict: '刚好有人在改，刷新再试',
}

const OUTCOME_ZH: Record<ResultLine['outcome'], string> = {
  armed: '已放行，到日公开',
  already_armed: '之前已放行',
  excluded: '已剔除，不会再自动排',
  refused: '没放行：',
  would_arm: '演练：会放行',
  would_exclude: '演练：会剔除',
}

function readReceipt(json: unknown): Receipt | null {
  if (!json || typeof json !== 'object') return null
  const receipt = (json as { receipt?: unknown }).receipt
  if (!receipt || typeof receipt !== 'object') return null
  const r = receipt as { items?: unknown; receipt_saved?: unknown }
  if (!Array.isArray(r.items) || typeof r.receipt_saved !== 'boolean') return null
  return { items: r.items as ResultLine[], receipt_saved: r.receipt_saved }
}

function readError(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const err = (json as { error?: unknown }).error
  return typeof err === 'string' ? err : null
}

function reasonText(reason: string | null): string {
  if (!reason) return '没放行'
  return REASON_ZH[reason] ?? '没放行'
}

export function DailyListPanel({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<ReelListItem[] | null>(null)
  const [switchOn, setSwitchOn] = useState(false)
  const [publishHour, setPublishHour] = useState(18)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<string[] | null>(null)
  const [excludeFor, setExcludeFor] = useState<string | null>(null)
  const [excludeReason, setExcludeReason] = useState('')
  const base = `/api/clients/${clientId}/daily-list`

  const load = useCallback(async () => {
    const res = await fetch(base).catch(() => null)
    if (res?.status === 403) { setError(null); setItems([]); return } // not an admin: nothing to manage here
    const json: unknown = res ? await res.json().catch(() => null) : null
    const data = res?.ok ? readReelList(json) : null
    if (data === null) { setError('清单没读出来，不要当成没有要批的。'); return }
    setError(null)
    setSwitchOn(data.switchOn)
    setPublishHour(data.publishHour)
    setItems(data.items)
    setChecked(defaultChecked(data.items))
  }, [base])

  useEffect(() => { void load() }, [load])

  async function post(body: Record<string, unknown>): Promise<void> {
    setBusy(true)
    const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const json: unknown = res ? await res.json().catch(() => null) : null
    setBusy(false)
    if (!res?.ok) { setError(readError(json) ?? '没做成，请刷新再试。'); return }
    const receipt = readReceipt(json)
    if (!receipt) { setError('结果没读出来，请刷新核对。'); return }
    setError(null)
    setExcludeFor(null)
    setExcludeReason('')
    const lines = receipt.items.map((line) => {
      const item = items?.find((it) => it.work_order_id === line.work_order_id)
      const title = item?.title ?? line.work_order_id.slice(0, 8)
      const text = line.outcome === 'refused' ? OUTCOME_ZH.refused + reasonText(line.reason) : OUTCOME_ZH[line.outcome]
      return `${title}：${text}`
    })
    const anyEffective = receipt.items.some((line) => line.outcome === 'armed' || line.outcome === 'excluded')
    if (!receipt.receipt_saved && anyEffective) lines.push('结果已生效，但这次的记录没存上，告诉开发。')
    setLastResult(lines)
    await load()
  }

  function toggle(id: string): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function approveChecked(): void {
    const approve = (items ?? [])
      .filter((it) => checked.has(it.work_order_id) && it.selectable && it.fingerprint)
      .map((it) => ({ work_order_id: it.work_order_id, fingerprint: it.fingerprint, publish_on: it.publish_on }))
    void post({ approve, exclude: [] })
  }

  function confirmExclude(id: string): void {
    const reason = excludeReason.trim()
    if (!reason) return
    void post({ approve: [], exclude: [{ work_order_id: id, reason }] })
  }

  if (items === null) {
    if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>
    return null
  }
  if (items.length === 0 && lastResult === null) return null

  const n = (items ?? []).filter((it) => checked.has(it.work_order_id) && it.selectable && it.fingerprint).length

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-2">
      <h3 className="text-sm font-medium text-slate-900">今天到后天要发的 Reel</h3>
      {!switchOn && <p className="text-xs text-slate-500">按日公开没打开：现在只能看，放行了到日也不会发。</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {lastResult && lastResult.length > 0 && (
        <ul className="space-y-1">
          {lastResult.map((line, i) => (
            <li key={i} className="text-xs text-slate-700">{line}</li>
          ))}
        </ul>
      )}
      <ReelListRows
        items={items}
        publishHour={publishHour}
        checked={checked}
        onToggle={toggle}
        disabled={busy}
        renderExtra={(it) => (
          excludeFor === it.work_order_id ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                placeholder="为什么不发（必填）"
                value={excludeReason}
                onChange={(e) => setExcludeReason(e.target.value)}
              />
              <button
                type="button"
                className="underline disabled:opacity-50"
                disabled={excludeReason.trim() === '' || busy}
                onClick={() => confirmExclude(it.work_order_id)}
              >
                确认剔除
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="underline"
              onClick={() => { setExcludeFor(it.work_order_id); setExcludeReason('') }}
            >
              剔除
            </button>
          )
        )}
      />
      <div className="space-y-1">
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50"
          disabled={n === 0 || busy || !switchOn}
          onClick={approveChecked}
        >
          放行勾上的 {n} 条
        </button>
        <p className="text-xs text-slate-500">没勾的不会发，也不算剔除；勾上的在各自那天 {publishHour}:00 自动公开，过了日子没批的会自动退回内容池。</p>
      </div>
    </section>
  )
}
