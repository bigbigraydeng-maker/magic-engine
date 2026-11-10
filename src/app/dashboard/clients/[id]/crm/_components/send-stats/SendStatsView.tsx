'use client'

/**
 * 「发信统计」：每封信发给了谁，客人有没有反应。按「哪天发的哪类信」分组，每位客人一个状态标签；
 * 上面四张汇总卡片。读失败显示原因和重试，绝不显示成「还没有发信」；点击或回应读不到时说「读不到」，不显示成 0。
 * 数据：GET /api/clients/[id]/crm/send-stats（lib/crm/send-stats）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SendStatRow, SendStatsPayload } from '@/lib/crm/send-stats/types'
import { dayTitle, groupRows, labelsOf, statusOf, summarise, groupLabelOf, type MailGroup } from '@/lib/crm/send-stats/view'
import { REASON_LABELS } from '../RecentSends'

const DAY_CHOICES = [7, 30, 90] as const
const ROWS_SHOWN = 8

const timeFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : timeFormatter.format(d)
}

const REACTION_TEXT: Record<string, string> = {
  email: '回信了',
  phone: '来电话了',
  whatsapp: '发消息了',
  messenger: '发消息了',
  sms: '发消息了',
}

const CHIP = 'inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold'

function Chip({ tone, children }: { tone: 'green' | 'blue' | 'gray' | 'amber' | 'red'; children: React.ReactNode }) {
  const cls = {
    green: 'bg-green-100 text-green-800',
    blue: 'bg-blue-100 text-blue-800',
    gray: 'bg-me-stone/60 text-me-charcoal/70',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
  }[tone]
  return <span className={`${CHIP} ${cls}`}>{children}</span>
}

function clickText(row: SendStatRow): string {
  const clicks = row.clicks ?? []
  const first = clicks[0]
  if (!first) return ''
  return clicks.length === 1 ? `点了${first.label} · ${when(first.firstClickedAt)}` : `点了 ${clicks.length} 个链接 · ${when(first.firstClickedAt)}`
}

function RowChips({ row }: { row: SendStatRow }) {
  const s = statusOf(row)
  if (s.kind === 'blocked') return <Chip tone="amber">被拦：{REASON_LABELS[row.blockReason ?? ''] ?? row.blockReason ?? '原因没记'}</Chip>
  if (s.kind === 'failed') return <Chip tone="red">出错：{REASON_LABELS[row.blockReason ?? ''] ?? '没发出去'}</Chip>
  if (s.kind === 'unknown') return <Chip tone="red">状态不明</Chip>
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {row.reaction && (
        <Chip tone="blue">
          {REACTION_TEXT[row.reaction.channel] ?? '联系了我们'} · {when(row.reaction.at)}
        </Chip>
      )}
      {s.clicked && <Chip tone="green">{clickText(row)}</Chip>}
      {!s.clicked && (s.clicksReadable ? <Chip tone="gray">没点链接</Chip> : <Chip tone="gray">点击读不到</Chip>)}
    </span>
  )
}

function Card({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'green' }) {
  const box = tone === 'green' ? 'bg-green-50' : 'border border-me-charcoal/10 bg-white'
  return (
    <div className={`rounded-lg p-3 ${box}`}>
      <p className="text-xs text-me-charcoal/60">{label}</p>
      <p className={`text-2xl font-semibold ${tone === 'green' ? 'text-green-800' : 'text-me-charcoal'}`}>{value}</p>
      <p className="text-xs text-me-charcoal/65">{note}</p>
    </div>
  )
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `占 ${Math.round((part / whole) * 100)}%`
}

function GroupBlock({ group, clientId, now }: { group: MailGroup; clientId: string; now: Date }) {
  const [open, setOpen] = useState(false)
  const shown = open ? group.rows : group.rows.slice(0, ROWS_SHOWN)
  const { sent, clicked, reacted } = group.summary
  return (
    <section className="overflow-hidden rounded-xl border border-me-charcoal/10 bg-white" data-testid="send-group">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-me-charcoal/10 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-me-charcoal">
          {dayTitle(group.day, now)} · {group.label}
        </h2>
        <p className="text-xs text-me-charcoal/60">
          发出 {sent} 封 · {clicked} 位点了链接{reacted > 0 ? ` · ${reacted} 位联系了我们` : ''}
          {group.summary.notDelivered > 0 ? ` · ${group.summary.notDelivered} 封没发出` : ''}
        </p>
      </header>
      <ul>
        {shown.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-me-charcoal/5 px-4 py-2 last:border-b-0">
            <a href={`/dashboard/clients/${clientId}/crm/all?contact=${r.contactId}`} className="min-w-0 flex-1 basis-40 truncate text-sm text-me-ochre underline">
              {r.contactName ?? '（没有名字）'}
            </a>
            <span className="whitespace-nowrap text-xs text-me-charcoal/65">{when(r.createdAt)} 发出</span>
            <span className="flex min-w-[9rem] justify-end">
              <RowChips row={r} />
            </span>
          </li>
        ))}
      </ul>
      {group.rows.length > ROWS_SHOWN && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="w-full border-t border-me-charcoal/10 px-4 py-2 text-left text-xs font-semibold text-me-charcoal/70">
          {open ? '收起' : `还有 ${group.rows.length - ROWS_SHOWN} 位 · 展开全部`}
        </button>
      )}
    </section>
  )
}

export function SendStatsView({ clientId }: { clientId: string }): JSX.Element {
  const [data, setData] = useState<SendStatsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState<number>(7)
  const [label, setLabel] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/send-stats?days=${days}`)
      const json = (await res.json().catch(() => ({}))) as Partial<SendStatsPayload> & { error?: string }
      if (!res.ok || !Array.isArray(json.rows)) {
        setData(null)
        setError(json.error ?? '服务器没有返回原因')
        return
      }
      setData(json as SendStatsPayload)
    } catch {
      setData(null)
      setError('网络出错')
    } finally {
      setLoading(false)
    }
  }, [clientId, days])

  useEffect(() => {
    void load()
  }, [load])

  const now = new Date()
  const labels = useMemo(() => (data ? labelsOf(data.rows) : []), [data])
  const rows = useMemo(() => (data ? data.rows.filter((r) => label === null || groupLabelOf(r) === label) : []), [data, label])
  const groups = useMemo(() => groupRows(rows), [rows])
  const total = useMemo(() => summarise(rows), [rows])
  const reactionsOk = data?.reactionsReadable !== false

  return (
    <div data-testid="send-stats">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setLabel(null)} className={`rounded-lg px-3 py-1 text-xs font-bold ${label === null ? 'bg-me-charcoal text-white' : 'border border-me-stone bg-white text-me-charcoal'}`}>
          全部
        </button>
        {labels.map((l) => (
          <button key={l} type="button" onClick={() => setLabel(l)} className={`rounded-lg px-3 py-1 text-xs font-bold ${label === l ? 'bg-me-charcoal text-white' : 'border border-me-stone bg-white text-me-charcoal'}`}>
            {l}
          </button>
        ))}
        <span className="flex-1" />
        <label className="text-xs text-me-charcoal/60">
          时间{' '}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded border border-me-stone bg-white px-2 py-1 text-xs">
            {DAY_CHOICES.map((d) => (
              <option key={d} value={d}>
                最近 {d} 天
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-me-stone bg-white px-3 py-1 text-xs font-bold text-me-charcoal disabled:opacity-40">
          刷新
        </button>
      </div>

      {loading && <p className="text-xs text-me-charcoal/65">加载中…</p>}

      {!loading && error && (
        <div className="text-xs text-red-700" role="alert">
          <p>暂时读不到发信统计：{error}</p>
          <button type="button" onClick={() => void load()} className="mt-2 rounded-lg border border-me-stone bg-white px-3 py-1 text-xs font-bold text-me-charcoal">
            重试
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="mb-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Card label="发出" value={String(total.sent)} note="位客人" />
            <Card label="点了链接" value={String(total.clicked)} note={`${percent(total.clicked, total.sent)}，肯定看过`} tone="green" />
            <Card label="回了信 / 来了电话" value={reactionsOk ? String(total.reacted) : '—'} note={reactionsOk ? '发信之后' : '这一项读不到'} />
            <Card label="被拦 / 出错" value={String(total.notDelivered)} note={total.notDelivered === 0 ? '都发出去了' : '没发出去'} />
          </div>
          <p className="mb-4 text-xs text-me-charcoal/65">没点链接的客人，不代表没看：系统只能看到点击，看不到「打开」。</p>
          {data.truncated && <p className="mb-3 text-xs text-amber-800">这段时间的信太多，只显示最新的 500 封。</p>}
          {groups.length === 0 ? (
            <p className="text-xs text-me-charcoal/65">这段时间没有发信记录。</p>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <GroupBlock key={`${g.day}|${g.label}`} group={g} clientId={clientId} now={now} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
