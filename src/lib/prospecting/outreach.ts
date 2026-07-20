/**
 * Outreach email generation — Step 5 of the outbound pipeline.
 *
 * Reference: ROADMAP.md Phase 35 P35.6.
 *
 * One short Strategy Engine call turns an analyzed prospect's evidence
 * (email hook, top problems, four-pillar scorecard, segment) into a
 * ready-to-review cold email. The email NEVER goes out automatically —
 * a human approves every send from the review queue (80/20 rule).
 *
 * Compliance (AU Spam Act 2003 / NZ UEM Act 2007): every email carries a
 * fixed footer with the sender's real identity, why the recipient is
 * receiving it, and a working opt-out. The footer is code, not AI output,
 * so it cannot be "creatively" dropped.
 */

import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import type { ProspectAnalysis } from './analyze'
import type { ProspectSegment } from './segment'
import type { LeakReport } from './report'

export interface OutreachEmail {
  subject:      string
  /** Body text WITHOUT the compliance footer (appended at copy/send time). */
  body:         string
  /** Which pitch angle produced this draft. */
  angle:        ProspectSegment
  generated_at: string
  /** true once a human has edited the draft in the review queue. */
  edited?:      boolean
}

export interface OutreachInput {
  business_name: string
  industry:      string
  city:          string
  country:       string
  domain:        string | null
  rating:        number | null
  review_count:  number | null
  ai_report:     ProspectAnalysis
  /**
   * Lead-leakage report (report.ts). When present, its customer-phrased
   * summary_points become the email's evidence — the same "where enquiries
   * leak" findings the recipient sees on the full report page, so the cold
   * email and the report tell one consistent story.
   */
  leak_report?:  LeakReport
}

// ─── Compliance footer (fixed, never AI-generated) ────────────────────────────

/** Sender identity for the outreach signature; configured per deployment. */
export function senderIdentity(): { name: string; firstName: string; company: string; website: string; configured: boolean } {
  const name = process.env.OUTREACH_SENDER_NAME ?? 'Big Ray Deng'
  // First name for the in-body intro ("I'm Big Ray from Magic Engine").
  // Overridable because a naive first-token split mis-picks it for names like
  // "Big Ray Deng" (→ "Big"); the built-in default pairs the full name with
  // "Big Ray".
  const firstName = process.env.OUTREACH_SENDER_FIRST_NAME
    ?? (process.env.OUTREACH_SENDER_NAME ? name.split(/\s+/)[0] : 'Big Ray')
  return {
    name,
    firstName,
    company: process.env.OUTREACH_SENDER_COMPANY ?? 'Magic Engine · New Zealand',
    website: process.env.OUTREACH_WEBSITE ?? 'magicengine.cloud',
    // A "The X Team" signature reads as bulk mail — the console warns until a
    // real person's name signs the outreach.
    configured: name !== 'The Magic Engine Team',
  }
}

/**
 * AU Spam Act / NZ UEM required elements: who we are, why you got this,
 * and how to opt out — phrased like a person, not a disclaimer (板桥 P1-1).
 * `{{business_name}}` and `{{unsubscribe_url}}` are substituted per prospect at
 * render/copy time. The opt-out is backed by the `opted_out` terminal status:
 * those rows never re-enter the queue and discover-dedup blocks re-import.
 * Offers both a one-click unsubscribe link (honoured instantly by the
 * /unsubscribe page) and a plain reply, so the recipient always has a
 * frictionless way out. Opens with "Cheers," so the body flows into a natural
 * sign-off instead of a name appearing out of nowhere (PM feedback 2026-07-07).
 */
export function complianceFooter(businessName = '{{business_name}}'): string {
  const { name, company, website } = senderIdentity()
  return [
    'Cheers,',
    name,
    company,
    website,
    '',
    `We came across ${businessName} through your public Google Business listing — this is a one-off note, ` +
    `not a mailing list. If it's not for you, unsubscribe here: {{unsubscribe_url}} — or just reply "no thanks". ` +
    `Either way, you won't hear from us again.`,
  ].join('\n')
}

/**
 * Assemble the full outreach email body actually sent: the approved draft, the
 * one-line report link, then the compliance footer with the business name and
 * one-click unsubscribe URL substituted. Single source of truth so the admin
 * send path and the manual copy path produce byte-identical emails.
 */
export function renderFullOutreachBody(params: {
  draftBody: string
  businessName: string
  reportUrl: string
  unsubscribeUrl: string
}): string {
  // Function replacer: substitute literally so a `$` in the URL is never read
  // as a replace pattern, matching the queue UI's footerFor (魏征).
  const footer = complianceFooter(params.businessName)
    .replace(/\{\{unsubscribe_url\}\}/g, () => params.unsubscribeUrl)
  return (
    `${params.draftBody.trim()}\n\n` +
    `Here's the full rundown on one page — no login, nothing to download, just a web page:\n${params.reportUrl}\n\n` +
    footer
  )
}

// ─── Angle briefs per segment ─────────────────────────────────────────────────

const ANGLE_BRIEFS: Record<ProspectSegment, string> = {
  core_target:
    'Lead with their strong reputation, then the gap: a business this good deserves an online ' +
    'setup that works as hard as they do. Mention 2-3 of the concrete problems briefly.',
  blind_flyer:
    'Lead with "flying blind": they run a solid business but have no way to see where enquiries ' +
    'come from or what their website traffic does. Focus on measurement, not redesign.',
  social_gap:
    'Lead with their quiet social presence: customers check Facebook/Instagram before calling, ' +
    'and an inactive page reads as a closed business. Mention the ready-to-post content angle.',
  general:
    'Lead with the free digital health check finding a few things worth fixing. Keep it broad and light.',
}

// ─── Generation ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You write short cold-outreach emails for Magic Engine, a New Zealand digital upgrade service for local businesses. Rules:
- New Zealand English. Warm, plain, tradie-friendly. No marketing buzzwords (avoid "digital presence", "leverage", "solutions"), no exclamation marks, no emoji.
- 110-160 words body. Short paragraphs. At most one bulleted list of 2-3 findings.
- Structure, strictly in this order:
  1. Greeting on its own line: "Hi {owner first name}," if provided, otherwise "Hi there,".
  2. Introduce yourself and why you're writing BEFORE any findings, in one or two lines: the sender (first name, from Magic Engine, a New Zealand team) is taking on the first 100 New Zealand local businesses this year at founding pricing, and while shortlisting businesses in their trade ran a free digital health check on theirs. The reader must know who is talking and why before hearing anything about their business — otherwise it feels like surveillance.
  3. One warm line acknowledging their strong reputation (use the HOOK, lightly smoothed).
  4. 2-3 findings from EVIDENCE.
  5. Soft close: a no-pressure line and one question they can answer with a single word. Do NOT write a sign-off or name — it is appended separately.
- Every factual claim must come from the EVIDENCE section — never invent numbers, tools, or findings. You may lightly reword an evidence line for flow, but keep every business name, competitor name, and number exactly as written.
- Never promise or imply any outcome — rankings, leads, enquiries, calls, customers, growth, or revenue. State findings only; let the reader draw their own conclusions.
- Never reveal that WE used AI or automated tools to research them — say "we had a look at". You MAY mention that customers use tools like ChatGPT to find businesses; that is a fact about the market, not about us, and you may add one plain-language line like "more and more people ask ChatGPT instead of Googling these days".
- Subject line: under 60 characters, specific and honest, mentions their business or trade, no clickbait, sentence case.
Respond with a single JSON object, no markdown: {"subject": string, "body": string}`

const TITLE_WORDS = new Set(['mr', 'mrs', 'ms', 'dr', 'dr.', 'director', 'owner', 'founder', 'manager'])

/**
 * Exported for tests. Guard against a mis-scraped owner name (staff member,
 * previous owner, full name with title) — opening with the WRONG name is far
 * worse than no name (板桥 P1-5). Keeps only a plausible first name; anything
 * doubtful becomes null.
 */
export function sanitiseOwnerName(raw: string | null | undefined, businessName: string): string | null {
  if (!raw) return null
  const tokens = raw.toLowerCase().replace(/[^a-z\- ]/g, ' ').split(/\s+/)
    .filter(Boolean).filter(t => !TITLE_WORDS.has(t))
  const first = tokens[0]
  if (!first || first.length < 2 || first.length > 15) return null
  // A "name" that is part of the business name is almost certainly the brand.
  const bizWords = new Set(businessName.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/))
  if (bizWords.has(first)) return null
  return first[0].toUpperCase() + first.slice(1)
}

/** Exported for tests. */
export function validateOutreachJson(raw: unknown): { subject: string; body: string } {
  const obj = raw as { subject?: unknown; body?: unknown } | null
  if (!obj || typeof obj !== 'object') throw new Error('outreach: not an object')
  if (typeof obj.subject !== 'string' || !obj.subject.trim()) throw new Error('outreach: subject missing')
  if (typeof obj.body !== 'string' || obj.body.trim().length < 40) throw new Error('outreach: body missing or too short')
  return { subject: obj.subject.trim().slice(0, 120), body: obj.body.trim() }
}

/** Exported for tests. */
export function buildOutreachPrompt(input: OutreachInput): string {
  const r = input.ai_report
  const city = input.city.replace(/_/g, ' ')
  const trade = input.industry.replace(/_/g, ' ')
  const identity = senderIdentity()
  const senderFirst = identity.configured ? identity.firstName : 'the team'
  const hook = r.email_hook ||
    `You've clearly built a solid reputation in ${city} — ${input.review_count ?? 'that many'} reviews at ${input.rating ?? '—'}★ doesn't happen by accident.`

  // Preferred path: the lead-leakage report's customer-phrased findings, so
  // the cold email and the full report page tell one consistent story. Its
  // summary_points already fold in AI-search, social, contact and tracking
  // evidence — no need to re-list them piecemeal.
  const leaks = input.leak_report?.summary_points ?? []
  if (leaks.length) {
    return [
      'ANGLE: Lead with where enquiries are quietly slipping away — this business gets found but loses ready customers before they get in touch. Warm and concrete, not alarmist. Frame it as things worth a quick look, not failures.',
      `BUSINESS: ${input.business_name} — ${trade} in ${city}, ${input.country}`,
      `OWNER FIRST NAME: ${sanitiseOwnerName(r.owner_name, input.business_name) ?? 'unknown'}`,
      `SENDER FIRST NAME: ${senderFirst}`,
      `HOOK SENTENCE: ${hook}`,
      'EVIDENCE — where enquiries may be leaking (use 2-3, keep names and numbers exact):',
      ...leaks.map(p => `- ${p}`),
    ].join('\n')
  }

  // Fallback (no leak report): the original evidence assembly.
  return [
    `ANGLE: ${ANGLE_BRIEFS[r.segment] ?? ANGLE_BRIEFS.general}`,
    `BUSINESS: ${input.business_name} — ${trade} in ${city}, ${input.country}`,
    `OWNER FIRST NAME: ${sanitiseOwnerName(r.owner_name, input.business_name) ?? 'unknown'}`,
    `SENDER FIRST NAME: ${senderFirst}`,
    `HOOK SENTENCE: ${hook}`,
    `EVIDENCE — problems we can name:`,
    ...(r.top_problems.length ? r.top_problems.map(p => `- ${p}`) : ['- (none — keep the email generic and lead with the free report)']),
    // Time-boxed, defensible phrasing: "when we asked … didn't get a mention"
    // — never the absolute "does not come up", which the owner can disprove
    // with one lucky ChatGPT answer (板桥 P1-4).
    r.geo_probe && !r.geo_probe.mentioned
      ? `EVIDENCE — AI search: when we asked ChatGPT for a ${trade} in ${city}, ${input.business_name} didn't get a mention${r.geo_probe.competitors_mentioned.length ? ` (competitors like ${r.geo_probe.competitors_mentioned[0]} did)` : ''}.`
      : '',
    r.social_activity && r.social_activity.posts_last_30d === 0
      ? `EVIDENCE — social: their ${r.social_activity.platform} page has had no posts in the last 30 days.`
      : '',
  ].filter(Boolean).join('\n')
}

/**
 * Generate one outreach draft. Throws on failure — the caller keeps the
 * prospect in `analyzed` so generation can simply be retried (single cheap
 * call, no upstream spend to protect).
 */
export async function generateOutreachEmail(input: OutreachInput): Promise<OutreachEmail> {
  const result = await callClaudeChat({
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildOutreachPrompt(input) }],
    maxOutputTokens: 800,
  })
  const parsed = validateOutreachJson(parseJsonResponse<unknown>(result.text))

  return {
    subject: parsed.subject,
    body: parsed.body,
    angle: input.ai_report.segment,
    generated_at: new Date().toISOString(),
  }
}
