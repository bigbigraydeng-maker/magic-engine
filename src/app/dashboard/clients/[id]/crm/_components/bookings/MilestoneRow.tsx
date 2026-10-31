'use client'

/**
 * One payment item (定金 / 尾款) inside a booking card.
 *
 * Shows the item's status, any warnings that belong to it, and the small
 * inline panels staff use to record a payment or change the due date.
 * All four mutating actions send the item's own `updatedAt` as the
 * expected version so a concurrent edit is detected.
 */

import { useEffect, useId, useRef, useState } from 'react'

import type { BookingView, BookingWarning, MilestoneView } from '@/lib/crm/booking-types'
import { markPaid, markUnpaid, overrideDue, patchBooking } from './booking-api'
import { dealSettled, MISSING_PARTY_MESSAGE, readDealNotice, type DealNotice } from './deal-notice'
import { milestoneStatusText, nzToday } from './booking-format'
import {
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  WARNING_CLASS,
} from './booking-styles'
import type { RunAction } from './useBookings'

export interface MilestoneRowProps {
  clientId: string
  booking: BookingView
  milestone: MilestoneView
  warnings: BookingWarning[]
  busy: boolean
  readOnly?: boolean
  /** Which paid item should record a deal. Null means this client does not auto-record. */
  dealMilestone?: 'deposit' | 'balance' | null
  run: RunAction
}

type Mode = 'idle' | 'confirm_paid' | 'override_due'

interface PaidPanelProps {
  clientId: string
  bookingId: string
  milestone: MilestoneView
  busy: boolean
  run: RunAction
  onDone: (notice: DealNotice | null) => void
}

/** Inline panel that records a payment for one item. */
function PaidPanel(props: PaidPanelProps): JSX.Element {
  const { clientId, bookingId, milestone, busy, run, onDone } = props
  const [paidOn, setPaidOn] = useState<string>(() => nzToday())
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const confirm = async (): Promise<void> => {
    let notice: DealNotice | null = null
    const ok = await run(async () => {
      const result = await markPaid(clientId, bookingId, milestone.kind, milestone.updatedAt, paidOn)
      if (result.ok) notice = readDealNotice(result.data)
      return result
    })
    if (!ok) return
    onDone(notice)
  }

  return (
    <div
      role="group"
      aria-label={`确认${milestone.label}已收到款`}
      className="mt-2 space-y-2"
    >
      <p className="text-sm font-semibold text-me-charcoal">
        确认已收到{milestone.label}吗？
      </p>
      <div>
        <label htmlFor={inputId} className="block text-sm font-semibold text-me-charcoal">
          收款日期
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="date"
          value={paidOn}
          max={nzToday()}
          onChange={(e) => setPaidOn(e.target.value)}
          className="min-h-[44px] w-full rounded-lg border border-me-charcoal/25 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus-visible:ring-2 focus-visible:ring-me-ochre"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={busy || paidOn === '' || paidOn > nzToday()}
          onClick={() => void confirm()}
        >
          确认已收到款
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onDone}>
          先不勾
        </button>
      </div>
    </div>
  )
}

interface OverridePanelProps {
  clientId: string
  bookingId: string
  milestone: MilestoneView
  busy: boolean
  run: RunAction
  onDone: () => void
}

/** Inline panel that sets or clears a manual due date for one item. */
function OverridePanel(props: OverridePanelProps): JSX.Element {
  const { clientId, bookingId, milestone, busy, run, onDone } = props
  const [dueOn, setDueOn] = useState<string>(() => milestone.dueOn ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const save = async (): Promise<void> => {
    const ok = await run(() =>
      overrideDue(clientId, bookingId, milestone.kind, milestone.updatedAt, dueOn),
    )
    if (ok) onDone()
  }

  const restore = async (): Promise<void> => {
    const ok = await run(() =>
      overrideDue(clientId, bookingId, milestone.kind, milestone.updatedAt, null),
    )
    if (ok) onDone()
  }

  return (
    <div
      role="group"
      aria-label={`修改${milestone.label}到期日`}
      className="mt-2 space-y-2"
    >
      <div>
        <label htmlFor={inputId} className="block text-sm font-semibold text-me-charcoal">
          新的到期日
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
          className="min-h-[44px] w-full rounded-lg border border-me-charcoal/25 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus-visible:ring-2 focus-visible:ring-me-ochre"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={busy || dueOn === ''}
          onClick={() => void save()}
        >
          保存
        </button>
        {milestone.dueOverrideOn !== null && (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={busy}
            onClick={() => void restore()}
          >
            恢复系统算的日期
          </button>
        )}
        <button type="button" className={SECONDARY_BUTTON} onClick={onDone}>
          取消
        </button>
      </div>
    </div>
  )
}

export function MilestoneRow(props: MilestoneRowProps): JSX.Element {
  const { clientId, booking, milestone, warnings, busy, readOnly, dealMilestone = null, run } = props
  const [mode, setMode] = useState<Mode>('idle')
  const [held, setHeld] = useState<DealNotice | null>(null)
  useEffect(() => {
    setHeld(loadHold(booking.id, milestone.kind))
  }, [booking.id, milestone.kind])
  const remember = (notice: DealNotice | null): void => {
    setHeld(notice)
    saveHold(booking.id, milestone.kind, notice)
  }
  const showDeal =
    milestone.state === 'paid' &&
    !milestone.autoByEmail &&
    !readOnly &&
    mode === 'idle' &&
    (held !== null || (dealMilestone === milestone.kind && booking.partySize == null))
  const paidButtonRef = useRef<HTMLButtonElement | null>(null)
  const overrideButtonRef = useRef<HTMLButtonElement | null>(null)
  const openerKindRef = useRef<'paid' | 'override' | null>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (mode === 'idle') {
      if (wasOpenRef.current) {
        wasOpenRef.current = false
        const opener =
          openerKindRef.current === 'paid'
            ? paidButtonRef.current
            : overrideButtonRef.current
        openerKindRef.current = null
        if (opener !== null && opener.isConnected) opener.focus()
      }
    } else {
      wasOpenRef.current = true
    }
  }, [mode])

  const statusClass = milestone.overdue
    ? 'text-[#9B2C22]'
    : 'text-me-charcoal/80'

  const revoke = async (): Promise<void> => {
    await run(() => markUnpaid(clientId, booking.id, milestone.kind, milestone.updatedAt))
  }

  return (
    <li
      data-testid={`payment-${milestone.kind}`}
      className="rounded-lg border border-me-charcoal/10 bg-me-ivory/40 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-black text-me-charcoal">{milestone.label}</span>
        <span className={`text-sm font-semibold ${statusClass}`}>
          {milestoneStatusText(milestone)}
        </span>
        {milestone.autoByEmail && (
          <span className="rounded-full border border-me-charcoal/20 bg-white px-2 py-0.5 text-xs font-semibold text-me-charcoal/80">
            邮件自动
          </span>
        )}
      </div>

      {warnings.map((warning) => (
        <p key={warning.code} className={WARNING_CLASS}>
          {warning.text}
        </p>
      ))}

      {mode === 'idle' && !readOnly && (
        <div className="mt-2 flex flex-wrap gap-2">
          {milestone.state === 'paid' ? (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              aria-label={`撤销${milestone.label}收款`}
              disabled={busy}
              onClick={() => void revoke()}
            >
              撤销
            </button>
          ) : (
            <>
              <button
                type="button"
                ref={paidButtonRef}
                className={PRIMARY_BUTTON}
                aria-label={`${milestone.label}已收到款`}
                disabled={busy}
                onClick={() => {
                  openerKindRef.current = 'paid'
                  setMode('confirm_paid')
                }}
              >
                已收到款
              </button>
              <button
                type="button"
                ref={overrideButtonRef}
                className={SECONDARY_BUTTON}
                aria-label={`改到期日（${milestone.label}）`}
                disabled={busy}
                onClick={() => {
                  openerKindRef.current = 'override'
                  setMode('override_due')
                }}
              >
                改到期日
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'confirm_paid' && (
        <PaidPanel
          clientId={clientId}
          bookingId={booking.id}
          milestone={milestone}
          busy={busy}
          run={run}
          onDone={(notice) => {
            remember(notice)
            setMode('idle')
          }}
        />
      )}
      {showDeal && (
        <DealHold
          clientId={clientId}
          booking={booking}
          milestone={milestone}
          notice={held}
          busy={busy}
          run={run}
          onNotice={remember}
        />
      )}

      {mode === 'override_due' && (
        <OverridePanel
          clientId={clientId}
          bookingId={booking.id}
          milestone={milestone}
          busy={busy}
          run={run}
          onDone={() => setMode('idle')}
        />
      )}
    </li>
  )
}

function DealHold(props: {
  clientId: string
  booking: BookingView
  milestone: MilestoneView
  notice: DealNotice | null
  busy: boolean
  run: RunAction
  onNotice: (notice: DealNotice | null) => void
}): JSX.Element {
  const [party, setParty] = useState('')
  const settled = dealSettled(props.notice)
  const needsParty =
    props.booking.partySize == null &&
    (props.notice == null || props.notice.reason === 'missing_party_size')
  const message = settled
    ? (props.notice?.message ?? '')
    : (props.notice?.message ?? MISSING_PARTY_MESSAGE)
  const size = Number(party)
  const sizeOk = Number.isInteger(size) && size >= 1 && size <= 60

  const retry = async (): Promise<void> => {
    if (needsParty && !sizeOk) return
    let next: DealNotice | null = null
    const ok = await props.run(async () => {
      if (needsParty) {
        const patched = await patchBooking(props.clientId, props.booking.id, props.booking.updatedAt, {
          partySize: size,
        })
        if (!patched.ok) return patched
      }
      const paidOn = props.milestone.paidOn ?? nzToday()
      const paid = await markPaid(
        props.clientId,
        props.booking.id,
        props.milestone.kind,
        props.milestone.updatedAt,
        paidOn,
      )
      if (paid.ok) next = readDealNotice(paid.data)
      return paid
    })
    if (ok) props.onNotice(next)
  }

  return (
    <div className="mt-2 space-y-2" role="status">
      <p className={`text-sm font-semibold ${settled ? 'text-me-charcoal' : 'text-[#9B2C22]'}`}>{message}</p>
      {!settled && needsParty && (
        <label className="block text-sm font-semibold text-me-charcoal">
          人数
          <input
            type="number"
            min={1}
            max={60}
            value={party}
            aria-label="补记成交的人数"
            onChange={(e) => setParty(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border border-me-charcoal/25 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal"
          />
        </label>
      )}
      {!settled && (
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={props.busy || (needsParty && !sizeOk)}
          onClick={() => void retry()}
        >
          {needsParty ? '保存人数并补记成交' : '补记成交'}
        </button>
      )}
    </div>
  )
}

function holdKey(bookingId: string, kind: string): string {
  return `me-deal-hold:${bookingId}:${kind}`
}

function loadHold(bookingId: string, kind: string): DealNotice | null {
  try {
    const raw = sessionStorage.getItem(holdKey(bookingId, kind))
    if (!raw) return null
    return readDealNotice({ deal: JSON.parse(raw) as unknown })
  } catch {
    return null
  }
}

function saveHold(bookingId: string, kind: string, notice: DealNotice | null): void {
  try {
    const key = holdKey(bookingId, kind)
    if (!notice || dealSettled(notice)) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(notice))
  } catch {
    // Private mode: the message still shows until this panel unmounts.
  }
}
