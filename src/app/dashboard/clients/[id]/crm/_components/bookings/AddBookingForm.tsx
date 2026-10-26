'use client'

/**
 * The 「＋ 加订单」 form for a contact.
 *
 * Loads the tour catalog, collects the tour, departure, booking date and a
 * few optional details, then creates the booking. The optional details live
 * behind a 「更多」 disclosure so the common case stays short.
 */

import { useId, useState } from 'react'

import { createBooking } from './booking-api'
import { nzToday } from './booking-format'
import { TourDeparturePicker } from './TourDeparturePicker'
import { useCatalogOptions } from './useCatalogOptions'
import type { RunAction } from './useBookings'
import {
  ERROR_TEXT,
  INPUT_CLASS,
  LABEL_CLASS,
  MUTED_TEXT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from './booking-styles'

interface AddBookingFormProps {
  clientId: string
  contactId: string
  busy: boolean
  run: RunAction
  onDone: () => void
  onCancel: () => void
}

interface MoreFieldsProps {
  idPrefix: string
  partySize: string
  onPartySizeChange: (value: string) => void
  isCruise: boolean
  onIsCruiseChange: (value: boolean) => void
  note: string
  onNoteChange: (value: string) => void
  disabled: boolean
}

function MoreFields({
  idPrefix,
  partySize,
  onPartySizeChange,
  isCruise,
  onIsCruiseChange,
  note,
  onNoteChange,
  disabled,
}: MoreFieldsProps) {
  const partySizeId = `${idPrefix}-party-size`
  const isCruiseId = `${idPrefix}-is-cruise`
  const noteId = `${idPrefix}-note`

  return (
    <div className="grid gap-3">
      <div>
        <label className={LABEL_CLASS} htmlFor={partySizeId}>
          人数
        </label>
        <input
          id={partySizeId}
          type="number"
          min={1}
          max={60}
          className={INPUT_CLASS}
          value={partySize}
          disabled={disabled}
          onChange={(event) => onPartySizeChange(event.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id={isCruiseId}
          type="checkbox"
          checked={isCruise}
          disabled={disabled}
          onChange={(event) => onIsCruiseChange(event.target.checked)}
        />
        <label className={LABEL_CLASS} htmlFor={isCruiseId}>
          这是邮轮团
        </label>
      </div>

      <div>
        <label className={LABEL_CLASS} htmlFor={noteId}>
          备注（可写同行人姓名；不要写金额）
        </label>
        <input
          id={noteId}
          type="text"
          maxLength={500}
          className={INPUT_CLASS}
          value={note}
          disabled={disabled}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </div>
    </div>
  )
}

export function AddBookingForm({
  clientId,
  contactId,
  busy,
  run,
  onDone,
  onCancel,
}: AddBookingFormProps) {
  const idPrefix = useId()
  const { state, retry } = useCatalogOptions(clientId)
  const [tourId, setTourId] = useState('')
  const [departureId, setDepartureId] = useState('')
  const [bookedOn, setBookedOn] = useState(nzToday())
  const [moreOpen, setMoreOpen] = useState(false)
  const [partySize, setPartySize] = useState('')
  const [isCruise, setIsCruise] = useState(false)
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const bookedOnId = `${idPrefix}-booked-on`
  const moreRegionId = `${idPrefix}-more`

  async function handleSubmit(): Promise<void> {
    if (tourId === '') {
      setFormError('请先选一个团')
      return
    }
    if (bookedOn === '') {
      setFormError('请选预订日期')
      return
    }
    setFormError(null)
    const ok = await run(() =>
      createBooking(clientId, {
        contactId,
        tourId,
        departureId: departureId === '' ? null : departureId,
        bookedOn,
        ...(partySize !== '' ? { partySize: Number(partySize) } : {}),
        isCruise,
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
      }),
    )
    if (ok) onDone()
  }

  if (state.status === 'loading') {
    return <p className={MUTED_TEXT}>正在读团目录…</p>
  }

  if (state.status === 'error') {
    return (
      <div className="grid gap-2">
        <p role="alert" className={ERROR_TEXT}>
          {state.message}
        </p>
        <button type="button" className={SECONDARY_BUTTON} onClick={retry}>
          重试
        </button>
      </div>
    )
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSubmit()
      }}
    >
      <TourDeparturePicker
        tours={state.tours}
        tourId={tourId}
        departureId={departureId}
        onChange={(nextTourId, nextDepartureId) => {
          setTourId(nextTourId)
          setDepartureId(nextDepartureId)
        }}
        idPrefix={idPrefix}
        disabled={busy}
      />

      <div>
        <label className={LABEL_CLASS} htmlFor={bookedOnId}>
          预订日期
        </label>
        <input
          id={bookedOnId}
          type="date"
          className={INPUT_CLASS}
          value={bookedOn}
          disabled={busy}
          onChange={(event) => setBookedOn(event.target.value)}
        />
      </div>

      <div>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          aria-expanded={moreOpen}
          aria-controls={moreRegionId}
          onClick={() => setMoreOpen((open) => !open)}
        >
          更多
        </button>
      </div>

      {moreOpen ? (
        <div id={moreRegionId}>
          <MoreFields
            idPrefix={idPrefix}
            partySize={partySize}
            onPartySizeChange={setPartySize}
            isCruise={isCruise}
            onIsCruiseChange={setIsCruise}
            note={note}
            onNoteChange={setNote}
            disabled={busy}
          />
        </div>
      ) : null}

      {formError !== null ? (
        <p role="alert" className={ERROR_TEXT}>
          {formError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          加订单
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={busy}
          onClick={onCancel}
        >
          先不加了
        </button>
      </div>
    </form>
  )
}
