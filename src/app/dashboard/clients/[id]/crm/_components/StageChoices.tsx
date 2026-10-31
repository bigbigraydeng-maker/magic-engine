'use client'

/**
 * Stage buttons inside the guest drawer.
 * The amount panel opens for the saved deal stage. When none is saved, only
 * the stage key won opens it. A marketing action named won does not. No
 * client id is special-cased.
 * Buttons stay disabled until that setting has loaded, so a slow or failed
 * read cannot become a plain stage change with no deal record.
 */

import { useEffect, useState } from 'react'
import { stageCountsAsDeal } from '@/lib/conversions/crm-deal-stage'
import { MarkWonPanel } from './MarkWonPanel'

interface StageChoice {
  stageKey: string
  label: string
  marketingAction?: string
}

type DealStageLoad =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; key: string | null }

export function StageChoices(props: {
  clientId: string
  contactId: string
  stages: StageChoice[]
  restCount: number
  onShowRest: () => void
  onPlainStage: (stageKey: string, label: string) => void
  onSaved: (msg: string, reload?: boolean) => void
}) {
  const gate = useDealStageLoad(props.clientId)
  const [won, setWon] = useState<StageChoice | null>(null)
  const ready = gate.status === 'ready'

  return (
    <div>
      <StageGateNote gate={gate} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {props.stages.map((s) => (
          <button
            key={s.stageKey}
            type="button"
            disabled={!ready}
            onClick={() => chooseStage(s, ready ? gate.key : null, ready, setWon, props.onPlainStage)}
            className="rounded-full bg-white px-3 py-1.5 text-[13px] font-bold text-me-charcoal shadow-sm disabled:opacity-40"
          >
            {s.label}
          </button>
        ))}
        <RestStages count={props.restCount} onShow={props.onShowRest} />
        {won && (
          <WonEditor
            clientId={props.clientId}
            contactId={props.contactId}
            stageKey={won.stageKey}
            onClose={() => setWon(null)}
            onSaved={props.onSaved}
          />
        )}
      </div>
    </div>
  )
}

function RestStages(props: { count: number; onShow: () => void }) {
  if (props.count <= 0) return null
  return (
    <button
      type="button"
      onClick={props.onShow}
      className="rounded-full border border-dashed border-me-charcoal/25 px-3 py-1.5 text-[13px] font-bold text-me-charcoal/50"
    >
      其他 {props.count} 个…
    </button>
  )
}

function WonEditor(props: {
  clientId: string
  contactId: string
  stageKey: string
  onClose: () => void
  onSaved: (msg: string, reload?: boolean) => void
}) {
  return (
    <MarkWonPanel
      clientId={props.clientId}
      contactId={props.contactId}
      stageKey={props.stageKey}
      onCancel={props.onClose}
      onDone={(msg, reload) => {
        props.onClose()
        props.onSaved(msg, reload)
      }}
    />
  )
}

function chooseStage(
  stage: StageChoice,
  dealKey: string | null,
  ready: boolean,
  setWon: (stage: StageChoice) => void,
  onPlainStage: (stageKey: string, label: string) => void,
): void {
  if (!ready) return
  if (stageCountsAsDeal(dealKey, stage.stageKey)) {
    setWon(stage)
    return
  }
  onPlainStage(stage.stageKey, stage.label)
}

function StageGateNote(props: { gate: DealStageLoad }) {
  if (props.gate.status === 'loading') {
    return <p className="text-xs text-me-charcoal/60">跟进设置还在读取，先别改阶段。</p>
  }
  if (props.gate.status === 'error') {
    return (
      <p className="text-xs text-[#9B2C22]">
        跟进设置没读到，先别改阶段。
        <button type="button" onClick={props.gate.retry} className="ml-2 font-bold underline">
          再读一次
        </button>
      </p>
    )
  }
  return null
}

function useDealStageLoad(clientId: string): DealStageLoad {
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<'loading' | 'error' | { key: string | null }>('loading')
  useEffect(() => {
    let alive = true
    setLoad('loading')
    void fetch(`/api/clients/${clientId}/leads-config`)
      .then(async (res) => {
        if (!alive) return
        if (!res.ok) {
          setLoad('error')
          return
        }
        const json = (await res.json()) as { config?: { capiDealStageKey?: unknown } }
        const value = json.config?.capiDealStageKey
        setLoad({ key: typeof value === 'string' && value.length > 0 ? value : null })
      })
      .catch(() => {
        if (alive) setLoad('error')
      })
    return () => {
      alive = false
    }
  }, [clientId, attempt])
  if (load === 'loading') return { status: 'loading' }
  if (load === 'error') return { status: 'error', retry: () => setAttempt((n) => n + 1) }
  return { status: 'ready', key: load.key }
}
