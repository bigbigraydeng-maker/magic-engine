'use client'

/**
 * 抽屉里「📘 目录」那一块 + 「AI 跟进中 / 收回人工」（Figma 一键发 2027 目录 ①–⑧）。
 *
 * - 点「先看一眼信，再发送」→ 先把整封信给员工看（同一个预览接口），点「确认发送」才真发。
 * - 发出 → 服务端才挂「AI 跟进中」；被挡 → 直接写原因（原因全来自服务端，不在这里另编）。
 * - 发没发出去不确定 → 「先别重发」，什么都不挂。
 * - 「收回人工」只有员工点才收回。阶段一律不动。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface View {
  takeover: { on: true; since: string; actor: string } | { on: false; offAt: string | null; actor: string | null }
  cameBack: { kind: string; at: string } | null
  catalogue: { templateKey: string; versionLabel: string; validUntil: string } | null
  compose:
    | { canCompose: true; recipient: string; mailbox: string; sentToContactLast7Days: number }
    | { canCompose: false; message: string }
}

interface Letter { subject: string; body: string }

type Phase =
  | { kind: 'idle' }
  | { kind: 'previewing' }
  | { kind: 'confirm'; letter: Letter }
  | { kind: 'sending' }
  | { kind: 'refused'; message: string }
  | { kind: 'unknown'; message: string }

const UNKNOWN = '这封有没有发出去还不确定。请一分钟后看下面的往来记录，先别重发。'

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** A reply we do not recognise is treated as "could not read", never half-rendered. */
function isView(v: unknown): v is View {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const t = o.takeover as Record<string, unknown> | undefined
  const c = o.compose as Record<string, unknown> | undefined
  return typeof t?.on === 'boolean' && typeof c?.canCompose === 'boolean' && 'catalogue' in o && 'cameBack' in o
}

function useTakeoverView(base: string) {
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/ai-takeover`)
      if (!res.ok) throw new Error(String(res.status))
      const json: unknown = await res.json()
      if (!isView(json)) throw new Error('unexpected shape')
      setView(json)
      setError(null)
    } catch {
      setError('暂时读不到目录和跟进状态，请稍后再试。')
    }
  }, [base])
  useEffect(() => {
    setView(null)
    void load()
  }, [load])
  return { view, error, reload: load }
}

async function postJson(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? v : fallback)

export function CatalogueTakeoverPanel({
  clientId,
  contactId,
  name,
  onSaved,
}: {
  clientId: string
  contactId: string
  name: string
  onSaved: (msg: string, reload?: boolean) => void
}) {
  const base = `/api/clients/${clientId}/crm/contacts/${contactId}`
  const { view, error, reload } = useTakeoverView(base)
  if (error) return <p className="text-[12.5px] text-me-charcoal/50">{error}</p>
  if (!view) return null
  if (view.takeover.on) {
    return <TakeoverOn base={base} view={view} since={view.takeover.since} actor={view.takeover.actor} name={name} onSaved={onSaved} reload={reload} />
  }
  return <CatalogueCard base={base} view={view} name={name} onSaved={onSaved} reload={reload} />
}

function TakeoverOn({ base, view, since, actor, name, onSaved, reload }: {
  base: string; view: View; since: string; actor: string; name: string
  onSaved: (msg: string, reload?: boolean) => void; reload: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const refRef = useRef(globalThis.crypto.randomUUID())
  const takeBack = async () => {
    setBusy(true)
    try {
      const { status, json } = await postJson(`${base}/ai-takeover-off`, { clientRef: refRef.current })
      if (status !== 200) throw new Error(str(json.message, str(json.error, '没改上，再点一下试试')))
      onSaved(`✓ 已收回人工 —— 系统不再自动跟进 ${name}，接下来由你跟`, true)
      await reload()
    } catch (err) {
      onSaved(err instanceof Error ? err.message : '没改上，再点一下试试', false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-testid="takeover-on" className="w-full rounded-lg border border-me-charcoal/10 bg-white px-3 py-2.5">
      <p className="text-[13px] text-me-charcoal">
        系统在跟进这位客人。{when(since)} 交给 AI 跟进（{actor} 点的）。客人一回信、填表或来电，系统就停手，他会回到「今天要联系」。
      </p>
      {view.cameBack && (
        <p className="mt-1.5 text-[13px] font-bold text-[#C2453A]">客人回来了（{when(view.cameBack.at)}）—— 请你接手跟他联系。</p>
      )}
      <button
        type="button"
        onClick={() => void takeBack()}
        disabled={busy}
        className="mt-2 w-full rounded-lg border border-me-charcoal/20 bg-white px-3 py-2 text-[13px] font-bold text-me-charcoal disabled:opacity-50"
      >
        {busy ? '改着…' : '收回人工'}
      </button>
      <p className="mt-1 text-[12px] text-me-charcoal/50">只有员工手动点这里才收回。收回后系统不再自动跟进他，小标消失。</p>
    </div>
  )
}

function CatalogueCard({ base, view, name, onSaved, reload }: {
  base: string; view: View; name: string
  onSaved: (msg: string, reload?: boolean) => void; reload: () => Promise<void>
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // 一次「确认发送」一个编号；被挡（肯定没发）才换新的，结果不明或只改了一半就沿用同一个，重点不会重发。
  const requestRef = useRef(globalThis.crypto.randomUUID())
  const { catalogue, compose } = view
  const blocked = catalogue === null ? '这个客户还没配目录，现在发不了。' : compose.canCompose ? null : compose.message
  const recipient = compose.canCompose ? compose.recipient : null

  const openPreview = async () => {
    if (!catalogue) return
    setPhase({ kind: 'previewing' })
    const { status, json } = await postJson(`${base}/email/template-preview`, { key: catalogue.templateKey })
    const rendered = json.rendered as { subject?: unknown; body?: unknown } | undefined
    if (status !== 200 || !rendered) return setPhase({ kind: 'refused', message: str(json.error, '信暂时生成不了，请稍后再试。') })
    setPhase({ kind: 'confirm', letter: { subject: str(rendered.subject, ''), body: str(rendered.body, '') } })
  }

  const send = async () => {
    if (!recipient) return
    setPhase({ kind: 'sending' })
    try {
      const { status, json } = await postJson(`${base}/catalogue-send`, { requestId: requestRef.current, expectedRecipient: recipient })
      if (status === 200 && json.ok === true) {
        onSaved(`✓ 目录已发出给 ${name}，已交给 AI 跟进`, true)
        return void reload()
      }
      if (json.sent === false) requestRef.current = globalThis.crypto.randomUUID()
      setPhase({ kind: json.sent === false ? 'refused' : 'unknown', message: str(json.message, UNKNOWN) })
    } catch {
      setPhase({ kind: 'unknown', message: UNKNOWN })
    }
  }

  return (
    <div data-testid="catalogue-card" className="w-full rounded-lg border border-me-charcoal/10 bg-white px-3 py-2.5">
      <CardHead phase={phase} blocked={blocked !== null} />
      <CardFacts view={view} />
      <CardBody phase={phase} blocked={blocked} recipient={recipient} mailbox={compose.canCompose ? compose.mailbox : null}
        onPreview={() => void openPreview()} onSend={() => void send()} onCancel={() => setPhase({ kind: 'idle' })} />
    </div>
  )
}

function CardHead({ phase, blocked }: { phase: Phase; blocked: boolean }) {
  const chip =
    phase.kind === 'sending' ? '发送中'
      : phase.kind === 'unknown' ? '确认中'
        : phase.kind === 'refused' || blocked ? '现在不能发'
          : '可以发'
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-[14px] font-black text-me-charcoal">📘 目录</h3>
      <span className="rounded-full bg-me-charcoal/[0.06] px-2 py-0.5 text-[11px] font-bold text-me-charcoal/60">{chip}</span>
    </div>
  )
}

function CardFacts({ view }: { view: View }) {
  const rows: Array<[string, string]> = []
  if (view.catalogue) rows.push(['手册', `${view.catalogue.versionLabel} · 有效期到 ${view.catalogue.validUntil}`])
  if (view.compose.canCompose) {
    rows.push(['发给', view.compose.recipient])
    rows.push(['本周', `已收 ${view.compose.sentToContactLast7Days} 封 / 每人每周最多 2 封（这封也算）`])
  }
  if (rows.length === 0) return null
  return (
    <dl className="mt-2 grid grid-cols-[72px_1fr] gap-y-1 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-me-charcoal/50">{k}</dt>
          <dd className="break-all text-me-charcoal">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function CardBody({ phase, blocked, recipient, mailbox, onPreview, onSend, onCancel }: {
  phase: Phase; blocked: string | null; recipient: string | null; mailbox: string | null
  onPreview: () => void; onSend: () => void; onCancel: () => void
}) {
  if (phase.kind === 'confirm') {
    return <ConfirmLetter letter={phase.letter} recipient={recipient} mailbox={mailbox} onSend={onSend} onCancel={onCancel} />
  }
  if (phase.kind === 'sending') {
    return <p className="mt-2 text-[12.5px] text-me-charcoal/60">正在发送… 按钮在这几秒里点不动，避免点两次。就算关了窗口，也不会重复发。</p>
  }
  const note = phase.kind === 'refused' || phase.kind === 'unknown' ? phase.message : blocked
  return (
    <>
      {note && <p className="mt-2 rounded-md bg-me-ochre/10 px-2.5 py-2 text-[12.5px] text-me-charcoal">{note}</p>}
      <button
        type="button"
        onClick={onPreview}
        disabled={blocked !== null || phase.kind === 'previewing' || phase.kind === 'unknown'}
        className="mt-2 w-full rounded-lg bg-me-charcoal px-3 py-2 text-[13px] font-bold text-white disabled:opacity-40"
      >
        {phase.kind === 'previewing' ? '生成信件中…' : '先看一眼信，再发送'}
      </button>
      <p className="mt-1 text-[12px] text-me-charcoal/50">点了先弹出整封信给你看，确认后才会真的发出。</p>
    </>
  )
}

function ConfirmLetter({ letter, recipient, mailbox, onSend, onCancel }: {
  letter: Letter; recipient: string | null; mailbox: string | null; onSend: () => void; onCancel: () => void
}) {
  return (
    <div className="mt-2" data-testid="catalogue-confirm">
      <p className="text-[12.5px] text-me-charcoal/70">收件人：{recipient ?? '—'}　发件邮箱：{mailbox ?? '—'}</p>
      <div className="mt-1.5 max-h-72 overflow-y-auto rounded-md border border-me-charcoal/10 bg-me-ivory px-3 py-2">
        <p className="text-[13px] font-bold text-me-charcoal">{letter.subject}</p>
        <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-me-charcoal/90">{letter.body}</p>
      </div>
      <p className="mt-1.5 text-[12px] text-me-charcoal/50">信的末尾会自动加上发信设置里的页脚。手册链接和收件地址在点「确认发送」那一刻会再核一遍，变了就不发。</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-me-charcoal/20 px-3 py-2 text-[13px] font-bold text-me-charcoal">取消</button>
        <button type="button" onClick={onSend} className="rounded-lg bg-me-charcoal px-3 py-2 text-[13px] font-bold text-white">确认发送</button>
      </div>
    </div>
  )
}
