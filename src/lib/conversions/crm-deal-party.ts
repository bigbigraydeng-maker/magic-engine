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
const ADULT_COUNT = String.raw`\b(\d{1,2})\s*adults?\b`
const CHILD_COUNT = String.raw`\b(\d{1,2})\s*(?:children|child|kids?)\b`

export function legalPartySize(value: unknown): number | null {
  const n = typeof value === 'number' ? value : null
  if (n == null || !Number.isInteger(n) || n < 1 || n > 60) return null
  return n
}

/**
 * Every headcount this text states. More than one means the text is ambiguous.
 * An adult count together with a child count is a split, not a total, even
 * when both numbers are the same.
 */
export function partySizesInText(text: string | null): number[] {
  if (!text) return []
  const totals = countsIn(text, PATTERNS)
  const adults = countsIn(text, [ADULT_COUNT])
  const children = countsIn(text, [CHILD_COUNT])
  if (adults.length === 0 || children.length === 0) return uniqueParty(totals)
  const split = uniqueParty([...adults, ...children, ...totals])
  if (split.length === 1) return [split[0], split[0]]
  return split
}

/**
 * Call analysis stores facts as `[{ key: 'party_size', value: '4', ... }]`.
 * One agreed number is usable. Two different numbers are not a total.
 */
export function partySizeFromFacts(facts: unknown): number | null {
  if (Array.isArray(facts)) return oneParty(facts.map(partySizeOnRow))
  return partySizeOnRow(facts)
}

function partySizeOnRow(row: unknown): number | null {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) return null
  const fact = row as { key?: unknown; value?: unknown; party_size?: unknown }
  if (fact.key === 'party_size') return wholeParty(fact.value)
  if (fact.key != null) return null
  return wholeParty(fact.party_size)
}

function wholeParty(value: unknown): number | null {
  if (typeof value === 'number') return legalPartySize(value)
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value.trim())) return null
  return legalPartySize(Number(value.trim()))
}

function oneParty(values: Array<number | null>): number | null {
  const found = new Set<number>()
  for (const value of values) {
    if (value != null) found.add(value)
  }
  if (found.size !== 1) return null
  return [...found][0]
}

function countsIn(text: string, sources: string[]): number[] {
  const found: number[] = []
  for (const source of sources) {
    const re = new RegExp(source, 'gi')
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const n = legalPartySize(Number(match[1]))
      if (n != null) found.push(n)
    }
  }
  return found
}

function uniqueParty(values: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const n of values) {
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
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
