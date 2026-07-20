/**
 * Comment auto-reply guardrails — the red-line enforcement layer.
 *
 * CLAUDE.md hard rule: customer-facing content must never fabricate operational
 * details (itinerary, price, dates, availability, "we arrange X" promises).
 * The auto-reply system therefore NEVER lets an LLM-authored reply reach a
 * customer's public feed / DM unless it passes this deterministic filter.
 *
 * Defence in depth (after a red-team pass found the old form-based regex was
 * porous — currency-first "AUD 900", spelled-out "nine hundred dollars",
 * numeric dates "08/06", minutes, "percent", full-width chars all escaped):
 *   1. NFKC-normalise input so full-width digits/symbols fold to ASCII.
 *   2. detectUnverifiableClaims() — broadened claim-shape scan.
 *   3. isPraiseReplySafe() — whitelist-style gate: an LLM praise reply may
 *      contain NO digit, URL, @, or claim shape at all. Travel praise never
 *      needs a number, so any digit → fall back to a safe template.
 *
 * Pure + no network — fully unit-testable so a mutation test proves a weakened
 * filter fails the suite.
 */

export interface ReplyContext {
  /** Client display name, e.g. "CTS Tours". */
  clientName: string
  /** Official client website (brand-safe), e.g. "https://ctstours.co.nz". */
  siteUrl: string
  /** Commenter's first name if known, for a warmer reply. */
  authorFirstName?: string
}

/** Fold full-width / unicode digits + symbols to ASCII before scanning. */
function normalise(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

const NUMBER_WORDS =
  '(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|couple|few|several|dozen|half)'

/**
 * Scan a candidate reply for claim shapes we forbid in auto-sent content.
 * Returns the list of triggered flags (empty = no claim shape found — but for
 * LLM praise replies also run isPraiseReplySafe(), which is stricter).
 *
 * Deliberately aggressive: a false positive just routes to a safe template;
 * a false negative could publish a fabricated fact under the client's brand.
 */
export function detectUnverifiableClaims(text: string): string[] {
  const flags: string[] = []
  const t = normalise(text)

  // Money — symbol/word, either order, multiple currencies + spelled-out.
  if (
    /[$€£¥]\s?\d/.test(t) ||                                                  // $900 / €900
    /\b\d[\d,]*\s?(usd|aud|nzd|dollars?|euros?|pounds?|bucks?|quid|cents?)\b/.test(t) || // 900 aud
    /\b(usd|aud|nzd|dollars?|euros?|pounds?|bucks?|quid)\s?[$€£¥]?\s?\d/.test(t) ||       // aud 900
    new RegExp(`\\b${NUMBER_WORDS}\\s+(hundred|thousand)?\\s?(dollars?|euros?|pounds?|bucks?|quid)\\b`).test(t) // nine hundred dollars
  ) {
    flags.push('price')
  }

  // Duration — digits or spelled-out, day/night/hour/minute/week/month + abbrevs.
  if (
    /\b\d+\s?[-–]?\s?(day|night|hour|hr|hrs|h|minute|min|mins|week|month)s?\b/.test(t) ||
    new RegExp(`\\b${NUMBER_WORDS}\\s?[-–]?\\s?(day|night|hour|week|month)s?\\b`).test(t) ||
    /\b(overnight|week[-\s]?long|half[-\s]?day|fortnight|all[-\s]?day)\b/.test(t)
  ) {
    flags.push('duration')
  }

  // Explicit itinerary / availability / booking / promise assertions.
  if (/\b(include[ds]?|including|itinerary|departs?|departure|leaves? at|available|availability|we offer the|our package|book now|reserve now|priced? at|costs?|comes with|we (arrange|provide|include)|you get|pick[-\s]?up|pickup|transfer|guarantee|refund|cheapest|lowest price|best price)\b/.test(t)) {
    flags.push('itinerary_claim')
  }

  // Calendar dates — month words, numeric dates, relative dates.
  const months = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
  if (
    new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s?(of\\s)?(${months})`).test(t) ||
    new RegExp(`\\b(${months})[a-z]*\\s?\\d{1,2}\\b`).test(t) ||
    /\b\d{1,2}[/\-.]\d{1,2}([/\-.]\d{2,4})?\b/.test(t) ||
    /\b(next|this)\s+(week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|month|christmas|easter|holidays?)\b/.test(t)
  ) {
    flags.push('date')
  }

  // Percentage / discount — symbol or word (over-blocking is safe here).
  if (
    /\d\s?%/.test(t) ||                                      // 20%  (no trailing \b — % is non-word)
    /percent|per\s?cent|\bpct\b/.test(t) ||                  // twenty percent / per cent / pct
    /\b(half\s?(price|off)|bogo|\d\s?for\s?\d)\b/.test(t)
  ) {
    flags.push('discount')
  }

  return flags
}

/** True when the text is free of every forbidden claim shape. */
export function isSafeToAutoSend(text: string): boolean {
  return detectUnverifiableClaims(text).length === 0
}

/**
 * Strict whitelist gate for an LLM-authored PRAISE reply.
 * A genuine thank-you needs no digit, link, or handle — so the presence of any
 * is treated as unsafe and the caller falls back to a static template.
 * This closes the regex gaps (spelled-out numbers still can't smuggle a fact,
 * because the reply also can't reference a site/handle/promise).
 */
export function isPraiseReplySafe(text: string): boolean {
  const t = text.normalize('NFKC')
  if (/\d/.test(t)) return false                 // any digit — prices, dates, phones
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|co|net|org|nz|au)\b/i.test(t)) return false // links
  if (/@/.test(t)) return false                  // handles / emails
  return isSafeToAutoSend(t)
}

// ── Zero-claim reply templates ────────────────────────────────────────────────
// Every template asserts NO operational fact. Tone tuned for an AU/NZ travel
// brand with an older audience (per client-voice review): at most one emoji,
// no "plan your next adventure" sales tail on praise, no hard promises.

function namePrefix(ctx: ReplyContext): string {
  return ctx.authorFirstName ? `${ctx.authorFirstName}, ` : ''
}
function nameComma(ctx: ReplyContext): string {
  return ctx.authorFirstName ? `, ${ctx.authorFirstName}` : ''
}
function atSite(ctx: ReplyContext): string {
  return ctx.siteUrl ? ` at ${ctx.siteUrl}` : ''
}

const PRAISE_TEMPLATES: Array<(ctx: ReplyContext) => string> = [
  (ctx) => `${cap(namePrefix(ctx))}thank you so much — that genuinely means a lot to our team. 🙏`,
  (ctx) => `Lovely to hear${nameComma(ctx)}, thank you! We'll pass this on to the team.`,
  (ctx) => `Thanks for the kind words${nameComma(ctx)} — comments like this make our day.`,
]

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

/** Warm public reply for genuine praise — no claims, no sales tail. `seed` rotates variants to avoid a botted-looking feed. */
export function safePraiseReply(ctx: ReplyContext, seed = 0): string {
  const idx = ((seed % PRAISE_TEMPLATES.length) + PRAISE_TEMPLATES.length) % PRAISE_TEMPLATES.length
  return PRAISE_TEMPLATES[idx](ctx)
}

/** Public reply to a question when NO DM was sent — no false "we messaged you" claim. */
export function safeQuestionPublicReplyNoDm(ctx: ReplyContext): string {
  return `Thanks for asking${nameComma(ctx)}! You can reach our team any time${atSite(ctx)} and we'll be glad to help. 😊`
}

/** Public reply to a question AFTER a DM was successfully sent. */
export function safeQuestionPublicReplyWithDm(ctx: ReplyContext): string {
  return `Thanks for asking${nameComma(ctx)}! We've just sent you a message with the details — or reach us any time${atSite(ctx)}. 😊`
}

/** Private (DM) reply for a question — routes to a human, no hard time promise, no facts. */
export function safeQuestionPrivateReply(ctx: ReplyContext): string {
  const hi = ctx.authorFirstName ? ` ${ctx.authorFirstName}` : ' there'
  return `Hi${hi}, thanks for your interest in ${ctx.clientName} 🌏 One of our travel consultants will be in touch to help with your questions.${ctx.siteUrl ? ` In the meantime you're welcome to explore our trips at ${ctx.siteUrl}.` : ''}`
}

/** Public reply to a complaint when NO DM was sent — empathetic, no promise, no false DM claim. */
export function safeComplaintPublicReplyNoDm(ctx: ReplyContext): string {
  return `${cap(namePrefix(ctx))}we're sorry to hear this — that's not the experience we want for you. Please reach out to our team${atSite(ctx)} so we can look into it. 🙏`
}

/** Public reply to a complaint AFTER a DM was successfully sent. */
export function safeComplaintPublicReplyWithDm(ctx: ReplyContext): string {
  return `${cap(namePrefix(ctx))}we're sorry to hear this — that's not the experience we want for you. We've sent you a private message so we can look into it properly. 🙏`
}

/** Private (DM) reply for a complaint — routes to a human, no over-promise. */
export function safeComplaintPrivateReply(ctx: ReplyContext): string {
  const hi = ctx.authorFirstName ? ` ${ctx.authorFirstName}` : ''
  return `Hi${hi}, thank you for letting us know — we take this seriously. Someone from the ${ctx.clientName} team will reach out personally to help sort it out. 🙏`
}
