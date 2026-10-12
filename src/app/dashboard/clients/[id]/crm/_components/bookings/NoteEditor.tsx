'use client'

/**
 * Inline editor for a booking's free-text note.
 *
 * Shows the current note with a 「改备注」 button; clicking it reveals a
 * single-line input plus 保存 / 取消. Saving goes through the shared `run`
 * helper so busy tracking, stale handling and reloads stay consistent with
 * the rest of the 订单与付款 block.
 */

import { useEffect, useId, useRef, useState } from 'react'

import type { BookingView } from '@/lib/crm/booking-types'
import { patchBooking } from './booking-api'
import { INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from './booking-styles'
import type { RunAction } from './useBookings'

export interface NoteEditorProps {
  clientId: string
  booking: BookingView
  busy: boolean
  run: RunAction
}

export function NoteEditor({ clientId, booking, busy, run }: NoteEditorProps): JSX.Element {
  const inputId = useId()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(booking.note ?? '')
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const wasEditingRef = useRef(false)

  useEffect(() => {
    const wasEditing = wasEditingRef.current
    wasEditingRef.current = editing
    if (editing || !wasEditing) return
    const target = editButtonRef.current
    if (target !== null && target.isConnected) target.focus()
  }, [editing])

  const startEditing = (): void => {
    setDraft(booking.note ?? '')
    setEditing(true)
  }

  const save = async (): Promise<void> => {
    const trimmed = draft.trim()
    const ok = await run(() =>
      patchBooking(clientId, booking.id, booking.updatedAt, {
        note: trimmed === '' ? null : trimmed,
      }),
    )
    if (ok) setEditing(false)
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-me-charcoal">
          备注：{booking.note ?? '（没有）'}
        </span>
        {booking.status === 'active' ? (
          <button
            ref={editButtonRef}
            type="button"
            className={SECONDARY_BUTTON}
            onClick={startEditing}
            disabled={busy}
          >
            改备注
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <label className={LABEL_CLASS} htmlFor={inputId}>
        备注（可写同行人姓名；不要写金额、证件号）
      </label>
      <input
        id={inputId}
        type="text"
        className={INPUT_CLASS}
        maxLength={500}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY_BUTTON} onClick={() => void save()} disabled={busy}>
          保存
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() => setEditing(false)}
          disabled={busy}
        >
          取消
        </button>
      </div>
    </div>
  )
}
