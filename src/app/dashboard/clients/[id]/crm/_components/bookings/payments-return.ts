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

const NAME_KEY_PREFIX = 'crm-deeplink-name:'

/**
 * Remember a guest's name for the next page, so the guest list can search for them when they are not
 * on the page it loads first. The name goes through sessionStorage (not the address bar) because it
 * is personal data. Without storage the link still works for guests on the first page.
 */
export function stashContactName(clientId: string, contactId: string, name: string | null): void {
  try {
    const key = `${NAME_KEY_PREFIX}${clientId}:${contactId}`
    if (name && name.trim().length > 0) window.sessionStorage.setItem(key, name.trim())
  } catch {
    // storage blocked: only guests already on the first page can be opened
  }
}

/** Read and remove the name saved by stashContactName (null when none). */
export function takeContactName(clientId: string, contactId: string): string | null {
  try {
    const key = `${NAME_KEY_PREFIX}${clientId}:${contactId}`
    const v = window.sessionStorage.getItem(key)
    window.sessionStorage.removeItem(key)
    return v
  } catch {
    return null
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

/** Remove `focus` from the address bar (keeps every other parameter and the history entry). */
export function stripFocusFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('focus')) return
  url.searchParams.delete('focus')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
