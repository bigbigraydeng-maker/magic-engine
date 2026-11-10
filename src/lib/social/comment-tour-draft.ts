/**
 * Catalog-grounded reply DRAFTS for Facebook comments that ask about a tour.
 *
 * Draft only: nothing here calls Meta. The engine stores the draft on the
 * needs_human row and a person sends it (or not) from the audit list.
 *
 * Three steps, each fail-closed (any doubt means "no draft", the comment stays
 * with a person exactly as before):
 *   1. resolvePostTour — which published tour is the POST about? Only a tour
 *      whose name (or an old name) appears in the post text counts, and only
 *      when exactly one sellable tour matches.
 *   2. requestDraft — the model sees the comment and that tour's published
 *      facts (never prices) and must name the fact lines it used.
 *   3. validateTourDraft — the reply may not carry a price, link or handle;
 *      every number must come from the cited fact lines; durations and dates
 *      are re-checked against the catalog with the social fact checker.
 *
 * Travel-catalog specific on purpose: the generic comment engine only knows
 * "a draft provider"; this file is that provider for clients with a published
 * tour catalog.
 */

import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'
import { getAnthropicClient, MODEL_HAIKU } from '@/lib/anthropic/client'
import { checkFacts } from './weekly-loop/fact-check'
import { nameSuffix } from './weekly-loop/fact-aliases'

export interface PostContext {
  /** Post / ad body text. */
  text: string
  /** Attachment title (ad headline), when the post has one. */
  title: string | null
}

export type TourDraftSkip =
  | 'no_tour_in_post'
  | 'model_error'
  | 'model_unparseable'
  | 'not_answerable'
  | 'draft_rejected'

export type TourDraftResult =
  | { ok: true; reply: string; tourId: string; tourName: string; evidence: string[] }
  | { ok: false; skip: TourDraftSkip; detail?: string }

const MAX_REPLY_CHARS = 500
const MIN_PHRASE_WORDS = 2

// ---------------------------------------------------------------------------
// Step 1: which tour is the post about?
// ---------------------------------------------------------------------------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsWholePhrase(haystack: string, phrase: string): boolean {
  if (phrase.length === 0) return false
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegex(phrase)}(?![A-Za-z0-9])`, 'i').test(haystack)
}

function wordCount(phrase: string): number {
  return phrase.split(/[^A-Za-z0-9']+/).filter((w) => w.length > 0).length
}

/** Names a post may use for this tour: current name/title, their short form, and old names. */
function tourPhrases(tour: PublishedTourFact, aliases: readonly string[]): string[] {
  const raw = [tour.name, tour.title, ...aliases]
  const out = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const full = value.trim()
    if (full.length === 0) continue
    out.add(full)
    const short = nameSuffix(full).trim()
    if (short.length > 0) out.add(short)
  }
  // A one-word short name ("Highlights", "Panorama") is shared between tours
  // and appears in ordinary sentences — it never identifies a tour on its own.
  return Array.from(out).filter((p) => wordCount(p) >= MIN_PHRASE_WORDS)
}

/**
 * The single sellable tour this post names, or null.
 * When several tours match, the longest matched name wins ("Shanghai & Beyond"
 * over a shorter name contained in it); a tie means we do not know.
 */
export function resolvePostTour(
  post: PostContext,
  tours: readonly PublishedTourFact[],
  aliasesByTourId: Readonly<Record<string, string[]>>,
): PublishedTourFact | null {
  const haystack = [post.text, post.title ?? ''].join('\n')
  if (haystack.trim().length === 0) return null

  let best: { tour: PublishedTourFact; length: number } | null = null
  let tied = false
  for (const tour of tours) {
    let longest = 0
    for (const phrase of tourPhrases(tour, aliasesByTourId[tour.id] ?? [])) {
      if (phrase.length > longest && containsWholePhrase(haystack, phrase)) longest = phrase.length
    }
    if (longest === 0) continue
    if (best === null || longest > best.length) {
      best = { tour, length: longest }
      tied = false
    } else if (longest === best.length) {
      tied = true
    }
  }
  if (best === null || tied) return null
  if (!best.tour.isActive || best.tour.soldOut) return null
  return best.tour
}

// ---------------------------------------------------------------------------
// Step 2: facts the model may use
// ---------------------------------------------------------------------------

const MONEY_SHAPE = /[$€£¥]|\b(?:NZD|AUD|USD|CNY|RMB)\b/i

/**
 * The published facts as plain lines. Prices are left out on purpose (a public
 * comment never quotes a price), and so is any line that mentions money.
 */
export function tourFactLines(tour: PublishedTourFact): string[] {
  const lines: string[] = [`Tour name: ${tour.name}`]
  if (typeof tour.durationText === 'string' && tour.durationText.trim().length > 0) {
    lines.push(`Duration: ${tour.durationText.trim()}`)
  }
  for (const h of tour.highlights) lines.push(`Highlight: ${h}`)
  for (const i of tour.inclusions) lines.push(`Included: ${i}`)
  for (const e of tour.exclusions) lines.push(`Not included: ${e}`)
  for (const d of tour.departures) lines.push(`Departure date: ${d.displayDate}`)
  return lines.map((l) => l.trim()).filter((l) => l.length > 0 && !MONEY_SHAPE.test(l))
}

const SYSTEM_PROMPT = `You draft a short public Facebook reply for a tour operator. A person will review it before it is sent.

You are given a customer's comment and a numbered list of FACTS about one tour. Rules:
- Answer ONLY from the FACTS. If the FACTS do not answer the question, set "answerable" to false.
- Questions about price, cost, payment, discounts, single rooms or supplements are NOT answerable. Set "answerable" to false.
- Asking whether something is INCLUDED (flights, airfare, meals, a guide, hotels) is not a price question: answer it from the "Included" / "Not included" facts, without any amount.
- Questions about health, mobility, accessibility, visas, safety or anything not stated in the FACTS are NOT answerable.
- Never state a price or any amount of money. No links. No @mentions. No promises beyond the FACTS.
- Do not add details, adjectives or scope words the FACTS do not state (for example "expert", "throughout", "every", "all").
- 1 to 3 short sentences and under 350 characters in total, plain friendly English (AU/NZ spelling). For an itinerary question name a few stops, not every one. You may start with the customer's first name if given.
- State the fact and stop. No sales talk, no closing invitation.
- "evidence" must list the fact numbers you relied on.

Return JSON only:
{"answerable":true|false,"reply":"..."|null,"evidence":[1,2]}`

interface ModelDraft {
  answerable: boolean
  reply: string | null
  evidence: number[]
}

export function parseModelDraft(raw: string): ModelDraft | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    if (typeof obj.answerable !== 'boolean') return null
    const evidence = Array.isArray(obj.evidence)
      ? obj.evidence.filter((n): n is number => typeof n === 'number' && Number.isInteger(n))
      : []
    return {
      answerable: obj.answerable,
      reply: typeof obj.reply === 'string' ? obj.reply.trim() : null,
      evidence,
    }
  } catch {
    return null
  }
}

export function buildDraftPrompt(commentText: string, authorFirstName: string | undefined, facts: readonly string[]): string {
  const numbered = facts.map((f, i) => `${i + 1}. ${f}`).join('\n')
  const who = authorFirstName ? `Customer first name: ${authorFirstName}\n` : ''
  return `${who}Customer comment:\n"""\n${commentText.slice(0, 600)}\n"""\n\nFACTS:\n${numbered}`
}

// ---------------------------------------------------------------------------
// Step 3: validate the draft
// ---------------------------------------------------------------------------

const LINK_OR_HANDLE = /https?:\/\/|www\.|@|\b[a-z0-9-]+\.(?:com|co\.nz|com\.au|nz|au|org|net)\b/i

function numbersIn(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*/g) ?? []
}

export type DraftValidation = { ok: true } | { ok: false; reason: string }

/**
 * Reject a draft that says more than the cited facts support.
 * `evidenceLines` are the fact lines the model cited (already resolved from numbers).
 */
export function validateTourDraft(
  reply: string,
  evidenceLines: readonly string[],
  tour: PublishedTourFact,
  today: string,
): DraftValidation {
  const text = reply.trim()
  if (text.length === 0) return { ok: false, reason: 'empty' }
  if (text.length > MAX_REPLY_CHARS) return { ok: false, reason: 'too_long' }
  if (evidenceLines.length === 0) return { ok: false, reason: 'no_evidence' }
  if (MONEY_SHAPE.test(text)) return { ok: false, reason: 'mentions_money' }
  if (LINK_OR_HANDLE.test(text)) return { ok: false, reason: 'link_or_handle' }

  const grounded = evidenceLines.join('\n')
  for (const n of numbersIn(text)) {
    if (!grounded.includes(n)) return { ok: false, reason: `ungrounded_number:${n}` }
  }

  // Durations, dates, hotel stars and tour names against the catalog itself.
  const fact = checkFacts({
    texts: { overlay: null, caption: text, firstComment: null },
    linkUrl: `/${tour.slug}`,
    tours: [tour],
    aliasesByTourId: {},
    catalogVersion: 0,
    today,
  })
  if (fact.verdict !== 'pass') {
    const first = fact.items.find((i) => i.outcome !== 'PASS')
    return { ok: false, reason: `fact_check:${first?.kind ?? fact.verdict}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface TourDraftInput {
  commentText: string
  authorFirstName?: string
  post: PostContext
  tours: readonly PublishedTourFact[]
  aliasesByTourId: Readonly<Record<string, string[]>>
  today: string
}

/** Ask the model for a draft. Injectable so tests never touch the network. */
export type DraftModel = (system: string, user: string) => Promise<string>

async function callHaiku(system: string, user: string): Promise<string> {
  const anthropic = getAnthropicClient()
  const message = await anthropic.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 400,
    system,
    messages: [{ role: 'user', content: user }],
  })
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

/** Draft a catalog-grounded reply, or say why there is none. Never throws. */
export async function draftTourAnswer(input: TourDraftInput, model: DraftModel = callHaiku): Promise<TourDraftResult> {
  const tour = resolvePostTour(input.post, input.tours, input.aliasesByTourId)
  if (tour === null) return { ok: false, skip: 'no_tour_in_post' }

  const facts = tourFactLines(tour)
  let raw: string
  try {
    raw = await model(SYSTEM_PROMPT, buildDraftPrompt(input.commentText, input.authorFirstName, facts))
  } catch (err) {
    return { ok: false, skip: 'model_error', detail: err instanceof Error ? err.message : 'unknown' }
  }

  const parsed = parseModelDraft(raw)
  if (parsed === null) return { ok: false, skip: 'model_unparseable' }
  if (!parsed.answerable || parsed.reply === null || parsed.reply.length === 0) {
    return { ok: false, skip: 'not_answerable' }
  }

  const evidence = Array.from(new Set(parsed.evidence))
    .filter((n) => n >= 1 && n <= facts.length)
    .map((n) => facts[n - 1])
  const verdict = validateTourDraft(parsed.reply, evidence, tour, input.today)
  if (!verdict.ok) return { ok: false, skip: 'draft_rejected', detail: verdict.reason }

  return { ok: true, reply: parsed.reply.trim(), tourId: tour.id, tourName: tour.name, evidence }
}
