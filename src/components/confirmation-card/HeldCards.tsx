'use client'

import { useEffect, useState } from 'react'
import {
  GO_LIVE_CONFIRM_HREF,
  GO_LIVE_CONFIRM_LABEL,
  pausedDraftClickUrl,
} from '@/lib/ads-strategy/paused-draft-copy'
import { ConfirmationCard } from './ConfirmationCard'
import { ConfirmationCardDialog } from './ConfirmationCardDialog'

interface CardPayload {
  readonly runId: string
  readonly expectedDecisionId: string
  readonly fingerprint: string
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly date: string
  readonly scope: string
  readonly expiresLabel: string
  readonly statusLine: string
  readonly confirmEnabled: boolean
  readonly declineEnabled: boolean
  readonly blockedReason: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function toCardPayload(value: unknown): CardPayload | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const what = text(row.what)
  const account = text(row.account)
  const amount = text(row.amount)
  const date = text(row.date)
  const scope = text(row.scope)
  const expiresLabel = text(row.expiresLabel)
  const statusLine = text(row.statusLine)
  const runId = text(row.runId)
  const expectedDecisionId = text(row.expectedDecisionId)
  const fingerprint = text(row.fingerprint)
  if (!what || !account || !amount || !date || !scope || !expiresLabel || !statusLine) return null
  if (!runId || !expectedDecisionId || !fingerprint) return null
  if (typeof row.confirmEnabled !== 'boolean' || typeof row.declineEnabled !== 'boolean') return null
  if (row.blockedReason !== null && typeof row.blockedReason !== 'string') return null
  return {
    runId,
    expectedDecisionId,
    fingerprint,
    what,
    account,
    amount,
    date,
    scope,
    expiresLabel,
    statusLine,
    confirmEnabled: row.confirmEnabled,
    declineEnabled: row.declineEnabled,
    blockedReason: row.blockedReason,
  }
}

function readList(value: unknown): CardPayload[] {
  if (!value || typeof value !== 'object' || !('cards' in value)) return []
  const cards = (value as { cards: unknown }).cards
  if (!Array.isArray(cards)) return []
  return cards.map(toCardPayload).filter((card): card is CardPayload => card !== null)
}

async function readMessage(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null)
  if (body && typeof body === 'object' && 'error' in body) {
    const message = (body as { error: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return '没有点成。请刷新后再看。'
}

async function postDecision(
  clientId: string,
  view: CardPayload,
  resolution: 'confirm' | 'decline',
): Promise<CardPayload | string> {
  const res = await fetch(pausedDraftClickUrl(clientId, view.runId, view.what), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resolution,
      expectedDecisionId: view.expectedDecisionId,
      fingerprint: view.fingerprint,
    }),
  })
  if (!res.ok) return readMessage(res)
  return toCardPayload(await res.json().catch(() => null)) ?? view
}

function CardRow({
  clientId,
  card,
  layout,
}: {
  clientId: string
  card: CardPayload
  layout: 'default' | 'ads-health'
}) {
  const [view, setView] = useState(card)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const clickUrl = pausedDraftClickUrl(clientId, view.runId, view.what)
  const goLive = clickUrl === GO_LIVE_CONFIRM_HREF
  const useDialog = layout === 'ads-health' && !goLive

  async function send(resolution: 'confirm' | 'decline') {
    if (goLive) return
    setBusy(true)
    setNote(null)
    const result = await postDecision(clientId, view, resolution)
    if (typeof result === 'string') setNote(result)
    else setView(result)
    setBusy(false)
    setDialogOpen(false)
  }

  return (
    <div className="mt-4 md:max-w-[calc(50%-0.5rem)] md:min-w-[min(100%,20rem)]">
      <ConfirmationCard
        layout={layout}
        what={view.what}
        account={view.account}
        amount={view.amount}
        date={view.date}
        scope={view.scope}
        expiresLabel={view.expiresLabel}
        statusLine={view.statusLine}
        confirmEnabled={goLive ? false : view.confirmEnabled}
        declineEnabled={goLive ? false : view.declineEnabled}
        blockedReason={view.blockedReason}
        busy={busy}
        onConfirm={() => {
          if (useDialog) setDialogOpen(true)
          else void send('confirm')
        }}
        onDecline={() => { void send('decline') }}
      />
      {useDialog && (
        <ConfirmationCardDialog
          open={dialogOpen}
          what={view.what}
          account={view.account}
          amount={view.amount}
          date={view.date}
          scope={view.scope}
          expiresLabel={view.expiresLabel}
          statusLine={view.statusLine}
          confirmEnabled={view.confirmEnabled}
          blockedReason={view.blockedReason}
          busy={busy}
          onClose={() => setDialogOpen(false)}
          onConfirm={() => { void send('confirm') }}
        />
      )}
      {goLive ? (
        <p className="mt-2 text-base">
          <a className="font-medium text-me-ochre underline hover:text-me-charcoal" href={GO_LIVE_CONFIRM_HREF}>{GO_LIVE_CONFIRM_LABEL}</a>
        </p>
      ) : null}
      {note ? <p className="mt-2 text-sm text-status-rej">{note}</p> : null}
    </div>
  )
}

export function HeldCards({
  clientId,
  refreshKey = 0,
  hideWhenEmpty = false,
  layout = 'default',
  onCountChange,
}: {
  clientId: string
  refreshKey?: number
  hideWhenEmpty?: boolean
  layout?: 'default' | 'ads-health'
  onCountChange?: (count: number) => void
}) {
  const [cards, setCards] = useState<CardPayload[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/confirmation-cards`, {
        cache: 'no-store',
      })
      if (!alive) return
      if (!res.ok) {
        setProblem(await readMessage(res))
        setCards([])
        return
      }
      setProblem(null)
      const list = readList(await res.json().catch(() => null))
      setCards(list)
      onCountChange?.(list.length)
    })()
    return () => { alive = false }
  }, [clientId, refreshKey, onCountChange])

  if (problem) return <p className="mt-4 text-sm text-status-rej">{problem}</p>
  if (!cards || cards.length === 0) {
    if (hideWhenEmpty) return null
    if (!cards) return <p className="mt-4 text-sm text-me-charcoal/55">正在读取确认卡…</p>
    return <p className="mt-4 text-sm text-me-charcoal/55">现在没有要你点的确认卡。</p>
  }
  return (
    <div className="mt-4 flex flex-col gap-4 md:flex-row md:flex-wrap">
      {cards.map((card) => <CardRow key={card.runId} clientId={clientId} card={card} layout={layout} />)}
    </div>
  )
}
