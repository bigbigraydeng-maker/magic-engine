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
}

// ─── Compliance footer (fixed, never AI-generated) ────────────────────────────

/** Sender identity for the outreach signature; configured per deployment. */
export function senderIdentity(): { name: string; company: string } {
  return {
    name:    process.env.OUTREACH_SENDER_NAME ?? 'The Magic Engine Team',
    company: process.env.OUTREACH_SENDER_COMPANY ?? 'Magic Engine — Business Digital Upgrade',
  }
}

/**
 * AU Spam Act / NZ UEM required elements: who we are, why you got this,
 * and how to opt out. `{{unsubscribe_url}}` is substituted by the sending
 * channel; while sends are manual copy-paste, the literal reply-to-opt-out
 * sentence still satisfies the requirement.
 */
export function complianceFooter(): string {
  const { name, company } = senderIdentity()
  return [
    '—',
    `${name}`,
    `${company}`,
    `You're receiving this one-off note because your business contact details are publicly listed. ` +
    `If you'd rather not hear from us, just reply "unsubscribe" and we won't contact you again.`,
  ].join('\n')
}

// ─── Angle briefs per segment ─────────────────────────────────────────────────

const ANGLE_BRIEFS: Record<ProspectSegment, string> = {
  core_target:
    'Lead with their strong reputation, then the gap: a business this good deserves a digital ' +
    'presence that matches. Mention 2-3 of the concrete problems briefly.',
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

const SYSTEM_PROMPT = `You write short cold-outreach emails for Magic Engine, a digital upgrade service for Australian and New Zealand local businesses. Rules:
- Australian English. Warm, plain, tradie-friendly. No marketing buzzwords, no exclamation marks, no emoji.
- 90-130 words body. Short paragraphs. At most one bulleted list of 2-3 findings.
- Every factual claim must come from the EVIDENCE section verbatim in spirit — never invent numbers, tools, or findings.
- Open with the provided hook sentence (you may lightly smooth it). Address the owner by first name if provided, otherwise no name.
- Close with a soft, no-pressure offer of the free full report and one question they can answer with a single word.
- Never promise rankings, leads, or revenue. Never mention AI, scans, or automated tools — say "we had a look at".
- Subject line: under 60 characters, specific and honest, mentions their business or trade, no clickbait, sentence case.
- Do NOT add a signature or footer — it is appended separately.
Respond with a single JSON object, no markdown: {"subject": string, "body": string}`

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
  return [
    `ANGLE: ${ANGLE_BRIEFS[r.segment] ?? ANGLE_BRIEFS.general}`,
    `BUSINESS: ${input.business_name} — ${input.industry.replace(/_/g, ' ')} in ${input.city.replace(/_/g, ' ')}, ${input.country}`,
    `OWNER FIRST NAME: ${r.owner_name ?? 'unknown'}`,
    `HOOK SENTENCE: ${r.email_hook || `Your Google reviews (${input.rating ?? '—'}★ from ${input.review_count ?? '—'} customers) speak for themselves.`}`,
    `EVIDENCE — problems we can name:`,
    ...(r.top_problems.length ? r.top_problems.map(p => `- ${p}`) : ['- (none — keep the email generic and lead with the free report)']),
    r.geo_probe && !r.geo_probe.mentioned
      ? `EVIDENCE — AI search: when people ask AI assistants for a ${input.industry.replace(/_/g, ' ')} in ${input.city.replace(/_/g, ' ')}, ${input.business_name} does not come up${r.geo_probe.competitors_mentioned.length ? ` (competitors like ${r.geo_probe.competitors_mentioned[0]} do)` : ''}.`
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
