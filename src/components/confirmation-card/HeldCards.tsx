'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  GO_LIVE_CONFIRM_HREF,
  GO_LIVE_CONFIRM_LABEL,
  pausedDraftClickUrl,
} from '@/lib/ads-strategy/paused-draft-copy'
import type { CardStatus } from '@/lib/confirmation-card/view'
import { ConfirmationCard } from './ConfirmationCard'
import { STATUS_CHIP_LABEL, isMutedStatus } from './card-display'

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
  readonly status: CardStatus
  readonly confirmEnabled: boolean
  readonly declineEnabled: boolean
  readonly blockedReason: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readStatus(value: unknown): CardStatus {
  if (value === 'waiting' || value === 'confirmed' || value === 'declined' || value === 'expired' || value === 'voided') {
    return value
  }
  return 'waiting'
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
    status: readStatus(row.status),
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

function CardRow({ clientId, card }: { clientId: string; card: CardPayload }) {
  const [view, setView] = useState(card)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const clickUrl = pausedDraftClickUrl(clientId, view.runId, view.what)
  const goLive = clickUrl === GO_LIVE_CONFIRM_HREF

  async function send(resolution: 'confirm' | 'decline') {
    if (goLive) return
    setBusy(true)
    setNote(null)
    const result = await postDecision(clientId, view, resolution)
    if (typeof result === 'string') setNote(result)
    else setView(result)
    setBusy(false)
  }

  return (
    <div className="mt-4">
      <ConfirmationCard
        what={view.what}
        account={view.account}
        amount={view.amount}
        date={view.date}
        scope={view.scope}
        expiresLabel={view.expiresLabel}
        statusLine={view.statusLine}
        status={view.status}
        confirmEnabled={goLive ? false : view.confirmEnabled}
        declineEnabled={goLive ? false : view.declineEnabled}
        blockedReason={view.blockedReason}
        busy={busy}
        muted={isMutedStatus(view.status)}
        goLiveHref={goLive ? GO_LIVE_CONFIRM_HREF : undefined}
        goLiveLabel={goLive ? GO_LIVE_CONFIRM_LABEL : undefined}
        onConfirm={() => { void send('confirm') }}
        onDecline={() => { void send('decline') }}
      />
      {note ? <p className="mt-2 text-base text-red-700">{note}</p> : null}
    </div>
  )
}

function StatusChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-me-charcoal px-3.5 py-1.5 text-sm font-semibold text-white'
          : 'rounded-full border border-black/15 bg-white px-3.5 py-1.5 text-sm font-medium text-me-charcoal hover:bg-black/[0.03]'
      }
    >
      {label}
      {count > 0 ? ` ${count}` : ''}
    </button>
  )
}

function RecentRow({ card }: { card: CardPayload }) {
  const chip = STATUS_CHIP_LABEL[card.status]
  const chipClass =
    card.status === 'confirmed'
      ? 'bg-sky-100 text-sky-900'
      : card.status === 'declined'
        ? 'bg-me-charcoal/10 text-me-charcoal/70'
        : 'bg-me-charcoal/5 text-me-charcoal/60'

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-black/5 py-3 text-sm last:border-0">
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${chipClass}`}>{chip}</span>
      <span className="min-w-0 flex-1 font-medium text-me-charcoal">{card.what}</span>
      <span className="shrink-0 text-xs text-me-charcoal/45">{card.statusLine}</span>
    </div>
  )
}

const FILTER_STATUSES: CardStatus[] = ['waiting', 'confirmed', 'declined', 'expired', 'voided']

export function HeldCards({
  clientId,
  refreshKey = 0,
  hideWhenEmpty = false,
}: {
  clientId: string
  refreshKey?: number
  hideWhenEmpty?: boolean
}) {
  const [cards, setCards] = useState<CardPayload[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [filter, setFilter] = useState<CardStatus>('waiting')

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
      setCards(readList(await res.json().catch(() => null)))
    })()
    return () => { alive = false }
  }, [clientId, refreshKey])

  const counts = useMemo(() => {
    const tally: Record<CardStatus, number> = {
      waiting: 0,
      confirmed: 0,
      declined: 0,
      expired: 0,
      voided: 0,
    }
    for (const card of cards ?? []) tally[card.status] += 1
    return tally
  }, [cards])

  const processedCount = counts.confirmed + counts.declined + counts.expired + counts.voided

  const primaryCards = useMemo(() => {
    if (!cards) return []
    return cards.filter((c) => c.status === filter)
  }, [cards, filter])

  const deadCards = useMemo(() => {
    if (!cards || filter !== 'waiting') return []
    return cards.filter((c) => c.status === 'expired' || c.status === 'voided')
  }, [cards, filter])

  const recentCards = useMemo(() => {
    if (!cards) return []
    return cards.filter((c) => c.status === 'confirmed' || c.status === 'declined').slice(0, 8)
  }, [cards])

  if (problem) return <p className="mt-6 text-base text-red-700">{problem}</p>
  if (!cards || cards.length === 0) {
    if (hideWhenEmpty) return null
    if (!cards) return <p className="mt-6 text-base text-me-charcoal/70">正在读取确认卡。</p>
    return <p className="mt-6 text-base text-me-charcoal/80">现在没有要你点的确认卡。</p>
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-me-charcoal/70">
          待确认 {counts.waiting} 张 · 已处理 {processedCount} 张
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTER_STATUSES.map((status) => (
          <StatusChip
            key={status}
            label={STATUS_CHIP_LABEL[status]}
            count={counts[status]}
            active={filter === status}
            onClick={() => setFilter(status)}
          />
        ))}
      </div>

      <div className="mt-6 space-y-0">
        {primaryCards.length === 0 ? (
          <p className="text-sm text-me-charcoal/60">这一类现在没有卡。</p>
        ) : (
          primaryCards.map((card) => <CardRow key={card.runId} clientId={clientId} card={card} />)
        )}
      </div>

      {deadCards.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-bold text-me-charcoal/70">过期和作废的卡</h2>
          {deadCards.map((card) => <CardRow key={card.runId} clientId={clientId} card={card} />)}
        </section>
      ) : null}

      {recentCards.length > 0 ? (
        <section className="mt-10 rounded-2xl border border-black/10 bg-white/60 p-4">
          <h2 className="text-sm font-bold text-me-charcoal/70">最近处理过的</h2>
          <div className="mt-2">
            {recentCards.map((card) => <RecentRow key={card.runId} card={card} />)}
          </div>
        </section>
      ) : null}
    </div>
  )
}
