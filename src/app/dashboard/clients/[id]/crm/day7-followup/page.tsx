'use client'

/**
 * 第 7 天跟进信 —— 发了 2027 目录满 7 天、没点开、没回话、也没人写过信的「AI 跟进中」客人。
 * AI 按每位客人的情况起草一封短跟进信（现有的「让 AI 写跟进信」，只起草不发），员工在这一页看、改、勾上，
 * 点一次「放行」才逐封走现有的写邮件发送那条路（所有发信检查照跑：7 天 2 封、别再联系、退订…）。
 * 名单：lib/crm/ai-takeover/day7.ts、day7-list.ts。PM 11-09 / 11-14 定：前两周员工点放行，满意后 PM 回「放开」才全自动。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface Row { contactId: string; name: string; day: number; status: 'ready' | 'cannot_send'; recipient: string | null; sentLast7Days: number | null; message: string | null; requestId: string }
type Counts = Record<'due' | 'not_yet' | 'past_30' | 'stopped' | 'clicked' | 'already_written', number>
interface CheckLine { id: string; status: 'pass' | 'warn' | 'fail'; label: string; detail: string }
interface ReadLine { kind: string; text: string }
interface Draft { subject: string; body: string; checks: CheckLine[]; read: ReadLine[]; edited: boolean }
type CardState =
  | { kind: 'empty' } | { kind: 'drafting' } | { kind: 'draft_failed'; message: string }
  | { kind: 'drafted'; draft: Draft; ticked: boolean }
  | { kind: 'sending'; draft: Draft } | { kind: 'sent' }
  | { kind: 'send_failed'; draft: Draft; message: string; unknown: boolean }

const CHECK_ICON: Record<CheckLine['status'], string> = { pass: '✓', warn: '⚠', fail: '✗' }
const CHECK_TONE: Record<CheckLine['status'], string> = { pass: 'text-green-700', warn: 'text-amber-700', fail: 'text-red-700' }

function otherLine(c: Counts): string {
  const parts = [
    c.not_yet > 0 ? `${c.not_yet} 位还没满 7 天` : '',
    c.clicked > 0 ? `${c.clicked} 位点开过目录（已回到「今天要联系」）` : '',
    c.stopped > 0 ? `${c.stopped} 位已经订团、说过别再联系、阶段有了结论、自己回来过或员工聊上了（不再由 AI 写）` : '',
    c.already_written > 0 ? `${c.already_written} 位发目录后已经有人写过信` : '',
    c.past_30 > 0 ? `${c.past_30} 位超过 30 天，AI 不再写信` : '',
  ].filter((p) => p !== '')
  return parts.length === 0 ? '' : `另外：${parts.join('；')}。`
}

async function requestDraft(clientId: string, contactId: string): Promise<{ ok: true; draft: Draft } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/email/compose/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'follow_up' }),
    })
    const json = (await res.json().catch(() => ({}))) as Partial<Draft> & { error?: string }
    if (!res.ok || !json.subject || !json.body) return { ok: false, message: json.error ?? 'AI 起草失败，稍后再试。' }
    return { ok: true, draft: { subject: json.subject, body: json.body, checks: json.checks ?? [], read: json.read ?? [], edited: false } }
  } catch {
    return { ok: false, message: '网络出错，AI 没能起草。' }
  }
}

async function sendOne(clientId: string, row: Row, draft: Draft): Promise<{ ok: true } | { ok: false; message: string; unknown: boolean }> {
  try {
    const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/email/compose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: draft.subject, body: draft.body, requestId: row.requestId, expectedRecipient: row.recipient }),
    })
    if (res.ok) return { ok: true }
    const json = (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
    // 502 / 503 or "the same letter is still being sent": the outcome is not known — never invite a resend.
    const unknown = res.status === 502 || res.status === 503 || json.reason === 'duplicate_unfinished' || json.reason === 'send_unknown'
    return { ok: false, message: json.error ?? '发送失败，稍后再试。', unknown }
  } catch {
    return { ok: false, message: '网络出错，这封有没有发出去还不确定。先别重发，看客人的往来记录。', unknown: true }
  }
}

export default function Day7FollowUpPage({ params }: { params: { id: string } }) {
  const clientId = params.id
  const [rows, setRows] = useState<Row[] | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cards, setCards] = useState<Record<string, CardState>>({})
  // The release loop reads the latest cards, not the ones from when 「放行」 was clicked (魏征 P1-1).
  const cardsRef = useRef<Record<string, CardState>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/ai-pickup/day7`)
      const json = (await res.json().catch(() => ({}))) as { rows?: Row[]; counts?: Counts; error?: string }
      if (!res.ok || !json.rows || !json.counts) throw new Error(json.error ?? '读不到名单')
      setRows(json.rows)
      setCounts(json.counts)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '读不到名单')
    }
  }, [clientId])
  useEffect(() => { void load() }, [load])

  const set = (id: string, s: CardState) => {
    cardsRef.current = { ...cardsRef.current, [id]: s }
    setCards(cardsRef.current)
  }
  const card = (id: string): CardState => cards[id] ?? { kind: 'empty' }
  const latest = (id: string): CardState => cardsRef.current[id] ?? { kind: 'empty' }

  const draftAll = async () => {
    if (!rows || busy) return
    setBusy(true)
    for (const r of rows.filter((x) => x.status === 'ready' && ['empty', 'draft_failed'].includes(latest(x.contactId).kind))) {
      set(r.contactId, { kind: 'drafting' })
      const out = await requestDraft(clientId, r.contactId)
      // Never ticked for staff: each letter is read and ticked by a person (PM 11-09, review P1).
      set(r.contactId, out.ok ? { kind: 'drafted', draft: out.draft, ticked: false } : { kind: 'draft_failed', message: out.message })
    }
    setBusy(false)
  }

  const ticked = (rows ?? []).filter((r) => { const c = card(r.contactId); return c.kind === 'drafted' && c.ticked })

  const releaseTicked = async () => {
    if (busy || ticked.length === 0) return
    if (!window.confirm(`放行 ${ticked.length} 封跟进信，从销售邮箱逐封发给客人。确定吗？`)) return
    setBusy(true)
    for (const r of ticked) {
      const c = latest(r.contactId)
      if (c.kind !== 'drafted' || !c.ticked) continue
      set(r.contactId, { kind: 'sending', draft: c.draft })
      const out = await sendOne(clientId, r, c.draft)
      set(r.contactId, out.ok ? { kind: 'sent' } : { kind: 'send_failed', draft: c.draft, message: out.message, unknown: out.unknown })
    }
    setBusy(false)
  }

  const edit = (id: string, patch: Partial<Draft>) => {
    const c = latest(id)
    if (!busy && c.kind === 'drafted') set(id, { ...c, draft: { ...c.draft, ...patch, edited: true } })
  }
  const toggle = (id: string) => {
    const c = latest(id)
    if (!busy && c.kind === 'drafted') set(id, { ...c, ticked: !c.ticked })
  }
  // A refused letter (not an unknown outcome) can be fixed and ticked again; the request id stays the same.
  const retry = (id: string) => {
    const c = latest(id)
    if (!busy && c.kind === 'send_failed' && !c.unknown) set(id, { kind: 'drafted', draft: c.draft, ticked: false })
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`/dashboard/clients/${clientId}/crm/ai-pickup`} className="text-sm text-me-charcoal/60">← 交给 AI 跟进</Link>
      <h1 className="mt-2 text-2xl font-black text-me-charcoal">第 7 天跟进信</h1>
      <p className="mt-1 text-sm text-me-charcoal/70">
        发了目录满 7 天、没点开、没回话、也没人写过信的客人。AI 按每位客人问过的团写一封短信，你看一眼、要改就改、勾上，点「放行」才会发。
        每封都照常过发信检查（7 天最多 2 封、别再联系、退订）。
      </p>
      {loadError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{loadError} <button className="underline" onClick={() => void load()}>再试一次</button></p>}
      {rows === null && !loadError && <p className="mt-6 text-sm text-me-charcoal/60">正在读名单…</p>}
      {rows !== null && counts !== null && (
        <>
          <p className="mt-4 text-sm font-bold text-me-charcoal">今天该写 {rows.length} 位{rows.some((r) => r.status === 'cannot_send') ? `（其中 ${rows.filter((r) => r.status === 'cannot_send').length} 位发不了）` : ''}。</p>
          <p className="text-xs text-me-charcoal/60">{otherLine(counts)}</p>
          {rows.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => void draftAll()} className="rounded-lg bg-me-charcoal px-3 py-2 text-sm font-bold text-white disabled:opacity-40">✨ 让 AI 把这些信都起草出来</button>
              <button disabled={busy || ticked.length === 0} onClick={() => void releaseTicked()} className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">放行勾上的 {ticked.length} 封</button>
            </div>
          )}
          <ul className="mt-4 space-y-3">
            {rows.map((r) => <Card key={r.contactId} row={r} state={card(r.contactId)} clientId={clientId} locked={busy} onEdit={edit} onToggle={toggle} onRetry={retry} />)}
          </ul>
        </>
      )}
    </div>
  )
}

interface CardProps { row: Row; state: CardState; clientId: string; locked: boolean; onEdit: (id: string, p: Partial<Draft>) => void; onToggle: (id: string) => void; onRetry: (id: string) => void }

function Card({ row, state, clientId, locked, onEdit, onToggle, onRetry }: CardProps) {
  const editable = state.kind === 'drafted' && !locked
  const draft = state.kind === 'drafted' || state.kind === 'sending' || state.kind === 'send_failed' ? state.draft : null
  return (
    <li className="rounded-xl border border-me-charcoal/10 bg-white p-3" data-testid="day7-card">
      <div className="flex items-baseline justify-between gap-2">
        <Link href={`/dashboard/clients/${clientId}/crm/all?view=all&contact=${row.contactId}`} className="font-bold text-me-charcoal">{row.name}</Link>
        <span className="text-xs text-me-charcoal/60">发目录第 {row.day} 天</span>
      </div>
      {row.status === 'cannot_send' && <p className="mt-1 text-xs text-red-700">发不了：{row.message}</p>}
      {row.status === 'ready' && <p className="mt-1 text-xs text-me-charcoal/60">发给 {row.recipient}（近 7 天已收 {row.sentLast7Days ?? 0} 封）</p>}
      {state.kind === 'drafting' && <p className="mt-2 text-sm text-me-charcoal/60">AI 正在写…</p>}
      {state.kind === 'draft_failed' && <p className="mt-2 text-sm text-red-700">{state.message}</p>}
      {state.kind === 'sent' && <p className="mt-2 text-sm font-bold text-green-700">已发出。</p>}
      {state.kind === 'send_failed' && (
        <p className={`mt-2 text-sm ${state.unknown ? 'text-amber-700' : 'text-red-700'}`}>
          {state.message}{state.unknown ? ' 先别重发：看客人的往来记录，明天这一页会按实际情况更新。' : ''}
          {!state.unknown && <button disabled={locked} onClick={() => onRetry(row.contactId)} className="ml-2 underline">改好再发</button>}
        </p>
      )}
      {draft && (
        <div className="mt-2 space-y-2">
          <input aria-label="主题" disabled={!editable} value={draft.subject} onChange={(e) => onEdit(row.contactId, { subject: e.target.value })} className="w-full rounded border border-me-charcoal/20 px-2 py-1 text-sm" />
          <textarea aria-label="正文" disabled={!editable} value={draft.body} onChange={(e) => onEdit(row.contactId, { body: e.target.value })} rows={8} className="w-full rounded border border-me-charcoal/20 px-2 py-1 text-sm" />
          {draft.edited && <p className="text-xs text-amber-700">⚠ 你改过正文，下面的检查还是 AI 原稿的结果；价格、日期、产品名请自己再核一遍。</p>}
          <ul className="text-xs">
            {draft.checks.map((c) => <li key={c.id} className={CHECK_TONE[c.status]}>{CHECK_ICON[c.status]} {c.label}{c.detail ? `：${c.detail}` : ''}</li>)}
          </ul>
          {draft.read.length > 0 && (
            <details className="text-xs text-me-charcoal/60"><summary>AI 读了什么</summary><ul>{draft.read.map((l, i) => <li key={i}>· {l.text}</li>)}</ul></details>
          )}
          {state.kind === 'drafted' && (
            <label className="flex items-center gap-2 text-sm font-bold text-me-charcoal">
              <input type="checkbox" disabled={locked} checked={state.ticked} onChange={() => onToggle(row.contactId)} /> 这封可以发
            </label>
          )}
        </div>
      )}
    </li>
  )
}
