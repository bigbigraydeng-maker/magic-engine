'use client'

import { useEffect, useState } from 'react'
import { toCardPayload } from '@/app/dashboard/clients/[id]/confirmation-cards/card-list'
import { ConfirmationCard } from '@/components/confirmation-card/ConfirmationCard'

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

function issueUrl(clientId: string): string {
  return `/api/clients/${encodeURIComponent(clientId)}/go-live-cards`
}

function decisionUrl(clientId: string, draftId: string): string {
  return `/api/clients/${encodeURIComponent(clientId)}/go-live-cards/${encodeURIComponent(draftId)}/decision`
}

async function readError(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null)
  if (body && typeof body === 'object' && 'error' in body) {
    const message = (body as { error: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return '没有点成。请刷新后再看。'
}

function readBody(value: unknown): { card: CardPayload; resultLine: string } | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { card?: unknown; resultLine?: unknown }
  const card = toCardPayload(row.card)
  if (!card || typeof row.resultLine !== 'string') return null
  return { card, resultLine: row.resultLine }
}

export function GoLiveCardPanel({ clientId, draftId }: { clientId: string; draftId: string }) {
  const [view, setView] = useState<CardPayload | null>(null)
  const [resultLine, setResultLine] = useState('正在读取开投确认卡。')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await fetch(issueUrl(clientId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId }),
      })
      if (!alive) return
      if (!res.ok) {
        setProblem(await readError(res))
        return
      }
      const parsed = readBody(await res.json().catch(() => null))
      if (!parsed) {
        setProblem('确认卡读不出来。请刷新后再看。')
        return
      }
      setView(parsed.card)
      setResultLine(parsed.resultLine)
    })()
    return () => { alive = false }
  }, [clientId, draftId])

  async function send(resolution: 'confirm' | 'decline') {
    if (!view) return
    setBusy(true)
    setProblem(null)
    const res = await fetch(decisionUrl(clientId, draftId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resolution,
        expectedDecisionId: view.expectedDecisionId,
        fingerprint: view.fingerprint,
        runId: view.runId,
      }),
    })
    if (!res.ok) setProblem(await readError(res))
    else {
      const parsed = readBody(await res.json().catch(() => null))
      if (!parsed) setProblem('确认卡读不出来。请刷新后再看。')
      else {
        setView(parsed.card)
        setResultLine(parsed.resultLine)
      }
    }
    setBusy(false)
  }

  if (problem && !view) return <p className="mt-4 text-base text-red-700">{problem}</p>
  if (!view) return <p className="mt-4 text-base text-neutral-600">{resultLine}</p>
  return (
    <div className="mt-4">
      <ConfirmationCard
        what={view.what}
        account={view.account}
        amount={view.amount}
        date={view.date}
        scope={view.scope}
        expiresLabel={view.expiresLabel}
        statusLine={resultLine}
        confirmEnabled={view.confirmEnabled}
        declineEnabled={view.declineEnabled}
        blockedReason={view.blockedReason}
        busy={busy}
        onConfirm={() => { void send('confirm') }}
        onDecline={() => { void send('decline') }}
      />
      {problem ? <p className="mt-2 text-base text-red-700">{problem}</p> : null}
    </div>
  )
}
