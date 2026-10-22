/**
 * 从已有的往来证据里，给「名字还没有」的联系人找出他的真名。
 * 设计：PM 2026-10-22——「不能清理，是要补充他们的信息」。名字栏里只有邮箱的联系人，
 * 其实多半能从别处找到他叫什么：会话里的参与者名字、网站表单通知邮件的标题（「…enquiry — Tracey Ray」）、邮件显示名。
 *
 * 纯函数：只做「证据 → 候选名字 + 把握程度」，不读库不写库。写库在脚本里，且要 PM 看过清单点头。
 * 候选名字一律过 `cleanDisplayName`（不是邮箱 / 电话 / 占位词）。
 */

import { cleanDisplayName } from './clean-display-name'

export type NameSource = 'conversation_name' | 'form_subject' | 'sender_name'
export type NameConfidence = 'high' | 'medium' | 'low'

export interface NameEvidence {
  /** 这个人所有会话的 participant_name（各渠道上他自己用的名字）。 */
  participantNames: string[]
  /** 会话标题（邮件主题）；网站表单通知的标题里带着客人填的名字。 */
  subjects: string[]
  /** 消息里的发件人显示名（排除我们自己的）。 */
  senderNames: string[]
  /** 他的邮箱（用来核对名字是否像他本人：名字里的词出现在邮箱 @ 前面）。 */
  email: string | null
}

export interface NameProposal {
  name: string
  source: NameSource
  confidence: NameConfidence
  evidence: string
}

/** 太短 / 明显是我们自己或系统的名字，不当作客人的名字。 */
const NOT_A_CUSTOMER_NAME = new Set(['pa', 'cts tours', 'cts', 'info', 'sales', 'admin', 'support', 'team', 'reception'])

function usable(raw: string | null | undefined): string | null {
  const cleaned = cleanDisplayName(raw)
  if (!cleaned) return null
  if (cleaned.length < 3) return null
  if (NOT_A_CUSTOMER_NAME.has(cleaned.toLowerCase())) return null
  return cleaned
}

function tokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9À-ɏ一-鿿]+/).filter((t) => t.length >= 2)
}

/** 名字里至少一个词出现在邮箱 @ 前面（去掉标点后）——像他本人的名字。 */
export function nameMatchesEmail(name: string, email: string | null): boolean {
  if (!email) return false
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  return tokens(name).some((t) => local.includes(t.replace(/[^a-z0-9]/g, '')))
}

/** 网站表单通知邮件的标题：`…enquiry — Tracey Ray`、`Contact form: General Inquiry — Sumedha`。取最后一个破折号后面的名字。 */
export function nameFromFormSubject(subject: string): string | null {
  if (!/enquiry|inquiry|contact form|itinerary|journeys/i.test(subject)) return null
  const parts = subject.split(/\s[—–]\s/)
  if (parts.length < 2) return null
  const tail = parts[parts.length - 1].trim()
  // 标题里这一段也可能是线路名（「China Discovery — Best of China」）：含这些词的不是人名。
  if (/china|tour|journey|itinerar|signature|discovery|christmas|silk|golden|premium|custom|general|stopover/i.test(tail)) return null
  return usable(tail)
}

/**
 * 给出最可信的一个候选名字；没有证据返回 null。
 * 排序：会话里的全名（≥2 个词）> 表单标题里的名字 > 单个词的会话名 > 发件人显示名。
 * 把握：名字像他邮箱的 → high；全名 → high；其余 medium / low。
 */
export function proposeNameFromEvidence(ev: NameEvidence): NameProposal | null {
  const candidates: NameProposal[] = []

  for (const n of ev.participantNames) {
    const name = usable(n)
    if (!name) continue
    const words = name.split(/\s+/).length
    const confidence: NameConfidence = words >= 2 || nameMatchesEmail(name, ev.email) ? 'high' : 'medium'
    candidates.push({ name, source: 'conversation_name', confidence, evidence: `会话里他的名字：${name}` })
  }
  for (const s of ev.subjects) {
    const name = nameFromFormSubject(s)
    if (!name) continue
    const confidence: NameConfidence = nameMatchesEmail(name, ev.email) ? 'high' : name.split(/\s+/).length >= 2 ? 'medium' : 'low'
    candidates.push({ name, source: 'form_subject', confidence, evidence: `表单通知标题：${s}` })
  }
  for (const n of ev.senderNames) {
    const name = usable(n)
    if (!name) continue
    candidates.push({ name, source: 'sender_name', confidence: nameMatchesEmail(name, ev.email) ? 'high' : 'low', evidence: `邮件显示名：${name}` })
  }
  if (candidates.length === 0) return null

  const rank = (c: NameProposal): number => {
    const conf = c.confidence === 'high' ? 0 : c.confidence === 'medium' ? 10 : 20
    const src = c.source === 'conversation_name' ? 0 : c.source === 'form_subject' ? 1 : 2
    const words = c.name.split(/\s+/).length >= 2 ? 0 : 5
    return conf + src + words
  }
  return [...candidates].sort((a, b) => rank(a) - rank(b) || b.name.length - a.name.length)[0]
}
