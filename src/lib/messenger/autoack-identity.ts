/**
 * The identity and text of ME's F1 auto-acknowledgement, kept apart from the
 * Inngest function so read-only code (reply metrics) can recognise the message
 * without importing a workflow module. The sender email is shared with F2's
 * human-approved drafts (`DRAFT_SENT_BY_EMAIL`), so the email alone does not
 * prove a message is the auto-ack — match the body as well.
 */
export const AUTOACK_SENT_BY_EMAIL = 'governed-reply-agent@magicengine.cloud'

export const AUTOACK_TEMPLATE =
  "Thanks for your message — one of our team will get back to you with the details shortly.\n" +
  '感谢您的留言，我们的顾问正在为您整理详细信息，稍后回复您。'
