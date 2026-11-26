/**
 * contact_touchpoints.source values that ME itself writes (not a mailbox sync, an import or a person).
 * Kept in the CRM module because they are facts about a guest; the sending engine imports them from here, so the
 * dependency runs one way only (messaging → crm).
 */

/** One automated e-mail that ME sent through Resend (the welcome letter, the countdown letters). Timeline only: the
 * weekly cap counts these mails from the send ledger by address, not from this row. */
export const ME_SEND_SOURCE = 'me_send'

/** The guest unsubscribed from e-mail through ME's one-click link (written by the unsubscribe entry). */
export const EMAIL_UNSUBSCRIBE_SOURCE = 'me_unsubscribe'
