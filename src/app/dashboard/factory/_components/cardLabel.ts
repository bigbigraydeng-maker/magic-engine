import { parseAngle } from './reviewCardMeta'

// Short human title for a review card: 客户｜团名｜第N条｜版本.
// The long engineering note (rationale_one_liner) is kept for the folded "详情" block.

const VERSION_RE = /\bv(\d+)\b/i

export function cardLabel(clientName: string, angle: string, rationale: string): string {
  const p = parseAngle(angle)
  const parts = [clientName, p.group, p.seq !== null ? `第${p.seq}条` : '']
  const v = VERSION_RE.exec(angle) ?? VERSION_RE.exec(rationale)
  if (v) parts.push(`v${v[1]}`)
  return parts.filter(Boolean).join('｜')
}

// Everything the PM does not need at a glance: hook text + the full engineering note.
export function cardDetails(angle: string, rationale: string): string[] {
  const p = parseAngle(angle)
  return [p.hook, rationale].map((s) => s.trim()).filter((s, i, a) => s && a.indexOf(s) === i)
}
