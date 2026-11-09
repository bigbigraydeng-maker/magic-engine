/**
 * 时间线去重：同一封邮件在时间线里出现两次。
 *
 * 一封邮件既有一条「触点」（摘要卡片），也有一条「对话消息」（正文气泡）。客人来的邮件有主题，
 * 触点摘要是主题、气泡是正文，两条不一样，没问题。但我们回出去的邮件没有主题，触点摘要就是正文
 * 的头几句，卡片和气泡说的是同一句话 —— 员工看到「回复显示了两次」（PM 2026-10-14）。
 *
 * 只在显示时去掉那张重复的触点卡片，保留带发送人和完整正文的气泡；不动数据库里的触点
 * （分段引擎还要用它）。判据很窄：同为邮件、方向相同、两分钟内、摘要与正文互为前缀（忽略空白差异）。
 */

export interface DedupeEntry {
  kind: string
  at: string
  channel?: string | null
  direction?: string | null
  summary?: string | null
  body?: string | null
  /** 有这些之一的触点带着别的信息（结果、拨出中…），不当作纯邮件摘要去掉。 */
  outcome?: string | null
  pendingCall?: unknown
  callAnalysis?: unknown
}

const WINDOW_MS = 120_000
const MIN_LEN = 8

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function ts(v: string): number {
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function dropEmailTouchesDuplicatedByMessage<T extends DedupeEntry>(entries: T[]): T[] {
  const messages = entries.filter((e) => e.kind === 'message' && e.body && (e.channel ?? 'email') === 'email')
  if (messages.length === 0) return entries
  return entries.filter((e) => {
    if (e.kind !== 'touch' || e.channel !== 'email') return true
    if (e.outcome || e.pendingCall || e.callAnalysis) return true
    const summary = norm(e.summary ?? '')
    if (summary.length < MIN_LEN) return true
    return !messages.some((m) => {
      if (m.direction !== e.direction) return false
      if (Math.abs(ts(m.at) - ts(e.at)) > WINDOW_MS) return false
      const body = norm(m.body ?? '')
      return body.startsWith(summary) || summary.startsWith(body)
    })
  })
}
