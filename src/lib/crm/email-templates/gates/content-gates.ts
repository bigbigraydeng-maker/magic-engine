import type { EmailSettings } from '../types'
import type { FactProvider, RenderFacts, LinkViolation } from '../facts/types'
import type { GateViolation, ContentGateResult } from './types'
import { extractAmounts } from '../amounts'
import { normalizeForCheck, normalizeForLinks } from './normalize'

export interface ContentGateInput {
  subject: string
  body: string
  footer: string | null
  settings: Pick<EmailSettings, 'guardrails'>
  provider: FactProvider | null
  facts: RenderFacts | null
}

// Keywords that mark a bracketed note as an unfinished internal marker. The bare word "confirm" is NOT one:
// "(please confirm your passport details)" is a normal sentence.
const RESIDUE_KEYWORDS = [
  'to confirm',
  'to be confirmed',
  'tbc',
  'tbd',
  'todo',
  'placeholder',
  '待确认',
  '待补充',
]

const RESIDUE_PATTERNS: RegExp[] = [
  /\{\{/g,
  /\}\}/g,
  /\{[A-Za-z_][A-Za-z0-9_.]*(?::\d+)?\}/g,
  /\*\|[A-Za-z0-9_]+\|\*/g,
  /\[[^\]\n]{0,80}\]/g,
  /\([^)\n]{0,80}\)/g,
  /\bTBC\b/gi,
  /\bTBD\b/gi,
  // Chinese internal markers are never legitimate in a guest email, bracketed or not
  /待确认/g,
  /待补充/g,
]

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
// A URL ends at the first character that cannot be part of a URL: a Chinese full stop or the Chinese text after a
// link is not "the path" (and a mail client does not link it either).
const URL_CHARS = "A-Za-z0-9\\-._~:/?#@!$&*+,;=%\\[\\]"
const URL_HTTP_RE = new RegExp(`https?://[${URL_CHARS}]+`, 'gi')
const URL_WWW_RE = new RegExp(`www\\.[${URL_CHARS}]+`, 'gi')
// Bare domains are only recognised under the TLDs listed here: a list, not "anything with a dot", so ordinary
// text ("e.g.", "10.30am", "Mr.Lee") is not flagged. Common English words that are also TLDs (it, in, at, no, so...) are left out.
const BARE_TLDS =
  'com|net|org|nz|au|uk|us|ca|cn|hk|sg|jp|kr|io|co|info|biz|me|app|dev|xyz|site|online|travel|tours|shop|store|link|ly|gl|be|to|' +
  'de|fr|es|nl|ru|top|club|vip|cc|tv|ws|mobi|pro|tw|vn|ph|br|mx|ch|se|dk|fi|pl|cz|tr|ae|za|ie|pt|gr|hu|ro|ua|il|' +
  'tech|art|fun|live|life|world|today|click|cloud|website|space|host|work|ltd|group|agency|news|email|ga|tk|ml|cf|gq|pw|su|zip|mov'
const BARE_DOMAIN_RE = new RegExp(
  `(?<![a-z0-9@./-])(?:[a-z0-9-]+\\.)+(?:${BARE_TLDS})(?![a-z0-9-])(?:[/?#][${URL_CHARS}]*)?`,
  'gi',
)

const TRAILING_PUNCT_RE = /[.,;:!?)]+$/

function composedText(input: ContentGateInput): string {
  const parts = [input.subject, input.body]
  if (input.footer) parts.push(input.footer)
  return parts.join('\n')
}

function containsResidueKeyword(text: string): boolean {
  const lower = text.toLowerCase()
  return RESIDUE_KEYWORDS.some((kw) => lower.includes(kw))
}

function isBracketedResidue(match: string): boolean {
  const inner = match.slice(1, -1)
  return containsResidueKeyword(inner)
}

export function findResidueMarkers(rawText: string): GateViolation[] {
  const seen = new Set<string>()
  const out: GateViolation[] = []
  for (const pattern of RESIDUE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags)
    for (const match of rawText.matchAll(re)) {
      const text = match[0]
      // Anything in square brackets that has a letter in it is a leftover ("[Name]", "[insert price]");
      // round brackets are ordinary prose, so they need a leftover keyword inside.
      if (text.startsWith('[')) {
        if (!/[\p{L}]/u.test(text)) continue
      } else if (text.startsWith('(')) {
        if (!isBracketedResidue(text)) continue
      }
      if (seen.has(text)) continue
      seen.add(text)
      out.push({
        code: 'placeholder_left',
        detail: text.length > 60 ? text.slice(0, 60) : text,
      })
    }
  }
  return out
}

function stripTrailingPunct(candidate: string): string {
  return candidate.replace(TRAILING_PUNCT_RE, '')
}

function toFullUrl(candidate: string): string {
  if (/^https?:\/\//i.test(candidate)) return candidate
  return `https://${candidate}`
}

export function extractLinks(normalizedText: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (candidate: string): void => {
    const cleaned = stripTrailingPunct(candidate)
    if (cleaned === '') return
    const full = toFullUrl(cleaned)
    if (seen.has(full)) return
    seen.add(full)
    out.push(full)
  }
  // Full URLs first: "https://user@example.com" must not be mistaken for an email address and swallowed.
  let rest = normalizedText
  for (const pattern of [URL_HTTP_RE, URL_WWW_RE]) {
    rest = rest.replace(new RegExp(pattern.source, pattern.flags), (match) => {
      add(match)
      return ' '
    })
  }
  rest = rest.replace(EMAIL_RE, ' ')
  for (const match of rest.matchAll(new RegExp(BARE_DOMAIN_RE.source, BARE_DOMAIN_RE.flags))) {
    add(match[0])
  }
  return out
}

interface ParsedUrl {
  scheme: string
  authority: string
  host: string
  hasUserinfo: boolean
  hasEncodedAuthority: boolean
}

function parseUrl(url: string): ParsedUrl | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url)
  if (!match) return null
  const scheme = match[1].toLowerCase()
  const authority = match[2]
  const hasUserinfo = authority.includes('@')
  const hostPart = hasUserinfo ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  const hostNoPort = hostPart.replace(/:\d+$/, '')
  const host = hostNoPort.toLowerCase().replace(/\.+$/, '')
  return { scheme, authority, host, hasUserinfo, hasEncodedAuthority: authority.includes('%') }
}

function checkLink(url: string, allowedHosts: readonly string[]): GateViolation[] {
  const parsed = parseUrl(url)
  if (!parsed) return []
  const out: GateViolation[] = []
  if (parsed.scheme === 'http') {
    out.push({ code: 'link_not_https', detail: url })
  }
  if (parsed.hasUserinfo) {
    out.push({ code: 'link_userinfo', detail: url })
  }
  // A real host never contains %: "good.example%2F@evil.com" is a link to evil.com wearing a trusted name.
  if (parsed.hasEncodedAuthority) {
    out.push({ code: 'link_host_not_allowed', detail: 'encoded host' })
  }
  const allowed = allowedHosts.map((h) => h.toLowerCase().replace(/\.+$/, ''))
  if (!allowed.includes(parsed.host)) {
    out.push({ code: 'link_host_not_allowed', detail: parsed.host })
  }
  return out
}

function checkLinks(
  composed: string,
  settings: Pick<EmailSettings, 'guardrails'>,
  provider: FactProvider | null,
  facts: RenderFacts | null,
): GateViolation[] {
  const urls = extractLinks(normalizeForLinks(composed))
  const out: GateViolation[] = []
  const allowedHosts = settings.guardrails.allowedLinkHosts
  for (const url of urls) {
    out.push(...checkLink(url, allowedHosts))
  }
  if (provider && facts) {
    const providerViolations: LinkViolation[] = provider.checkLinks(urls, facts)
    for (const v of providerViolations) {
      out.push({ code: v.code, detail: v.detail })
    }
  }
  return out
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function checkPhrases(
  normalizedComposed: string,
  settings: Pick<EmailSettings, 'guardrails'>,
): { blocks: GateViolation[]; warnings: GateViolation[] } {
  const blocks: GateViolation[] = []
  const warnings: GateViolation[] = []
  for (const rule of settings.guardrails.rules) {
    let hit = false
    for (const phrase of rule.phrases) {
      const normalizedPhrase = normalizeForCheck(phrase)
      if (normalizedPhrase === '') continue
      const re = new RegExp(
        `(?<![a-z0-9])${escapeRegex(normalizedPhrase)}(?![a-z0-9])`,
      )
      if (re.test(normalizedComposed)) {
        hit = true
        break
      }
    }
    if (!hit) continue
    const violation: GateViolation = {
      code: rule.severity === 'block' ? 'content_blocked' : 'content_warning',
      detail: rule.message,
      ruleId: rule.id,
    }
    if (rule.severity === 'block') blocks.push(violation)
    else warnings.push(violation)
  }
  return { blocks, warnings }
}

function checkAmounts(
  composed: string,
  provider: FactProvider | null,
  facts: RenderFacts | null,
): GateViolation[] {
  if (!provider || !facts) return []
  if (facts.picks.length === 0) return []
  const known = new Set(provider.knownAmounts(facts))
  const amounts = extractAmounts(composed)
  const unknown: string[] = []
  for (const amount of amounts) {
    if (!known.has(amount) && !unknown.includes(amount)) unknown.push(amount)
  }
  if (unknown.length === 0) return []
  return [
    {
      code: 'amount_not_in_catalog',
      detail: unknown.join(', '),
    },
  ]
}

export function evaluateContentGates(input: ContentGateInput): ContentGateResult {
  const composed = composedText(input)
  const blocks: GateViolation[] = []
  const warnings: GateViolation[] = []

  blocks.push(...findResidueMarkers(composed))
  blocks.push(...checkLinks(composed, input.settings, input.provider, input.facts))

  const normalizedComposed = normalizeForCheck(composed)
  const phraseResult = checkPhrases(normalizedComposed, input.settings)
  blocks.push(...phraseResult.blocks)
  warnings.push(...phraseResult.warnings)

  warnings.push(...checkAmounts(composed, input.provider, input.facts))

  return { blocks, warnings }
}
