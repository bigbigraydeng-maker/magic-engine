/**
 * The 「发信统计」 page's data: which mails went out (the human-click send receipts), to whom, which link the guest
 * clicked, and whether the guest got in touch afterwards. No address, no body, no subject: a guest is a contact id.
 * Design: docs/ledger/2026-11-11-crm-send-stats-page.md
 */

export interface SendStatClick {
  label: string
  firstClickedAt: string
}

export interface SendStatReaction {
  /** When the guest got in touch first after this mail. */
  at: string
  /** `email` | `phone` | `whatsapp` | `messenger` | `sms` */
  channel: string
}

export interface SendStatRow {
  id: string
  createdAt: string
  contactId: string
  contactName: string | null
  /** `null` = a mail the salesperson wrote themselves. */
  templateKey: string | null
  /** The template's current name (what the person sees in the template list); null when none / not found. */
  templateName: string | null
  outcome: string
  blockReason: string | null
  /** `null` = clicks could not be read (the page says so, never shows "0 clicks"). */
  clicks: SendStatClick[] | null
  /** The guest got in touch after this mail. `null` = no (or not readable: see `reactionsReadable`). */
  reaction: SendStatReaction | null
}

export interface SendStatsPayload {
  days: number
  /** More mails than the page reads in one go: the oldest are cut off. */
  truncated: boolean
  /** False when the "did they get in touch" read failed: the page says so instead of showing zero. */
  reactionsReadable: boolean
  rows: SendStatRow[]
}
