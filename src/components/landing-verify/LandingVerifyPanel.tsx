'use client'

import { useEffect, useRef, useState } from 'react'
import { toCardPayload } from '@/app/dashboard/clients/[id]/confirmation-cards/card-list'
import { ConfirmationCard } from '@/components/confirmation-card/ConfirmationCard'
import { pausedDraftClickUrl } from '@/lib/ads-strategy/paused-draft-copy'

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

interface View {
  readonly lines: readonly string[]
  readonly headline: string
  readonly card: CardPayload | null
}

function readView(value: unknown): View | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { lines?: unknown; headline?: unknown; card?: unknown }
  if (typeof row.headline !== 'string' || !Array.isArray(row.lines)) return null
  const lines = row.lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
  if (lines.length !== row.lines.length) return null
  if (row.card == null) return { lines, headline: row.headline, card: null }
  const card = toCardPayload(row.card)
  return card ? { lines, headline: row.headline, card } : null
}

async function readError(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null)
  if (body && typeof body === 'object' && 'error' in body) {
    const message = (body as { error: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return '落地页没有查成。请再试一次。'
}

async function postCheck(clientId: string, draftId: string, again: boolean): Promise<View> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/landing-verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draftId, again }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const parsed = readView(await res.json().catch(() => null))
  if (!parsed) throw new Error('核实结果读不出来。请再试一次。')
  return parsed
}

function ResultList({ view }: { view: View }) {
  return (
    <>
      <p className="mt-3 text-base font-medium text-neutral-900">{view.headline}</p>
      {view.lines.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base text-neutral-800">
          {view.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
    </>
  )
}

function VerifyCard({
  view,
  busy,
  onDecide,
}: {
  view: View
  busy: boolean
  onDecide: (resolution: 'confirm' | 'decline') => void
}) {
  if (!view.card) return null
  const card = view.card
  return (
    <div className="mt-3">
      <ConfirmationCard
        what={card.what}
        account={card.account}
        amount={card.amount}
        date={card.date}
        scope={card.scope}
        expiresLabel={card.expiresLabel}
        statusLine={card.statusLine}
        confirmEnabled={card.confirmEnabled}
        declineEnabled={card.declineEnabled}
        blockedReason={card.blockedReason}
        busy={busy}
        onConfirm={() => onDecide('confirm')}
        onDecline={() => onDecide('decline')}
      />
    </div>
  )
}

interface Actions {
  readonly setView: (view: View | null) => void
  readonly setProblem: (problem: string | null) => void
  readonly setBusy: (busy: boolean) => void
  readonly settled: () => void
  readonly changed: () => void
}

async function check(clientId: string, draftId: string, again: boolean, first: boolean, actions: Actions) {
  actions.setBusy(true)
  actions.setProblem(null)
  try {
    actions.setView(await postCheck(clientId, draftId, again))
  } catch (error) {
    actions.setProblem(error instanceof Error ? error.message : '落地页没有查成。请再试一次。')
  }
  actions.setBusy(false)
  if (first) actions.settled()
  else actions.changed()
}

async function decide(
  clientId: string,
  view: View,
  resolution: 'confirm' | 'decline',
  actions: Actions,
) {
  if (!view.card) return
  actions.setBusy(true)
  actions.setProblem(null)
  const res = await fetch(pausedDraftClickUrl(clientId, view.card.runId, view.card.what), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resolution,
      expectedDecisionId: view.card.expectedDecisionId,
      fingerprint: view.card.fingerprint,
    }),
  })
  if (!res.ok) actions.setProblem(await readError(res))
  else {
    const card = toCardPayload(await res.json().catch(() => null))
    if (!card) actions.setProblem('确认结果读不出来。请刷新后再看。')
    else actions.setView({ ...view, card, headline: resolution === 'confirm' ? '已记下你的确认。' : '已记下你不做。' })
  }
  actions.setBusy(false)
  actions.changed()
}

export function LandingVerifyPanel({
  clientId,
  draftId,
  onSettled,
  onChanged,
}: {
  clientId: string
  draftId: string
  onSettled: () => void
  onChanged: () => void
}) {
  const [view, setView] = useState<View | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const settled = useRef(onSettled)
  const changed = useRef(onChanged)
  settled.current = onSettled
  changed.current = onChanged
  const actionsRef = useRef<Actions>({
    setView,
    setProblem,
    setBusy,
    settled: () => settled.current(),
    changed: () => changed.current(),
  })
  actionsRef.current = {
    setView,
    setProblem,
    setBusy,
    settled: () => settled.current(),
    changed: () => changed.current(),
  }

  useEffect(() => {
    void check(clientId, draftId, false, true, actionsRef.current)
  }, [clientId, draftId])

  return (
    <PanelBody
      problem={problem}
      view={view}
      busy={busy}
      onAgain={() => { void check(clientId, draftId, true, false, actionsRef.current) }}
      onDecide={(resolution) => { if (view) void decide(clientId, view, resolution, actionsRef.current) }}
    />
  )
}

function PanelBody(props: {
  problem: string | null
  view: View | null
  busy: boolean
  onAgain: () => void
  onDecide: (resolution: 'confirm' | 'decline') => void
}) {
  return (
    <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
      <h3 className="text-lg font-medium text-neutral-900">落地页已核实</h3>
      <p className="mt-2 text-base text-neutral-700">
        系统先看广告要点进去的地方：打不打得开、是不是这一页、表单里有没有姓名和联系方式、追踪参数还在不在。
        查不了的，请你点确认。没通过又没有人确认，开投按不下去。这一步不花钱。
      </p>
      {props.problem ? <p className="mt-3 text-base text-red-700">{props.problem}</p> : null}
      {!props.view && !props.problem ? <p className="mt-3 text-base text-neutral-700">正在查落地页或表单。</p> : null}
      {props.view ? <ResultList view={props.view} /> : null}
      {props.view ? <VerifyCard view={props.view} busy={props.busy} onDecide={props.onDecide} /> : null}
      <button
        type="button"
        disabled={props.busy}
        onClick={props.onAgain}
        className="mt-3 rounded-lg border border-neutral-300 px-4 py-2 text-base text-neutral-900 disabled:bg-neutral-100 disabled:text-neutral-400"
      >
        再查一次
      </button>
    </section>
  )
}
