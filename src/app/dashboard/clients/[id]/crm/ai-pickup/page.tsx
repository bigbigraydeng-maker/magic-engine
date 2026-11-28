'use client'

/**
 * 交给 AI 跟进 —— 今天按规则该交给 AI 的客人（打了没接通 / 询价 7 天没人打），看一眼、勾掉不该发的，点一次整批发 2027 目录。
 * 每位客人走现有「发送 2027 目录」那条路（所有发信检查照跑），发出确认之后才挂「AI 跟进中」；没点之前客人一直留在员工名单上。
 * 员工留言要发目录的客人排在最前（当天就出现）：发出后仍留在员工名单上，不挂「AI 跟进中」（lib/crm/ai-takeover/catalogue-ask.ts）。
 * 规则：lib/crm/ai-takeover/pickup.ts；名单：lib/crm/ai-takeover/pickup-list.ts。
 * 名单按「员工留言要目录 / 打了没接通 / 询价 7 天没人打」分组，每组可以全选、全不选（PM 2026-11-28：放行由客户员工自己点，要让他们一眼看懂每组是什么）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Status = 'ready' | 'tomorrow' | 'cannot_send' | 'queued'
interface Row {
  contactId: string
  name: string
  rule: 'not_reached' | 'never_called' | 'catalogue_asked'
  keepWithStaff: boolean
  why: string
  leadAt: string
  dials: number
  lastCallAt: string | null
  lastNote: string | null
  status: Status
  recipient: string | null
  sentLast7Days: number | null
  message: string | null
}
interface ListReply { catalogue: { versionLabel: string; validUntil: string } | null; dailyMax: number; rows: Row[] }
type Result = { kind: 'sending' } | { kind: 'sent'; kept: boolean } | { kind: 'refused' | 'unknown' | 'half'; message: string }

const RULE_LABEL: Record<Row['rule'], string> = { not_reached: '打了没接通', never_called: '询价 7 天没人打', catalogue_asked: '员工留言要目录' }
const RULE_ORDER: ReadonlyArray<Row['rule']> = ['catalogue_asked', 'not_reached', 'never_called']
const RULE_HINT: Record<Row['rule'], string> = {
  catalogue_asked: '员工在留言里写了要发目录。默认不勾：看一眼留言，确实要发再勾。只发目录，客人仍留在员工名单上。',
  not_reached: '打过电话没接通。发出目录后交给 AI 跟进，客人回信、回电会自动回到员工名单。',
  never_called: '询价满 7 天还没人打过电话。发出目录后交给 AI 跟进，客人回信、回电会自动回到员工名单。',
}
const UNKNOWN = '这封有没有发出去还不确定，先别重发，一分钟后看客人的往来记录。'

function day(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

function isReply(v: unknown): v is ListReply {
  return typeof v === 'object' && v !== null && Array.isArray((v as ListReply).rows) && 'catalogue' in v
}

function useList(clientId: string) {
  const [data, setData] = useState<ListReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/ai-pickup`)
      const json: unknown = await res.json().catch(() => null)
      if (!res.ok || !isReply(json)) throw new Error('bad')
      setData(json)
    } catch {
      setError('暂时读不到名单，请刷新再试。')
    }
  }, [clientId])
  useEffect(() => { void load() }, [load])
  return { data, error, reload: load }
}

async function sendOne(clientId: string, row: Row, requestId: string): Promise<Result> {
  try {
    const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/catalogue-send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, expectedRecipient: row.recipient, ...(row.keepWithStaff ? { keepWithStaff: true } : {}) }),
    })
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: unknown; message?: unknown }
    if (res.ok && json.ok === true) return { kind: 'sent', kept: row.keepWithStaff }
    const message = typeof json.message === 'string' && json.message !== '' ? json.message : UNKNOWN
    return { kind: json.sent === false ? 'refused' : json.sent === true ? 'half' : 'unknown', message }
  } catch {
    return { kind: 'unknown', message: UNKNOWN }
  }
}

function ResultLine({ r }: { r: Result | undefined }) {
  if (!r) return null
  if (r.kind === 'sending') return <p className="mt-1 text-[12.5px] text-me-charcoal/60">发送中…</p>
  if (r.kind === 'sent') return <p className="mt-1 text-[12.5px] text-emerald-700">{r.kept ? '✓ 目录已发出，客人仍在员工名单上' : '✓ 目录已发出，已交给 AI 跟进'}</p>
  const tone = r.kind === 'refused' ? 'text-me-charcoal/70' : 'text-amber-700'
  const head = r.kind === 'refused' ? '没发：' : r.kind === 'half' ? '目录已发出，标记没挂上，再点一次（不会重发）：' : '不确定：'
  return <p className={`mt-1 text-[12.5px] ${tone}`}>{head}{r.message}</p>
}

function RowCard({ clientId, row, checked, onToggle, result }: { clientId: string; row: Row; checked: boolean; onToggle?: () => void; result?: Result }) {
  const done = result?.kind === 'sent'
  return (
    <li className="flex gap-3 border-b border-me-charcoal/10 py-3 last:border-b-0">
      {onToggle ? (
        <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} disabled={done || result?.kind === 'sending'} onChange={onToggle} aria-label={`选中 ${row.name}`} />
      ) : <span className="w-4" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <a href={`/dashboard/clients/${clientId}/crm/all?view=all&contact=${row.contactId}`} className="font-medium text-me-charcoal underline-offset-2 hover:underline">{row.name}</a>
          <span className="rounded bg-me-charcoal/5 px-1.5 py-0.5 text-[11.5px] text-me-charcoal/70">{RULE_LABEL[row.rule]}</span>
          <span className="text-[12px] text-me-charcoal/50">询价 {day(row.leadAt)}{row.dials > 0 ? ` · 打了 ${row.dials} 次，最后 ${day(row.lastCallAt)}` : ''}</span>
        </div>
        {row.lastNote && <p className={`mt-0.5 text-[12.5px] text-me-charcoal/70 ${row.keepWithStaff ? '' : 'truncate'}`}>员工记的：{row.lastNote}</p>}
        {row.recipient && <p className="mt-0.5 text-[12px] text-me-charcoal/50">发到 {row.recipient} · 近 7 天已收 {row.sentLast7Days ?? 0} 封</p>}
        {row.message && row.status !== 'ready' && <p className="mt-0.5 text-[12px] text-me-charcoal/50">{row.message}</p>}
        <ResultLine r={result} />
      </div>
    </li>
  )
}

function Group({ title, rows, clientId }: { title: string; rows: Row[]; clientId: string }) {
  if (rows.length === 0) return null
  return (
    <details className="mt-4 rounded-lg border border-me-charcoal/10 bg-white px-4 py-2">
      <summary className="cursor-pointer py-1 text-sm text-me-charcoal/70">{title}（{rows.length} 位）</summary>
      <ul>{rows.map((r) => <RowCard key={r.contactId} clientId={clientId} row={r} checked={false} />)}</ul>
    </details>
  )
}

function ReadyGroup({ clientId, rule, rows, ticked, results, busy, onToggle, onSetAll }: {
  clientId: string; rule: Row['rule']; rows: Row[]; ticked: Set<string>; results: Record<string, Result>; busy: boolean
  onToggle: (id: string) => void; onSetAll: (ids: string[], on: boolean) => void
}) {
  if (rows.length === 0) return null
  const open = rows.filter((r) => results[r.contactId]?.kind !== 'sent')
  const chosen = open.filter((r) => ticked.has(r.contactId)).length
  return (
    <section className="mt-4 rounded-lg border border-me-charcoal/10 bg-white px-4 py-2" data-testid={`ready-group-${rule}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-me-charcoal/10 py-2">
        <h2 className="text-sm font-semibold text-me-charcoal">{RULE_LABEL[rule]} · {rows.length} 位<span className="ml-2 font-normal text-me-charcoal/60">已勾 {chosen} 位</span></h2>
        <div className="flex gap-3 text-[12.5px]">
          <button type="button" disabled={busy || open.length === 0} onClick={() => onSetAll(open.map((r) => r.contactId), true)} className="text-me-charcoal underline disabled:opacity-40">全选这一组</button>
          <button type="button" disabled={busy || chosen === 0} onClick={() => onSetAll(open.map((r) => r.contactId), false)} className="text-me-charcoal/70 underline disabled:opacity-40">全不选</button>
        </div>
      </div>
      <p className="pt-2 text-[12.5px] text-me-charcoal/60">{RULE_HINT[rule]}</p>
      <ul>{rows.map((r) => <RowCard key={r.contactId} clientId={clientId} row={r} checked={ticked.has(r.contactId)} onToggle={() => onToggle(r.contactId)} result={results[r.contactId]} />)}</ul>
    </section>
  )
}

export default function CrmAiPickupPage({ params }: { params: { id: string } }) {
  const clientId = params.id
  const { data, error, reload } = useList(clientId)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Record<string, Result>>({})
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestIds = useRef(new Map<string, string>())

  const ready = data?.rows.filter((r) => r.status === 'ready') ?? []
  useEffect(() => {
    // 「员工留言要目录」的不预先勾：留言只是线索（可能写的是「已经有目录了」），要人看过再勾。
    setTicked(new Set((data?.rows ?? []).filter((r) => r.status === 'ready' && !r.keepWithStaff).map((r) => r.contactId)))
  }, [data])
  const chosen = ready.filter((r) => ticked.has(r.contactId) && results[r.contactId]?.kind !== 'sent')

  const toggle = (id: string) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const setAll = (ids: string[], on: boolean) => setTicked((s) => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id) } return n })

  const sendAll = async () => {
    setConfirming(false)
    setBusy(true)
    for (const row of chosen) {
      // One id per guest per attempt: a refused send gets a new one; an unknown or half-done one keeps it, so it never sends twice.
      const id = requestIds.current.get(row.contactId) ?? globalThis.crypto.randomUUID()
      requestIds.current.set(row.contactId, id)
      setResults((m) => ({ ...m, [row.contactId]: { kind: 'sending' } }))
      const r = await sendOne(clientId, row, id)
      if (r.kind === 'refused') requestIds.current.delete(row.contactId)
      setResults((m) => ({ ...m, [row.contactId]: r }))
    }
    setBusy(false)
  }

  const sentCount = Object.values(results).filter((r) => r.kind === 'sent').length
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
      <h1 className="mb-1 text-lg font-semibold text-me-charcoal">交给 AI 跟进</h1>
      <p className="mb-4 text-sm text-me-charcoal/70">
        员工打了没接通、或询价 7 天还没人打的客人。点发送后，每位收到一封 2027 目录，挂上「AI 跟进中」，离开「今天先联系」；客人回信、回电或发消息会自动回到员工名单。没点之前，他们一直在员工名单上。
        员工留言写了要发目录的客人排在最前面，默认不勾：看一眼留言，确实要发再勾上。他们只收目录，仍留在员工名单上。
      </p>
      <p className="mb-4 text-sm">
        <a href={`/dashboard/clients/${clientId}/crm/day7-followup`} className="font-semibold text-me-charcoal underline">发了目录满 7 天的客人：写第 7 天跟进信 →</a>
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-me-charcoal/60">正在读名单…</p>}
      {data && data.catalogue === null && <p className="text-sm text-me-charcoal/70">这个客户还没配目录，现在发不了。</p>}
      {data && data.catalogue !== null && (
        <>
          <p className="mb-3 text-[12.5px] text-me-charcoal/60">目录 {data.catalogue.versionLabel}（有效期到 {data.catalogue.validUntil}）· 今天最多 {data.dailyMax} 位，等得最久的先发 · 按下面三组分好了，可以一组一组放行</p>
          {ready.length === 0 ? (
            <div className="rounded-lg border border-me-charcoal/10 bg-white px-4 py-1"><p className="py-3 text-sm text-me-charcoal/60">今天没有要交给 AI 的客人。</p></div>
          ) : RULE_ORDER.map((rule) => (
            <ReadyGroup key={rule} clientId={clientId} rule={rule} rows={ready.filter((r) => r.rule === rule)} ticked={ticked} results={results} busy={busy} onToggle={toggle} onSetAll={setAll} />
          ))}
          {ready.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!confirming ? (
                <button type="button" disabled={busy || chosen.length === 0} onClick={() => setConfirming(true)} className="rounded bg-me-charcoal px-4 py-2 text-sm text-white disabled:opacity-40">
                  给勾选的 {chosen.length} 位发 2027 目录
                </button>
              ) : (
                <div className="rounded border border-me-charcoal/20 bg-white p-3 text-sm">
                  <p>会从客户的公司邮箱给 <b>{chosen.length}</b> 位客人各发一封 2027 目录（{data.catalogue.versionLabel}）。标着「员工留言要目录」的 {chosen.filter((r) => r.keepWithStaff).length} 位只收目录、留在员工名单上；其余发出后挂上「AI 跟进中」。每封发之前都会再查一遍别再联系、每周上限。</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => void sendAll()} className="rounded bg-me-charcoal px-3 py-1.5 text-white">确认发送</button>
                    <button type="button" onClick={() => setConfirming(false)} className="rounded border border-me-charcoal/30 px-3 py-1.5">先不发</button>
                  </div>
                </div>
              )}
              {sentCount > 0 && !busy && <button type="button" onClick={() => {
                // Keep the id of an unknown / half-done send: a retry must be recognised as the same send.
                for (const [id, r] of Object.entries(results)) if (r.kind === 'sent' || r.kind === 'refused') requestIds.current.delete(id)
                setResults({})
                void reload()
              }} className="text-sm text-me-charcoal/70 underline">已发 {sentCount} 位 · 刷新名单</button>}
            </div>
          )}
          <Group title="今天已经联系过，明天再发" rows={data.rows.filter((r) => r.status === 'tomorrow')} clientId={clientId} />
          <Group title="发不了（看原因）" rows={data.rows.filter((r) => r.status === 'cannot_send')} clientId={clientId} />
          <Group title="今天名额满了，排在后面几天" rows={data.rows.filter((r) => r.status === 'queued')} clientId={clientId} />
        </>
      )}
    </div>
  )
}
