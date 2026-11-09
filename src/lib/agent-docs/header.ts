export const HEADER_FIELDS = ['负责', '范围', '状态', '日期', '最后核实', '风险', '依据'] as const
export type HeaderField = (typeof HEADER_FIELDS)[number]

const FIELD_RE = new RegExp(
  `^[>\\-*\\s]*\\**(${HEADER_FIELDS.join('|')})\\**\\s*[:：]\\s*\\**\\s*(.*?)\\s*$`,
)

export function parseDocHeader(text: string): Record<HeaderField, string> {
  const result = Object.fromEntries(HEADER_FIELDS.map((f) => [f, '待补'])) as Record<HeaderField, string>
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/).slice(0, 40)) for (const part of line.split(/[｜|]/)) {
    const m = FIELD_RE.exec(part)
    if (!m || seen.has(m[1])) continue
    const value = m[2].replace(/\*+$/, '').trim()
    if (value === '') continue
    result[m[1] as HeaderField] = value
    seen.add(m[1])
  }
  return result
}
