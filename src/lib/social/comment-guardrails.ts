/**
 * Comment auto-reply guardrails — the red-line enforcement layer.
 *
 * CLAUDE.md hard rule: customer-facing content must never fabricate operational
 * details (itinerary, price, dates, availability, "we arrange X" promises).
 * The auto-reply system therefore NEVER lets an LLM-authored reply reach a
 * customer's public feed / DM unless it passes this deterministic filter.
 *
 * Two roles:
 *   1. detectUnverifiableClaims() — scan any candidate reply string for the
 *      claim shapes we forbid. Runs AFTER the LLM, before anything is sent.
 *   2. safe fallback templates — zero-claim static replies used when a draft
 *      is rejected, or for categories the LLM is never trusted to answer
 *      (questions/complaints get a warm holding reply + offline follow-up).
 *
 * This module has NO LLM and NO network — it is pure + fully unit-testable,
 * so a mutation test can prove a broken filter fails the suite.
 */

export interface ReplyContext {
  /** Client display name, e.g. "CTS Tours". */
  clientName: string
  /** Official client website (brand-safe), e.g. "https://ctstours.co.nz". */
  siteUrl: string
  /** Commenter's first name if known, for a warmer reply. */
  authorFirstName?: string
}

/**
 * Scan a candidate reply for claim shapes we forbid in auto-sent content.
 * Returns the list of triggered flags (empty = safe to send).
 *
 * Deliberately conservative: a false positive just routes to a safe template;
 * a false negative could publish a fabricated fact under the client's brand.
 */
export function detectUnverifiableClaims(text: string): string[] {
  const flags: string[] = []
  const t = text.toLowerCase()

  // Money — "$1,299", "1299 aud", "from $99", "1,200 dollars"
  if (/\$\s?\d/.test(t) || /\b\d[\d,]*\s?(usd|aud|nzd|dollars?)\b/.test(t)) {
    flags.push('price')
  }

  // Duration — "5 day", "3-night", "10 days", "2 hour"
  if (/\b\d+\s?[-–]?\s?(day|night|hour)s?\b/.test(t)) {
    flags.push('duration')
  }

  // Explicit itinerary / availability / booking assertions
  if (/\b(includes?|including|itinerary|departs?|departure|available on|availability|we offer the|our package|book now for|priced at|costs?\b)\b/.test(t)) {
    flags.push('itinerary_claim')
  }

  // Concrete calendar dates — "March 3", "on 12 April", "3rd of June"
  const months = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
  if (new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s?(of\\s)?(${months})`).test(t) ||
      new RegExp(`\\b(${months})[a-z]*\\s?\\d{1,2}\\b`).test(t)) {
    flags.push('date')
  }

  // Percentage discounts — "20% off", "save 15%"
  if (/\b\d+\s?%/.test(t)) {
    flags.push('discount')
  }

  return flags
}

/** True when the text is safe to auto-send (no forbidden claims). */
export function isSafeToAutoSend(text: string): boolean {
  return detectUnverifiableClaims(text).length === 0
}

// ── Zero-claim fallback templates ─────────────────────────────────────────────
// Every template below asserts NO operational fact. They thank / acknowledge and
// steer to the official site or DM. Safe to auto-send for any category.

function greeting(ctx: ReplyContext): string {
  return ctx.authorFirstName ? `${ctx.authorFirstName}, ` : ''
}

/** Warm public reply for genuine praise — no claims, just gratitude + soft steer. */
export function safePraiseReply(ctx: ReplyContext): string {
  const hi = greeting(ctx)
  return `${hi ? hi.charAt(0).toUpperCase() + hi.slice(1) : ''}thank you so much for the kind words! 🙏 It means a lot to the whole ${ctx.clientName} team. We'd love to help you plan your next adventure — feel free to send us a message anytime 😊`
}

/** Public holding reply for a question — acknowledges, does NOT answer, points to DM. */
export function safeQuestionPublicReply(ctx: ReplyContext): string {
  const hi = greeting(ctx)
  return `Great question${hi ? `, ${ctx.authorFirstName}` : ''}! 😊 We've just popped you a direct message so our team can help you properly.`
}

/** Private (DM) reply for a question — routes to a human, asserts no facts. */
export function safeQuestionPrivateReply(ctx: ReplyContext): string {
  const hi = greeting(ctx)
  return `Hi ${hi ? ctx.authorFirstName : 'there'}! Thanks so much for your interest in ${ctx.clientName} 🌏 One of our travel consultants will follow up shortly with the details. In the meantime you're welcome to browse everything we offer at ${ctx.siteUrl}.`
}

/** Public reply for a complaint / negative comment — empathetic, moves to DM. */
export function safeComplaintPublicReply(ctx: ReplyContext): string {
  const hi = greeting(ctx)
  return `${hi ? hi.charAt(0).toUpperCase() + hi.slice(1) : ''}we're really sorry to hear this, and we'd like to make it right. We've sent you a direct message so we can look into it personally. 🙏`
}

/** Private (DM) reply for a complaint — routes to a human. */
export function safeComplaintPrivateReply(ctx: ReplyContext): string {
  return `Hi${greeting(ctx) ? ` ${ctx.authorFirstName}` : ''}, thank you for flagging this — we take it seriously. A member of the ${ctx.clientName} team will reach out personally to help resolve it. 🙏`
}
