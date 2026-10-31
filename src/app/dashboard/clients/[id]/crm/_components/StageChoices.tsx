'use client'

/**
 * Stage buttons inside the guest drawer.
 * The amount panel opens only when this client's saved deal stage matches
 * the button. No client id is special-cased.
 */

import { useEffect, useState } from 'react'
import { MarkWonPanel } from './MarkWonPanel'

interface StageChoice {
  stageKey: string
  label: string
}

export function StageChoices(props: {
  clientId: string
  contactId: string
  stages: StageChoice[]
  restCount: number
  onShowRest: () => void
  onPlainStage: (stageKey: string, label: string) => void
  onSaved: (msg: string, reload?: boolean) => void
}) {
  const dealStageKey = useDealStageKey(props.clientId)
  const [won, setWon] = useState<StageChoice | null>(null)

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {props.stages.map((s) => (
        <button
          key={s.stageKey}
          type="button"
          onClick={() => {
            if (dealStageKey && s.stageKey === dealStageKey) {
              setWon(s)
              return
            }
            props.onPlainStage(s.stageKey, s.label)
          }}
          className="rounded-full bg-white px-3 py-1.5 text-[13px] font-bold text-me-charcoal shadow-sm"
        >
          {s.label}
        </button>
      ))}
      {props.restCount > 0 && (
        <button
          type="button"
          onClick={props.onShowRest}
          className="rounded-full border border-dashed border-me-charcoal/25 px-3 py-1.5 text-[13px] font-bold text-me-charcoal/50"
        >
          其他 {props.restCount} 个…
        </button>
      )}
      {won && (
        <MarkWonPanel
          clientId={props.clientId}
          contactId={props.contactId}
          stageKey={won.stageKey}
          onCancel={() => setWon(null)}
          onDone={(msg, reload) => {
            setWon(null)
            props.onSaved(msg, reload)
          }}
        />
      )}
    </div>
  )
}

function useDealStageKey(clientId: string): string | null {
  const [key, setKey] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void fetch(`/api/clients/${clientId}/leads-config`)
      .then(async (res) => {
        if (!res.ok) return
        const json = (await res.json()) as { config?: { capiDealStageKey?: unknown } }
        const value = json.config?.capiDealStageKey
        if (alive && typeof value === 'string' && value.length > 0) setKey(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [clientId])
  return key
}
