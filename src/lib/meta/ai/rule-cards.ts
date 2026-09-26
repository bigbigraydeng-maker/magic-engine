/**
 * 卡片需要的每个字由服务器拼好，页面只显示字符串；正文替换找不准就不动
 * （设计 docs/specs/2026-09-27-magic-bridge-rule-cards-design.md v2，
 * 子牙 S1/S3、魏征 B1、板桥）。
 */

import {
  CTR_EXPLAINER,
  RULE_SECTION_TITLE,
  formatDay,
  renderRuleSection,
  shiftDay,
  type RuleSectionInput,
} from '@/lib/ads-strategy/rules/client-copy'

export interface RuleCard {
  adLabel: string
  headline: string
  detail: string
  action: string
}

export interface RuleCards {
  title: string
  intro: string
  promise: string
  cards: RuleCard[]
  bodyReplaced: boolean
}

interface ValidFinding {
  kind: 'post_click_drop' | 'fatigue'
  adName: string
  headline: string
  detail: string
  action: string
  spend: number
  explainsCtr: boolean
}

interface ValidSection {
  dataDate: string
  adsChecked: number
  findings: ValidFinding[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_SUFFIX_RE = /（数据截至[^）]*）$/

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function validFinding(v: unknown): ValidFinding | null {
  if (typeof v !== 'object' || v === null) return null
  const f = v as Record<string, unknown>
  if (f.kind !== 'post_click_drop' && f.kind !== 'fatigue') return null
  if (!isNonEmptyString(f.adName)) return null
  if (!isNonEmptyString(f.headline)) return null
  if (!isNonEmptyString(f.detail)) return null
  if (!isNonEmptyString(f.action)) return null
  if (!isFiniteNumber(f.spend)) return null
  if (typeof f.explainsCtr !== 'boolean') return null
  return {
    kind: f.kind,
    adName: f.adName,
    headline: f.headline,
    detail: f.detail,
    action: f.action,
    spend: f.spend,
    explainsCtr: f.explainsCtr,
  }
}

function validSection(ruleSection: unknown): ValidSection | null {
  if (typeof ruleSection !== 'object' || ruleSection === null) return null
  const s = ruleSection as Record<string, unknown>
  if (s.source !== 'patrol') return null
  if (typeof s.dataDate !== 'string' || !DATE_RE.test(s.dataDate)) return null
  if (!Number.isFinite(Date.parse(`${s.dataDate}T00:00:00Z`))) return null
  if (!isFiniteNumber(s.adsChecked) || s.adsChecked < 0) return null
  if (!Array.isArray(s.findings) || s.findings.length === 0) return null
  const findings: ValidFinding[] = []
  for (const raw of s.findings) {
    const f = validFinding(raw)
    if (f === null) return null
    findings.push(f)
  }
  return { dataDate: s.dataDate, adsChecked: s.adsChecked, findings }
}

function adLabelOf(adName: string): string {
  return adName.length > 120 ? `${adName.slice(0, 120)}…` : adName
}

function headlineOf(f: ValidFinding): string {
  let h = f.headline
  const prefix = `「${f.adName}」`
  if (h.startsWith(prefix)) h = h.slice(prefix.length)
  h = h.replace(DATE_SUFFIX_RE, '')
  if (h.startsWith('，')) h = h.slice(1)
  return h.trim()
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count += 1
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

function buildCards(section: ValidSection, today: string): RuleCards {
  const sorted = [...section.findings].sort((a, b) => b.spend - a.spend)
  const n = sorted.length
  let explained = false
  const cards: RuleCard[] = sorted.map((f) => {
    const explainCtr = f.explainsCtr && !explained
    if (explainCtr) explained = true
    return {
      adLabel: adLabelOf(f.adName),
      headline: headlineOf(f),
      detail: explainCtr ? CTR_EXPLAINER + f.detail : f.detail,
      action: f.action,
    }
  })
  const which = n === 1 ? '这条' : `这 ${n} 条`
  const intro =
    section.adsChecked >= n
      ? `这次检查了 ${section.adsChecked} 条正在投放的广告，下面${which}有变化，其余没发现明显变差。`
      : `下面${which}有变化。`
  const review = shiftDay(section.dataDate, 7)
  const promise =
    today <= review
      ? `我们的广告团队已经看到${n === 1 ? '这条' : '这几条'}，会在${formatDay(review)}前后复查并处理，你不用动手。`
      : `这是${formatDay(section.dataDate)}的数据，我们原定${formatDay(review)}前后复查，最新进展可以直接问我们的团队。`
  return {
    title: `我们正在跟进的广告（${n} 条）`,
    intro,
    promise,
    cards,
    bodyReplaced: false,
  }
}

function replaceBody(
  report: string,
  section: ValidSection,
  n: number,
): { report: string; bodyReplaced: boolean } {
  const input: RuleSectionInput = { source: 'patrol', ...section }
  const original = renderRuleSection(input)
  if (countOccurrences(report, original) !== 1) {
    return { report, bodyReplaced: false }
  }
  const which = n === 1 ? '这条' : `这 ${n} 条`
  const replacement = `${RULE_SECTION_TITLE}\n${which}已经放在页面最上方，这里不再重复。`
  const at = report.indexOf(original)
  return { report: report.slice(0, at) + replacement + report.slice(at + original.length), bodyReplaced: true }
}

export function buildRuleCards(
  ruleSection: unknown,
  report: string | null,
  today: string,
): { cards: RuleCards | null; report: string | null } {
  const section = validSection(ruleSection)
  if (section === null) return { cards: null, report }
  const cards = buildCards(section, today)
  if (report === null) return { cards, report: null }
  const replaced = replaceBody(report, section, section.findings.length)
  return { cards: { ...cards, bodyReplaced: replaced.bodyReplaced }, report: replaced.report }
}
