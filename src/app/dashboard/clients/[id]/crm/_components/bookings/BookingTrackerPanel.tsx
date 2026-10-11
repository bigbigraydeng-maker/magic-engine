'use client'

/**
 * The single component the CRM "all guests" page mounts for the
 * "订单与付款" tracker. It owns the reminder list state and renders the
 * payment reminder section plus the members card.
 *
 * While the list is loading or hidden we render nothing so the page does
 * not flash an empty shell.
 */

import { useNudgeList } from './useNudgeList'
import { PaymentNudgeSection } from './PaymentNudgeSection'
import { BookingMembersCard } from './BookingMembersCard'
import { BookingsErrorBoundary } from './BookingsErrorBoundary'

export interface BookingTrackerPanelProps {
  clientId: string
  onOpenContact: (contactId: string, contactName: string | null) => void
}

export function BookingTrackerPanel({
  clientId,
  onOpenContact,
}: BookingTrackerPanelProps): JSX.Element | null {
  const list = useNudgeList(clientId)

  if (list.state.status === 'loading' || list.state.status === 'hidden') {
    return null
  }

  return (
    <BookingsErrorBoundary>
      <div className="space-y-4" data-testid="booking-tracker-panel">
        <PaymentNudgeSection list={list} onOpenContact={onOpenContact} />
        {list.state.status === 'ready' ? (
          <BookingMembersCard clientId={clientId} />
        ) : null}
      </div>
    </BookingsErrorBoundary>
  )
}
