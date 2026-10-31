/**
 * Party size for a priced deal. The booking value wins. Otherwise one
 * unambiguous number already stored on a follow-up, call fact, or the 255
 * character mail preview. Full mail is not stored here and is not fetched.
 */

const PATTERNS = [
  String.raw`\b(\d{1,2})\s*(?:pax|people|persons|adults|guests|travellers|travelers)\b`,
  String.raw`\b(?:party|group)\s+of\s+(\d{1,2})\b`,
  String.raw`(\d{1,2})\s*位客人`,
  String.raw`(\d{1,2})\s*人同行`,
  String.raw`(\d{1,2})\s*个人出行`,
]

export function legalPartySize(value: unknown): number | null {
  const n = typeof value === 'number' ? value : null
  if (n == null || !Number.isInteger(n) || n < 1 || n > 60) return null
  return n
}

/** Every headcount this text states. More than one means the text is ambiguous. */
export function partySizesInText(text: string | null): number[] {
  if (!text) return []
  const found = new Set<number>()
  for (const source of PATTERNS) {
    const re = new RegExp(source, 'gi')
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const n = legalPartySize(Number(match[1]))
      if (n != null) found.add(n)
    }
  }
  return [...found]
}

export function partySizeFromFacts(facts: unknown): number | null {
  if (facts == null || typeof facts !== 'object' || Array.isArray(facts)) return null
  return legalPartySize((facts as { party_size?: unknown }).party_size)
}

/**
 * Booking wins. Stored readings must agree on one number. An ambiguous
 * sentence, or two sentences that disagree, yields null rather than a guess.
 */
export function choosePartySize(booking: number | null, groups: number[][]): number | null {
  const onBooking = legalPartySize(booking)
  if (onBooking != null) return onBooking
  const found = new Set<number>()
  for (const group of groups) {
    if (group.length > 1) return null
    if (group.length === 1) found.add(group[0])
  }
  if (found.size !== 1) return null
  return [...found][0]
}
