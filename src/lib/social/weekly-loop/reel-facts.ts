import { checkFacts, type FactCheckResult, type FactItem } from './fact-check'
import type { SocialFactSource } from './fact-aliases'
import { buildReelFirstComment, buildReelPostCaption } from '@/lib/social/reel-publishing'
import { isoDate, nzCalendar } from '@/lib/social/week-pack/cadence'

export type OkFactSource = Extract<SocialFactSource, { ok: true }>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** NZ calendar date (YYYY-MM-DD) used as "today" by every reel fact check. */
export function factCheckToday(now: Date): string {
  return isoDate(nzCalendar(now))
}

/** The burned-in overlay text of a factory reel (output.caption), or null. */
export function reelOverlayOf(output: unknown): string | null {
  if (!isRecord(output)) return null
  const caption = output.caption
  if (typeof caption !== 'string') return null
  const trimmed = caption.trim()
  return trimmed ? trimmed : null
}

/** The endcard link of a reel brief (brief.copy.endcard.url), or null. */
export function reelLinkUrlOf(brief: unknown): string | null {
  if (!isRecord(brief)) return null
  const copy = brief.copy
  if (!isRecord(copy)) return null
  const endcard = copy.endcard
  if (!isRecord(endcard)) return null
  const url = endcard.url
  return typeof url === 'string' && url.trim() ? url : null
}

/**
 * One reel's facts against the published catalog — the single rule set shared by the weekly loop
 * and every publish path. `only: 'first_comment'` checks just the first comment (used when the
 * post is already public and only the comment is left to send).
 */
export function checkReelFacts(args: {
  brief: unknown
  output: unknown
  orderId: string
  source: OkFactSource
  today: string
  only?: 'first_comment'
}): { result: FactCheckResult; overlayChecked: boolean } {
  const copy = isRecord(args.brief) && isRecord(args.brief.copy) ? args.brief.copy : {}
  const endcard = isRecord(copy.endcard) ? copy.endcard : {}
  const firstComment = buildReelFirstComment(endcard, args.orderId)
  const overlay = reelOverlayOf(args.output)
  const texts =
    args.only === 'first_comment'
      ? { overlay: null, caption: '', firstComment: firstComment?.text ?? null }
      : { overlay, caption: buildReelPostCaption(copy), firstComment: firstComment?.text ?? null }
  const result = checkFacts({
    texts,
    linkUrl: reelLinkUrlOf(args.brief),
    tours: args.source.tours,
    aliasesByTourId: args.source.aliasesByTourId,
    catalogVersion: args.source.catalogVersion,
    today: args.today,
    bannedPhrases: args.source.bannedPhrases,
  })
  const overlayChecked = args.only !== 'first_comment' && overlay !== null
  return { result, overlayChecked }
}

const LABEL: Record<FactItem['kind'], string> = {
  old_tour_name: '旧团名',
  duration_days: '天数',
  hotel_stars: '酒店星级',
  money: '价格',
  masked_price: '打码价格',
  date: '出发日',
  cruise_name: '游轮',
  tour_not_sellable: '团已不在售',
  ambiguous_tour_name: '团名对不上唯一的团',
  ambiguous_tour_link: '链接对不上唯一的团',
  banned_phrase: '禁用词',
  check_error: '核对出错',
}

const STRIPPED_CHARS = /[()\[\]{}<>]/g

function cleanLine(line: string): string {
  const stripped = line.replace(STRIPPED_CHARS, '')
  const collapsed = stripped.replace(/\s+/g, ' ').trim()
  // Short lines: the week card cuts a whole error at 160 chars, and the "edit, then preview again" tail must survive.
  return collapsed.length > 40 ? collapsed.slice(0, 40) : collapsed
}

/**
 * Up to `max` plain-language lines for the items that did not pass.
 * No brackets, no braces (the week card drops messages that contain them).
 */
export function factProblemLines(items: readonly FactItem[], max = 3): string[] {
  const out: string[] = []
  for (const item of items) {
    if (out.length >= max) break
    if (item.outcome === 'PASS') continue
    const expected =
      typeof item.expected === 'string' && item.expected.trim().length > 0
        ? `，目录是 ${item.expected}`
        : ''
    out.push(cleanLine(`${LABEL[item.kind]}：${item.claim}${expected}`))
  }
  return out
}
