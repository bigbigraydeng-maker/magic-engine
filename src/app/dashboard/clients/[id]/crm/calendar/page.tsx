'use client'

/**
 * 到期日历 —— 一个月一屏：客人约好的回电 + （内部身份可见）台账验收日。
 * 只读。Google 日历照旧保留，右上角有直达链接。
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { currentMonthNz, type DueItem } from '@/lib/crm/due-calendar'

const LEDGER_URL = 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/ledger/'
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthCells(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number)
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export default function CrmCalendarPage({ params }: { params: { id: string } }) {
  const clientId = params.id
  const thisMonth = useMemo(() => currentMonthNz(), [])
  const [month, setMonth] = useState(thisMonth)
  const [items, setItems] = useState<DueItem[]>([])
  const [includesLedger, setIncludesLedger] = useState(false)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetch(`/api/clients/${clientId}/crm/calendar?month=${month}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json() as Promise<{ items: DueItem[]; includesLedger: boolean }>
      })
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setIncludesLedger(data.includesLedger)
        setState('ok')
      })
      .catch(() => !cancelled && setState('error'))
    return () => {
      cancelled = true
    }
  }, [clientId, month])

  const byDate = useMemo(() => {
    const map = new Map<string, DueItem[]>()
    for (const it of items) map.set(it.date, [...(map.get(it.date) ?? []), it])
    return map
  }, [items])
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  const shown = selected ? byDate.get(selected) ?? [] : items
  const [yy, mm] = month.split('-')

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-me-charcoal">到期日历</h1>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="上个月" className="rounded border border-me-charcoal/20 px-2 py-1 text-sm" onClick={() => { setMonth(shiftMonth(month, -1)); setSelected(null) }}>‹</button>
          <span className="min-w-[7rem] text-center text-sm">{yy} 年 {Number(mm)} 月</span>
          <button type="button" aria-label="下个月" className="rounded border border-me-charcoal/20 px-2 py-1 text-sm" onClick={() => { setMonth(shiftMonth(month, 1)); setSelected(null) }}>›</button>
          {month !== thisMonth && (
            <button type="button" className="ml-2 text-sm underline" onClick={() => { setMonth(thisMonth); setSelected(null) }}>回到本月</button>
          )}
        </div>
        <a
          className="ml-auto text-sm underline"
          href={`https://calendar.google.com/calendar/u/0/r/month/${yy}/${Number(mm)}/1`}
          target="_blank"
          rel="noreferrer"
        >
          在 Google 日历打开
        </a>
      </div>

      <p className="mb-3 text-xs text-me-charcoal/60">
        <span className="mr-3">● 客人约好的回电</span>
        {includesLedger && <span>◆ 要核对的事项（我们自己的验证清单）</span>}
      </p>

      {state === 'error' && <p className="rounded border border-red-300 p-3 text-sm text-red-700">日历加载失败，刷新再试。</p>}
      {state === 'loading' && <p className="text-sm text-me-charcoal/60">加载中…</p>}

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-me-charcoal/15 bg-me-charcoal/15 text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-me-charcoal/5 px-2 py-1 text-center font-medium">{w}</div>
        ))}
        {monthCells(month).map((date, i) => {
          const list = date ? byDate.get(date) ?? [] : []
          const calls = list.filter((x) => x.kind === 'callback').length
          const checks = list.length - calls
          return (
            <button
              key={date ?? `pad-${i}`}
              type="button"
              disabled={!date}
              onClick={() => date && setSelected(selected === date ? null : date)}
              className={`min-h-[4.5rem] bg-white p-1.5 text-left align-top disabled:bg-me-charcoal/5 ${selected === date ? 'ring-2 ring-inset ring-me-charcoal' : ''}`}
            >
              {date && (
                <>
                  <span className={date === today ? 'rounded bg-me-charcoal px-1 text-white' : ''}>{Number(date.slice(8))}</span>
                  {calls > 0 && <span className="mt-1 block">● {calls} 个回电</span>}
                  {checks > 0 && <span className="block">◆ {checks} 项核对</span>}
                </>
              )}
            </button>
          )
        })}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">
        {selected ? `${selected} 当天` : '本月全部'}
        {selected && <button type="button" className="ml-2 text-xs font-normal underline" onClick={() => setSelected(null)}>看全月</button>}
      </h2>
      {state === 'ok' && shown.length === 0 && <p className="text-sm text-me-charcoal/60">这里没有安排。</p>}
      <ul className="space-y-1.5 text-sm">
        {shown.map((it) => (
          <li key={`${it.kind}-${it.refId}-${it.date}`} className="flex flex-wrap gap-x-3 rounded border border-me-charcoal/10 bg-white px-3 py-2">
            <span className="tabular-nums text-me-charcoal/60">{it.date.slice(5)}{it.time ? ` ${it.time}` : ''}</span>
            {it.kind === 'callback' ? (
              <>
                <span>● 回电：</span>
                <Link className="underline" href={`/dashboard/clients/${clientId}/crm/all?contact=${it.refId}`}>{it.title}</Link>
                {it.phone && <span className="text-me-charcoal/60">{it.phone}</span>}
              </>
            ) : (
              <>
                <span>◆ 核对：</span>
                <a className="underline" href={`${LEDGER_URL}${it.refId}.md`} target="_blank" rel="noreferrer">{it.title}</a>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
