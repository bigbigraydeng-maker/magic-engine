/**
 * Small glue between the 付款总览 page and the guest drawer (design §3.4 / B6).
 *
 * The page links to `/crm/all?contact=<id>&focus=bookings`. `focus=bookings` makes the drawer
 * scroll to 「订单与付款」 and show a 「← 回付款进度」 link. The page saves its own query string
 * (filters, page, selected departure) in sessionStorage just before leaving, so the link can
 * bring the staff member back to exactly the same view. Browser storage may be unavailable,
 * so every access is wrapped: without it the link still works and lands on the plain page.
 */

const RETURN_KEY_PREFIX = 'crm-payments-return:'

/** True when the current address has `focus=bookings`. */
export function hasFocusBookings(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('focus') === 'bookings'
}

/** Remember the payments page query string ('' or '?a=b') for this client. */
export function saveReturnQuery(clientId: string, search: string): void {
  try {
    window.sessionStorage.setItem(`${RETURN_KEY_PREFIX}${clientId}`, search)
  } catch {
    // storage blocked: the back link simply opens the page without the saved filters
  }
}

/** Where 「← 回付款进度」 goes: the payments page plus the saved query string, if it still looks like one. */
export function paymentsReturnHref(clientId: string): string {
  const base = `/dashboard/clients/${clientId}/crm/payments`
  try {
    const saved = window.sessionStorage.getItem(`${RETURN_KEY_PREFIX}${clientId}`)
    return saved !== null && /^\?[A-Za-z0-9_=&%.\-]*$/.test(saved) ? `${base}${saved}` : base
  } catch {
    return base
  }
}
