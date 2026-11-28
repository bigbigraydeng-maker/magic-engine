/**
 * 跟进信写完当场跑的检查。只报告，不改信，不替员工决定发不发。
 *
 * 前三类复用发信关口的 evaluateContentGates（禁用词、链接主机 / 团页在售、占位符），
 * 其余是跟进信自己的：价格出处与口径、日期是不是班期、酒店星级、长度、和以前的信是否重复、拼写、问候署名。
 */

import { evaluateContentGates } from '@/lib/crm/email-templates/gates/content-gates'
import { publishedToursProvider } from '@/lib/crm/email-templates/facts/published-tours'
import type { RenderFacts, ResolvedPick } from '@/lib/crm/email-templates/facts/types'
import type { GateViolation } from '@/lib/crm/email-templates/gates/types'
import { extractAmounts } from '@/lib/crm/email-templates/amounts'
import type { EmailSettings, PublishedToursProviderSettings } from '@/lib/crm/email-templates/types'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import type { FollowUpWriterConfig } from './follow-up-config'

/** 一条检查结果。fail = 发之前必须改；warn = 看一眼；pass = 过了。 */
export interface CheckLine {
  id: string
  status: 'pass' | 'warn' | 'fail'
  label: string
  detail: string
}

export interface FollowUpCheckInput {
  subject: string
  /** AI 写的中间几段（已去掉它自己加的问候、落款） */
  aiBody: string
  /** 拼好的整封信（问候 + 正文 + 链接 + 署名） */
  letter: string
  strippedFraming: boolean
  config: FollowUpWriterConfig
  settings: EmailSettings
  picks: readonly ResolvedPick[]
  tours: readonly PublishedTourFact[]
  providerSettings: PublishedToursProviderSettings | null
  previousSubjects: readonly string[]
  previousExcerpts: readonly string[]
  /**
   * Did anyone on our side actually talk with this guest (a call that reached them, or a staff note saying so)?
   * false = every call went unanswered or to voicemail. Not given = the caller did not work it out, and the
   * conversation check is skipped.
   */
  spokeWithGuest?: boolean
}

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
const REPEAT_OVERLAP = 0.2
const LINK_CODES = new Set(['link_not_https', 'link_userinfo', 'link_host_not_allowed', 'tour_page_not_on_sale', 'departure_not_on_sale'])
const PHRASE_CODES = new Set(['content_blocked', 'content_warning'])

interface Flagged {
  v: GateViolation
  block: boolean
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function words(text: string): number {
  return (text.replace(/https?:\/\/\S+/gi, ' ').match(/[A-Za-z0-9'’]+/g) ?? []).length
}

function ngrams(text: string, n = 4): Set<string> {
  const w = text.toLowerCase().match(/[a-z']+/g) ?? []
  const out = new Set<string>()
  for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(' '))
  return out
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/** 团页规则用的事实。官网总链接（客户配置）当作「全部团」那一页：它不是某个团的页面，团页规则不该拦它。 */
function factsFor(i: FollowUpCheckInput): RenderFacts | null {
  if (!i.providerSettings) return null
  return {
    tours: [...i.tours],
    picks: [...i.picks],
    settings: { ...i.providerSettings, allToursUrl: i.config.siteLink?.url ?? i.providerSettings.allToursUrl },
    linkHosts: i.settings.guardrails.allowedLinkHosts,
  }
}

function gateChecks(i: FollowUpCheckInput, facts: RenderFacts | null): CheckLine[] {
  const gate = evaluateContentGates({
    subject: i.subject,
    body: i.letter,
    footer: i.settings.footer,
    settings: { guardrails: i.settings.guardrails },
    provider: facts ? publishedToursProvider : null,
    facts,
  })
  const all: Flagged[] = [...gate.blocks.map((v) => ({ v, block: true })), ...gate.warnings.map((v) => ({ v, block: false }))]
  const phrase = all.filter(({ v }) => PHRASE_CODES.has(v.code))
  const links = all.filter(({ v }) => LINK_CODES.has(v.code))
  const residue = all.filter(({ v }) => !LINK_CODES.has(v.code) && !PHRASE_CODES.has(v.code) && v.code !== 'amount_not_in_catalog')
  const aiUrls = i.aiBody.match(/https?:\/\/\S+|www\.\S+/gi) ?? []
  const linkProblems = [...links.map(({ v }) => `${v.code}：${v.url ?? v.detail}`), ...aiUrls.map((u) => `AI 自己写了网址：${u}`)]
  return [
    {
      id: 'guardrails',
      status: phrase.some((x) => x.block) ? 'fail' : phrase.length > 0 ? 'warn' : 'pass',
      label: '发信规矩里的文字规则',
      detail: phrase.length === 0 ? '没有命中' : phrase.map(({ v }) => v.detail).join('；'),
    },
    {
      id: 'links',
      status: linkProblems.length > 0 ? 'fail' : 'pass',
      label: '链接都在官网、团页在售',
      detail: linkProblems.length > 0 ? linkProblems.join('；') : '链接由系统按团目录拼出，团页和班期都在售',
    },
    {
      id: 'residue',
      status: residue.length > 0 ? 'fail' : 'pass',
      label: '没有占位符、内部标记',
      detail: residue.length > 0 ? residue.map(({ v }) => v.detail).join('；') : '没有',
    },
  ]
}

/** 金额必须出自所写团的团目录价格；带金额的句子必须写清价格口径。 */
function priceCheck(i: FollowUpCheckInput, facts: RenderFacts | null): CheckLine {
  const amounts = extractAmounts(i.letter)
  const known = new Set(facts && i.picks.length > 0 ? publishedToursProvider.knownAmounts(facts) : [])
  const unknown = amounts.filter((a) => !known.has(a))
  const phrases = i.config.priceBasisPhrases
  const missingBasis =
    phrases.length === 0
      ? []
      : sentences(i.letter).filter((s) => extractAmounts(s).length > 0 && !phrases.every((p) => s.toLowerCase().includes(p.toLowerCase())))
  let detail = '全部出自团目录，口径写清了'
  if (amounts.length === 0) detail = '信里没有写价格'
  else if (unknown.length > 0) detail = `团目录里找不到这些金额：${unknown.join('、')}`
  else if (missingBasis.length > 0) detail = `这几句缺「${phrases.join('、')}」：${missingBasis.map((s) => clip(s, 60)).join('；')}`
  return {
    id: 'prices',
    status: unknown.length > 0 || missingBasis.length > 0 ? 'fail' : 'pass',
    label: '价格出自团目录、写清价格口径',
    detail,
  }
}

/** 写到的日期必须是所写团的班期。 */
function dateCheck(i: FollowUpCheckInput): CheckLine {
  const allowed = new Set<string>()
  for (const p of i.picks) for (const d of p.tour.departures) allowed.add(d.displayDate.toLowerCase())
  const dates = i.letter.match(new RegExp(`\\b\\d{1,2} (?:${MONTHS}) \\d{4}\\b`, 'g')) ?? []
  const bad = dates.filter((d) => !allowed.has(d.toLowerCase()))
  return {
    id: 'dates',
    status: bad.length > 0 ? 'fail' : 'pass',
    label: '日期是团目录里的班期',
    detail: dates.length === 0 ? '信里没有写日期' : bad.length > 0 ? `团目录里没有这些班期：${bad.join('、')}` : '全部对得上',
  }
}

function starCheck(i: FollowUpCheckInput): CheckLine {
  const stars = i.letter.match(/\b\d\s*(?:[-–]\s*\d\s*)?-?\s*star\b|\bfive[-\s]star\b|\bfour[-\s]star\b/gi) ?? []
  return {
    id: 'stars',
    status: stars.length > 0 ? 'fail' : 'pass',
    label: '没写酒店星级',
    detail: stars.length > 0 ? `写了：${stars.join('、')}` : '没有',
  }
}

function lengthCheck(i: FollowUpCheckInput): CheckLine {
  const n = words(i.aiBody)
  return {
    id: 'length',
    status: n > i.config.maxWords ? 'warn' : 'pass',
    label: `长度（正文不超过 ${i.config.maxWords} 词）`,
    detail: `${n} 词`,
  }
}

function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "China Discovery — Best of China" → "Best of China": the name a letter would use. */
function shortName(name: string): string {
  const parts = name.split(/\s[—–-]\s/)
  return (parts[parts.length - 1] ?? name).trim() || name.trim()
}

/**
 * The letter must not offer a tour that is off sale. The link checks only see links; this one reads the words:
 * a tour of the client's catalogue, named in the letter by its short name (two words or more, with its capitals),
 * that is inactive or sold out. Found 2026-11-28: a draft offered a tour that had been taken off sale.
 */
function offSaleTourCheck(i: FollowUpCheckInput): CheckLine {
  const text = `${i.subject}\n${i.aiBody}`
  const onSale = new Set(i.tours.filter((t) => t.isActive && !t.soldOut).map((t) => shortName(t.name).toLowerCase()))
  const hits = new Set<string>()
  for (const t of i.tours) {
    if (t.isActive && !t.soldOut) continue
    const name = shortName(t.name)
    // The same short name can belong to a tour that is on sale (another tier): then the words are fine.
    if (name.split(/\s+/).length < 2 || onSale.has(name.toLowerCase())) continue
    if (new RegExp(`(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`).test(text)) hits.add(name)
  }
  return {
    id: 'off_sale_tour',
    status: hits.size > 0 ? 'fail' : 'pass',
    label: '信里提到的团都在售',
    detail: hits.size > 0 ? `提到了已下架或售完的团：${Array.from(hits).join('、')}。删掉或换成在售的团再发` : '没提到下架的团',
  }
}

/** Phrases that tell the guest we talked. Written broadly on purpose: a false alarm costs a glance, a miss costs our word. */
const CONVERSATION_CLAIM_RE = /\b(when we (spoke|talked|chatted)|as (we )?discussed|(our|your) (call|phone call|conversation|chat)|(spoke|talked|chatted) (with|to) you|(on|over) the phone|you (mentioned|told us|said)|great (speaking|talking|chatting)|(lovely|nice|good) (to (speak|talk|chat)|speaking|talking|chatting))\b/i

/**
 * The letter must not say "when we spoke" to a guest nobody reached. This is the mistake that took three review
 * rounds to clear from the hand-written reconnect letters of 2026-11-28 (16 of 58): a voicemail or a call of a
 * few seconds is on record as a call, and the letter turned it into a conversation.
 */
function conversationClaimCheck(i: FollowUpCheckInput): CheckLine[] {
  if (i.spokeWithGuest === undefined) return []
  const hit = `${i.subject}\n${i.aiBody}`.match(CONVERSATION_CLAIM_RE)
  const label = '没通上话就不说「我们通话时」'
  if (!hit) return [{ id: 'conversation_claim', status: 'pass', label, detail: i.spokeWithGuest ? '记录里通过话，信里没提也没问题' : '记录里没通上话，信里也没说通过话' }]
  if (i.spokeWithGuest) return [{ id: 'conversation_claim', status: 'pass', label, detail: `信里提到通话（"${clip(hit[0], 40)}"），记录里确实通过话` }]
  return [{ id: 'conversation_claim', status: 'fail', label, detail: `信里写了 "${clip(hit[0], 40)}"，但记录里没有一通电话真的接通（都是没接或语音信箱）。改掉这句再发` }]
}

function repeatCheck(i: FollowUpCheckInput): CheckLine {
  const sameSubject = i.previousSubjects.some((s) => s.trim().toLowerCase() === i.subject.trim().toLowerCase())
  const mine = ngrams(i.aiBody)
  let worst = 0
  for (const excerpt of i.previousExcerpts) {
    const theirs = ngrams(excerpt)
    if (theirs.size === 0) continue
    let shared = 0
    for (const g of theirs) if (mine.has(g)) shared += 1
    worst = Math.max(worst, shared / theirs.size)
  }
  let detail = `比了 ${i.previousSubjects.length} 个旧主题、${i.previousExcerpts.length} 封员工信摘录（群发信的正文系统里没存，比不了）`
  if (sameSubject) detail = '主题和以前发过的一封一样'
  else if (worst >= REPEAT_OVERLAP) detail = `和员工以前的一封信有 ${Math.round(worst * 100)}% 的句子重合`
  return {
    id: 'repeat',
    status: sameSubject || worst >= REPEAT_OVERLAP ? 'warn' : 'pass',
    label: '和以前发给 TA 的信不重复',
    detail,
  }
}

function spellingCheck(i: FollowUpCheckInput): CheckLine {
  const cjk = /[㐀-鿿]/.test(i.subject + i.aiBody)
  const us = (`${i.subject}\n${i.aiBody}`.match(/\b(catalog|catalogs|traveling|traveler|color|center|favorite|inquiry|inquiries)\b/gi) ?? []).map((w) => w.toLowerCase())
  return {
    id: 'spelling',
    status: cjk ? 'fail' : us.length > 0 ? 'warn' : 'pass',
    label: '英文、澳新拼写',
    detail: cjk ? '主题或正文里有中文' : us.length > 0 ? `美式拼写：${Array.from(new Set(us)).join('、')}` : '没问题',
  }
}

export function runFollowUpChecks(i: FollowUpCheckInput): CheckLine[] {
  const facts = factsFor(i)
  return [
    ...gateChecks(i, facts),
    priceCheck(i, facts),
    dateCheck(i),
    starCheck(i),
    lengthCheck(i),
    repeatCheck(i),
    ...conversationClaimCheck(i),
    offSaleTourCheck(i),
    spellingCheck(i),
    {
      id: 'framing',
      status: 'pass',
      label: '问候和署名由系统按客户配置加上',
      detail: i.strippedFraming ? 'AI 自己写了问候或落款，已去掉，换成配置里的' : '是',
    },
  ]
}
