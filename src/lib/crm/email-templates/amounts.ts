// Money amounts quoted in text. Only amounts with a "$" marker count (NZ$7,188, NZD $4,080, $2,699.50).
const AMOUNT_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g

/** Normalised amounts in order of appearance: commas removed, ".00" dropped ("4080", "2699.50"). */
export function extractAmounts(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(AMOUNT_RE)) {
    const whole = match[1].replace(/,/g, '')
    const decimals = match[2] === undefined ? '' : match[2].padEnd(2, '0')
    out.push(decimals !== '' && decimals !== '00' ? `${whole}.${decimals}` : whole)
  }
  return out
}
