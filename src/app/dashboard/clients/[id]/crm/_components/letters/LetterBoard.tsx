'use client'

/**
 * 一页「AI 起草、人看过勾上、点放行才发」的信：名单、逐封草稿、检查结果、勾选、放行。
 * 「第 7 天跟进信」和「跟进信」两页共用这一块，各自只给名单地址和页面上的说明文字。
 * 草稿走现有的「让 AI 写跟进信」（只起草不发），放行逐封走现有的写邮件发送那条路，所有发信检查照跑。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

/** One guest on a letter board. `note` is the page's own short line about why this guest is here (shown top right). */
export interface LetterBoardRow { contactId: string; name: string; note: string; status: 'ready' | 'cannot_send'; recipient: string | null; sentLast7Days: number | null; message: string | null; requestId: string }
interface CheckLine { id: string; status: 'pass' | 'warn' | 'fail'; label: string; detail: string }
interface ReadLine { kind: string; text: string }
/** `stale` = the person changed the text after the checks ran: the checks no longer describe this text. */
interface Draft { subject: string; body: string; checks: CheckLine[]; read: ReadLine[]; edited: boolean; stale: boolean; rechecking?: boolean; recheckError?: string }
type CardState =
  | { kind: 'empty' } | { kind: 'drafting' } | { kind: 'draft_failed'; message: string }
  | { kind: 'drafted'; draft: Draft; ticked: boolean }
  | { kind: 'sending'; draft: Draft } | { kind: 'sent'; duplicate: boolean }
  | { kind: 'send_failed'; draft: Draft; message: string; unknown: boolean; final: boolean }

const CHECK_ICON: Record<CheckLine['status'], string> = { pass: '✓', warn: '⚠', fail: '✗' }
const CHECK_TONE: Record<CheckLine['status'], string> = { pass: 'text-green-700', warn: 'text-amber-700', fail: 'text-red-700' }


async function requestDraft(clientId: string, contactId: string): Promise<{ ok: true; draft: Draft } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/email/compose/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'follow_up' }),
    })
    const json = (await res.json().catch(() => ({}))) as Partial<Draft> & { error?: string }
    if (!res.ok || !json.subject || !json.body) return { ok: false, message: json.error ?? 'AI 起草失败，稍后再试。' }
    return { ok: true, draft: { subject: json.subject, body: json.body, checks: json.checks ?? [], read: json.read ?? [], edited: false, stale: false } }
  } catch {
    return { ok: false, message: '网络出错，AI 没能起草。' }
  }
}

/** A letter may be ticked only when its checks describe the text as it stands and none of them failed. */
function canTick(d: Draft): boolean {
  return !d.stale && !d.rechecking && !d.checks.some((c) => c.status === 'fail')
}

async function requestChecks(clientId: string, contactId: string, d: Draft): Promise<{ ok: true; checks: CheckLine[] } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/email/compose/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: d.subject, body: d.body }),
    })
    const json = (await res.json().catch(() => ({}))) as { checks?: CheckLine[]; error?: string }
    if (!res.ok || !json.checks) return { ok: false, message: json.error ?? '暂时没法检查，稍后再试。' }
    return { ok: true, checks: json.checks }
  } catch {
    return { ok: false, message: '网络出错，没检查成。' }
  }
}

/** `final` = the refusal is about the guest, not the text: editing and sending again cannot help. */
type SendOutcome = { ok: true; duplicate: boolean } | { ok: false; message: string; unknown: boolean; final: boolean; checks?: CheckLine[] }

async function sendOne(url: string, row: LetterBoardRow, draft: Draft): Promise<SendOutcome> {
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: row.contactId, subject: draft.subject, body: draft.body, requestId: row.requestId, expectedRecipient: row.recipient }),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string; reason?: string; duplicate?: boolean; final?: boolean; checks?: CheckLine[] }
    if (res.ok) return { ok: true, duplicate: json.duplicate === true }
    // 502 / 503 or "the same letter is still being sent": the outcome is not known — never invite a resend.
    const unknown = res.status === 502 || res.status === 503 || json.reason === 'duplicate_unfinished' || json.reason === 'send_unknown'
    return { ok: false, message: json.error ?? '发送失败，稍后再试。', unknown, final: json.final === true, ...(json.checks ? { checks: json.checks } : {}) }
  } catch {
    return { ok: false, message: '网络出错，这封有没有发出去还不确定。先别重发，看客人的往来记录。', unknown: true, final: false }
  }
}

export interface LetterBoardProps {
  clientId: string
  /** GET that returns the list as JSON; `toBoard` turns it into rows and the two summary lines. */
  listUrl: string
  toBoard(json: unknown): { rows: LetterBoardRow[]; headline: string; other: string } | null
  title: string
  intro: string
  back: { href: string; label: string }
  draftAllLabel: string
  /** Where a ticked letter is posted. Default: the compose route of that guest. */
  sendUrl?: (contactId: string) => string
}

export function LetterBoard({ clientId, listUrl, toBoard, title, intro, back, draftAllLabel, sendUrl }: LetterBoardProps) {
  const [rows, setRows] = useState<LetterBoardRow[] | null>(null)
  const [summary, setSummary] = useState<{ headline: string; other: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cards, setCards] = useState<Record<string, CardState>>({})
  // The release loop reads the latest cards, not the ones from when 「放行」 was clicked (魏征 P1-1).
  const cardsRef = useRef<Record<string, CardState>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(listUrl)
      const json: unknown = await res.json().catch(() => ({}))
      const board = res.ok ? toBoard(json) : null
      if (!board) throw new Error((json as { error?: string } | null)?.error ?? '读不到名单')
      setRows(board.rows)
      setSummary({ headline: board.headline, other: board.other })
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '读不到名单')
    }
  }, [listUrl, toBoard])
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
      // Ticked earlier, edited or failed since: never send a text whose checks do not stand.
      if (!canTick(c.draft)) { set(r.contactId, { ...c, ticked: false }); continue }
      const url = sendUrl ? sendUrl(r.contactId) : `/api/clients/${clientId}/crm/contacts/${r.contactId}/email/compose`
      const out = await sendOne(url, r, c.draft)
      // A refusal that comes with fresh checks (the text was checked again at release) shows those checks.
      const failedDraft = out.ok || !out.checks ? c.draft : { ...c.draft, checks: out.checks, stale: false }
      set(r.contactId, out.ok ? { kind: 'sent', duplicate: out.duplicate } : { kind: 'send_failed', draft: failedDraft, message: out.message, unknown: out.unknown, final: out.final })
    }
    setBusy(false)
  }

  const edit = (id: string, patch: Partial<Draft>) => {
    const c = latest(id)
    // An edit unticks the letter and marks its checks stale: they were run on the text before the edit.
    if (!busy && c.kind === 'drafted') set(id, { ...c, ticked: false, draft: { ...c.draft, ...patch, edited: true, stale: true, recheckError: undefined } })
  }
  const toggle = (id: string) => {
    const c = latest(id)
    if (!busy && c.kind === 'drafted' && (c.ticked || canTick(c.draft))) set(id, { ...c, ticked: !c.ticked })
  }
  const recheck = async (id: string) => {
    const c = latest(id)
    if (busy || c.kind !== 'drafted' || c.draft.rechecking) return
    set(id, { ...c, draft: { ...c.draft, rechecking: true, recheckError: undefined } })
    const out = await requestChecks(clientId, id, c.draft)
    const now = latest(id)
    // The person kept typing while the check ran: the answer is for an older text, so the letter stays stale.
    if (now.kind !== 'drafted') return
    const same = now.draft.subject === c.draft.subject && now.draft.body === c.draft.body
    set(id, { ...now, draft: out.ok && same ? { ...now.draft, checks: out.checks, stale: false, rechecking: false } : { ...now.draft, rechecking: false, recheckError: out.ok ? undefined : out.message } })
  }
  // A refused letter (not an unknown outcome) can be fixed and ticked again; the request id stays the same.
  const retry = (id: string) => {
    const c = latest(id)
    if (!busy && c.kind === 'send_failed' && !c.unknown && !c.final) set(id, { kind: 'drafted', draft: c.draft, ticked: false })
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href={back.href} className="text-sm text-me-charcoal/60">← {back.label}</Link>
      <h1 className="mt-2 text-2xl font-black text-me-charcoal">{title}</h1>
      <p className="mt-1 text-sm text-me-charcoal/70">{intro}</p>
      {loadError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{loadError} <button className="underline" onClick={() => void load()}>再试一次</button></p>}
      {rows === null && !loadError && <p className="mt-6 text-sm text-me-charcoal/60">正在读名单…</p>}
      {rows !== null && summary !== null && (
        <>
          <p className="mt-4 text-sm font-bold text-me-charcoal">{summary.headline}</p>
          <p className="text-xs text-me-charcoal/60">{summary.other}</p>
          {rows.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => void draftAll()} className="rounded-lg bg-me-charcoal px-3 py-2 text-sm font-bold text-white disabled:opacity-40">{draftAllLabel}</button>
              <button disabled={busy || ticked.length === 0} onClick={() => void releaseTicked()} className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">放行勾上的 {ticked.length} 封</button>
            </div>
          )}
          <ul className="mt-4 space-y-3">
            {rows.map((r) => <Card key={r.contactId} row={r} state={card(r.contactId)} clientId={clientId} locked={busy} onEdit={edit} onToggle={toggle} onRetry={retry} onRecheck={recheck} />)}
          </ul>
        </>
      )}
    </div>
  )
}

interface CardProps { row: LetterBoardRow; state: CardState; clientId: string; locked: boolean; onEdit: (id: string, p: Partial<Draft>) => void; onToggle: (id: string) => void; onRetry: (id: string) => void; onRecheck: (id: string) => void }

function Card({ row, state, clientId, locked, onEdit, onToggle, onRetry, onRecheck }: CardProps) {
  const editable = state.kind === 'drafted' && !locked
  const draft = state.kind === 'drafted' || state.kind === 'sending' || state.kind === 'send_failed' ? state.draft : null
  return (
    <li className="rounded-xl border border-me-charcoal/10 bg-white p-3" data-testid="letter-card">
      <div className="flex items-baseline justify-between gap-2">
        <Link href={`/dashboard/clients/${clientId}/crm/all?view=all&contact=${row.contactId}`} className="font-bold text-me-charcoal">{row.name}</Link>
        <span className="text-xs text-me-charcoal/60">{row.note}</span>
      </div>
      {row.status === 'cannot_send' && <p className="mt-1 text-xs text-red-700">发不了：{row.message}</p>}
      {row.status === 'ready' && <p className="mt-1 text-xs text-me-charcoal/60">发给 {row.recipient}（近 7 天已收 {row.sentLast7Days ?? 0} 封）</p>}
      {state.kind === 'drafting' && <p className="mt-2 text-sm text-me-charcoal/60">AI 正在写…</p>}
      {state.kind === 'draft_failed' && <p className="mt-2 text-sm text-red-700">{state.message}</p>}
      {state.kind === 'sent' && <p className="mt-2 text-sm font-bold text-green-700">{state.duplicate ? '这封之前已经发出过（可能是同事刚放行的），没有再发第二遍。' : '已发出。'}</p>}
      {state.kind === 'send_failed' && (
        <p className={`mt-2 text-sm ${state.unknown ? 'text-amber-700' : 'text-red-700'}`}>
          {state.message}{state.unknown ? ' 先别重发：看客人的往来记录，明天这一页会按实际情况更新。' : ''}
          {!state.unknown && !state.final && <button disabled={locked} onClick={() => onRetry(row.contactId)} className="ml-2 underline">改好再发</button>}
        </p>
      )}
      {draft && (
        <div className="mt-2 space-y-2">
          <input aria-label="主题" disabled={!editable} value={draft.subject} onChange={(e) => onEdit(row.contactId, { subject: e.target.value })} className="w-full rounded border border-me-charcoal/20 px-2 py-1 text-sm" />
          <textarea aria-label="正文" disabled={!editable} value={draft.body} onChange={(e) => onEdit(row.contactId, { body: e.target.value })} rows={8} className="w-full rounded border border-me-charcoal/20 px-2 py-1 text-sm" />
          {draft.stale && (
            <p className="text-xs text-amber-700">
              ⚠ 你改过这封信，下面的检查是改之前的。
              {state.kind === 'drafted' && <button type="button" disabled={locked || draft.rechecking} onClick={() => onRecheck(row.contactId)} className="ml-1 underline disabled:opacity-40">{draft.rechecking ? '正在检查…' : '重新检查'}</button>}
              {' '}检查过了才能勾。
            </p>
          )}
          {draft.recheckError && <p className="text-xs text-red-700">{draft.recheckError}</p>}
          <ul className="text-xs">
            {draft.checks.map((c) => <li key={c.id} className={CHECK_TONE[c.status]}>{CHECK_ICON[c.status]} {c.label}{c.detail ? `：${c.detail}` : ''}</li>)}
          </ul>
          {draft.read.length > 0 && (
            <details className="text-xs text-me-charcoal/60"><summary>AI 读了什么</summary><ul>{draft.read.map((l, i) => <li key={i}>· {l.text}</li>)}</ul></details>
          )}
          {state.kind === 'drafted' && (
            <>
              <label className={`flex items-center gap-2 text-sm font-bold ${canTick(draft) ? 'text-me-charcoal' : 'text-me-charcoal/60'}`}>
                <input type="checkbox" disabled={locked || !canTick(draft)} checked={state.ticked} onChange={() => onToggle(row.contactId)} /> 这封可以发
              </label>
              {!draft.stale && draft.checks.some((c) => c.status === 'fail') && <p className="text-xs text-red-700">有检查没过（✗），改好并重新检查后才能勾。</p>}
            </>
          )}
        </div>
      )}
    </li>
  )
}
