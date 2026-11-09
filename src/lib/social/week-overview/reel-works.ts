/**
 * Reels, shown the way a person thinks about them: one row per piece of work, not one row per factory order.
 * The factory keeps every revision as its own order and the order text is a free-form English ticket, so this file
 * (display only, no I/O, no database, no customer names):
 *   - folds revisions of the same piece into one "work" (newest version leads, the older ones stay in the details),
 *   - turns the ticket into a short title (name + batch + #n) and keeps the raw text for the details,
 *   - names each Reel's state with one small tag, and puts the works in state groups.
 * Parsing is best effort: whatever it cannot read stays in the raw ticket text, nothing is dropped or invented.
 */
import type { OverviewReel, ReelVariety } from './build'
import { describeVarietyLine, isRecordedUploaded } from '../story-lite/page-text'

export type StatusKind = 'review' | 'approved' | 'sent' | 'uploaded' | 'draft' | 'problem' | 'making' | 'closed'

export interface ReelTag {
  kind: StatusKind
  label: string
  /** One plain sentence for the tooltip / details. */
  hint: string
}

export interface ReelVersion {
  reel: OverviewReel
  tag: ReelTag
}

export interface ReelWork {
  key: string
  /** Short title: "Name #4"; never the whole ticket. */
  title: string
  /** "第 1 批" when the ticket says "batch1"; otherwise null. */
  batchLabel: string | null
  /** The ticket's own note about where it belongs, e.g. "Spring launch"; shown in the details only. */
  campaignNote: string | null
  templateLabel: string | null
  /** The newest version; its state is the state of the whole work. */
  latest: ReelVersion
  /** All versions, newest first (length >= 1). */
  versions: ReelVersion[]
  /** How many OLDER versions are still waiting for review (the newest one's own state is `tag`). */
  olderPending: number
  tag: ReelTag
}

// ───────────────────────────── reading the ticket ─────────────────────────────

const OPEN = new Set(['(', '（'])
const CLOSE = new Set([')', '）'])
const COLON = new Set([':', '：'])
const VERSION_WORD = /^(?:v\d+[a-z]?(?:-[a-z0-9]+)*|r\d+)$/i
const REVISION_GROUP = /^\s*((?:[vr]\d+[a-z]?(?:-[a-z0-9]+)*|retry\s*\d+|re-?run(?:\s*\d+)?))\s*(?:[:：]|$)/i
const MAX_TITLE = 64
const EDGE_CHAR = /[\s,;·\-–—]/

/**
 * How many Reel orders the overview API sends at most (newest first). Keep it equal to REEL_LIMIT in build.ts: a list
 * this long may be cut off, and the page says so instead of calling an unseen part "nothing to do".
 */
export const REEL_QUERY_LIMIT = 30

interface Piece {
  kind: 'text' | 'group'
  text: string
}

/** Splits text into plain runs and top-level bracket groups (nested brackets stay inside their group). */
function tokenize(input: string): Piece[] {
  const pieces: Piece[] = []
  let depth = 0
  let start = 0
  let plain = ''
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (OPEN.has(ch)) {
      if (depth === 0) {
        if (plain) pieces.push({ kind: 'text', text: plain })
        plain = ''
        start = i
      }
      depth += 1
    } else if (CLOSE.has(ch) && depth > 0) {
      depth -= 1
      if (depth === 0) pieces.push({ kind: 'group', text: input.slice(start + 1, i) })
    } else if (depth === 0) {
      plain += ch
    }
  }
  if (depth > 0) plain += input.slice(start) // unbalanced bracket: keep the tail as plain text
  if (plain) pieces.push({ kind: 'text', text: plain })
  return pieces
}

function firstTopLevelColon(text: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (OPEN.has(ch)) depth += 1
    else if (CLOSE.has(ch)) depth = Math.max(0, depth - 1)
    else if (COLON.has(ch) && depth === 0) return i
  }
  return -1
}

/** Collapses white space and trims separators from both ends in one pass each, so a long run of dashes cannot make it slow. */
function tidy(text: string): string {
  const spaced = text.replace(/\s+/g, ' ')
  let start = 0
  let end = spaced.length
  while (start < end && EDGE_CHAR.test(spaced[start])) start += 1
  while (end > start && EDGE_CHAR.test(spaced[end - 1])) end -= 1
  return spaced.slice(start, end)
}

function stripTemplateWord(name: string, template: string | null): string {
  if (!template) return name
  const tail = ` ${template.toLowerCase()}`
  return name.toLowerCase().endsWith(tail) ? name.slice(0, name.length - tail.length) : name
}

export interface ParsedTicket {
  name: string
  /** Every "#n" in the head, in the order written. */
  indexes: string[]
  batch: number | null
  /** The ticket's own bracket notes in the head (revision notes are not included), as written. */
  notes: string[]
  headVersion: string | null
}

/** Takes version marks ("v2", "r3", "v1g-nov") out of a name. A mark is a whole word and never the first word ("V8 Engine" stays). */
function takeOutVersionMarks(text: string): { text: string; first: string | null } {
  let first: string | null = null
  const kept = text.split(' ').filter((word, i) => {
    if (i > 0 && VERSION_WORD.test(word)) {
      first = first ?? word
      return false
    }
    return true
  })
  return { text: kept.join(' '), first }
}

function readHead(headRaw: string, template: string | null): ParsedTicket {
  const pieces = tokenize(headRaw)
  const groups = pieces.filter((p) => p.kind === 'group').map((p) => p.text)
  const notes = groups.filter((g) => !REVISION_GROUP.test(g)).map(tidy).filter((g) => g.length > 0)
  const plain = tidy(pieces.filter((p) => p.kind === 'text').map((p) => p.text).join(' '))
  const indexes = Array.from(`${plain} ${groups.join(' ')}`.matchAll(/#\s*(\d+)/g), (match) => match[1])
  const batchMatch = /\bbatch\s*(\d+)\b/i.exec(groups.join(' '))
  const marked = takeOutVersionMarks(tidy(plain.replace(/#\s*\d+/g, ' ')))
  return {
    name: tidy(stripTemplateWord(tidy(marked.text), template)),
    indexes,
    batch: batchMatch ? Number(batchMatch[1]) : null,
    notes,
    headVersion: marked.first,
  }
}

/** Reads the title part of one factory ticket (everything before the first colon). Never throws; an empty ticket gives an empty name. */
export function parseTicket(angle: string, template: string | null): ParsedTicket {
  const text = angle.trim()
  const colon = firstTopLevelColon(text)
  return readHead(colon < 0 ? text : text.slice(0, colon), template)
}

// ───────────────────────────── tags and groups ─────────────────────────────

const TEMPLATE_LABEL: Record<string, string> = {
  postcard: '明信片款',
  list: '价格款',
  atmosphere: '氛围款',
}

/** Plain name of a Reel template; templates this page does not know are not shown (never a raw code word). */
export function describeReelTemplate(template: string | null): string | null {
  return template ? (TEMPLATE_LABEL[template] ?? null) : null
}

/** The one small state tag of a Reel. Uses the same "was it uploaded" rule as the rest of the social pages. */
export function describeReelTag(reel: Pick<OverviewReel, 'status' | 'published_at' | 'video_state'>): ReelTag {
  if (isRecordedUploaded(reel)) {
    if (reel.video_state === 'DRAFT') return { kind: 'draft', label: '草稿', hint: '已传到 Facebook，但还没公开。' }
    if (reel.video_state === 'PUBLISHED') return { kind: 'sent', label: '已发出', hint: '已在 Facebook 公开。' }
    return { kind: 'uploaded', label: '已上传（未核对）', hint: '系统记录已经上传，但还没核对它在 Facebook 上是公开还是草稿。' }
  }
  switch (reel.status) {
    case 'in_review':
      return { kind: 'review', label: '待审核', hint: '等你在视频工厂点「通过」或「打回」。' }
    case 'approved':
      return { kind: 'approved', label: '已通过', hint: '已通过审核，下一个整点发出。' }
    case 'publishing':
      return { kind: 'approved', label: '发布中', hint: '正在发到 Facebook。' }
    case 'review_rejected':
      return { kind: 'problem', label: '已打回', hint: '审核没通过，要重新出片。' }
    case 'publish_failed':
      return { kind: 'problem', label: '发布失败', hint: '发到 Facebook 时失败了，需要处理。' }
    case 'failed':
    case 'dead_letter':
      return { kind: 'problem', label: '出问题', hint: '制作或发布卡住了，需要处理。' }
    case 'queued':
    case 'claimed':
    case 'producing':
      return { kind: 'making', label: '制作中', hint: '视频还在制作。' }
    case 'rendered':
    case 'archived':
    case 'superseded':
      return { kind: 'closed', label: '已归档', hint: '旧记录，不会再发。' }
    default:
      return { kind: 'problem', label: '状态未知', hint: '读不出这条的状态，请到视频工厂看。' }
  }
}

function clip(text: string): string {
  const chars = Array.from(text) // by character, so an emoji is never cut in half
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join('').trimEnd()}…` : text
}

function titleOf(ticket: ParsedTicket, angle: string): string {
  const base = ticket.name.length > 0 ? ticket.name : angle.trim()
  if (base.length === 0) return '（没有写主题）'
  return clip(ticket.indexes.length > 0 && ticket.name.length > 0 ? `${base} #${ticket.indexes.join(' #')}` : base)
}

/** The note shown in the details: the first bracket note without its "#n". */
function noteOf(ticket: ParsedTicket): string | null {
  const note = ticket.notes.length > 0 ? tidy(ticket.notes[0].replace(/#\s*\d+/g, ' ')) : ''
  return note.length > 0 ? note : null
}

/**
 * Folds the Reels of one client into works. Two orders are the same work only when the name, every "#n", the template and
 * every bracket note of the ticket all match once version marks like "v2" / "r3" are taken away; anything less certain
 * stays apart, so a piece that needs a decision can never be hidden behind another one.
 * Input order is kept: the API sends newest first, so the first version of a group is its newest.
 */
export function groupReelWorks(reels: ReadonlyArray<OverviewReel>): ReelWork[] {
  const byKey = new Map<string, ReelWork>()
  const tieBreaks = new Map<ReelWork, TieBreak>()
  const order: ReelWork[] = []
  for (const reel of reels) {
    const ticket = parseTicket(reel.angle ?? '', reel.template)
    const version: ReelVersion = { reel, tag: describeReelTag(reel) }
    const key = ticket.name.length === 0
      ? `solo:${reel.id}`
      : [ticket.name.toLowerCase(), ticket.indexes.join(','), reel.template ?? '', ticket.notes.map((note) => note.toLowerCase()).join(' | ')].join('|')
    const existing = byKey.get(key)
    if (existing) {
      existing.versions.push(version)
      continue
    }
    const work: ReelWork = {
      key,
      title: titleOf(ticket, reel.angle ?? ''),
      batchLabel: ticket.batch !== null ? `第 ${ticket.batch} 批` : null,
      campaignNote: noteOf(ticket),
      templateLabel: describeReelTemplate(reel.template),
      latest: version,
      versions: [version],
      olderPending: 0,
      tag: version.tag,
    }
    byKey.set(key, work)
    tieBreaks.set(work, { mark: ticket.headVersion, note: noteOf(ticket) })
    order.push(work)
  }
  for (const work of order) work.olderPending = work.versions.slice(1).filter((version) => version.tag.kind === 'review').length
  return tellSameTitlesApart(order, tieBreaks)
}

interface TieBreak {
  mark: string | null
  note: string | null
}

/**
 * Two different works with the same title are told apart: first by their version mark ("Name v4"), and if they are
 * still the same, by the ticket's own note ("Name（Spring 2026）"). Nothing is dropped from the title otherwise.
 */
function tellSameTitlesApart(works: ReelWork[], tieBreaks: ReadonlyMap<ReelWork, TieBreak>): ReelWork[] {
  const repeated = (): Map<string, number> => {
    const seen = new Map<string, number>()
    for (const work of works) seen.set(work.title, (seen.get(work.title) ?? 0) + 1)
    return seen
  }
  let seen = repeated()
  for (const work of works) {
    const mark = tieBreaks.get(work)?.mark
    if ((seen.get(work.title) ?? 0) > 1 && mark) work.title = clip(`${work.title} ${mark}`)
  }
  seen = repeated()
  for (const work of works) {
    const note = tieBreaks.get(work)?.note
    if ((seen.get(work.title) ?? 0) > 1 && note) work.title = clip(`${work.title}（${note}）`)
  }
  return works
}

export interface ReelStage {
  id: string
  title: string
  hint: string
  defaultOpen: boolean
  kind: StatusKind
  works: ReelWork[]
}

const STAGES: ReadonlyArray<{ id: string; title: string; hint: string; defaultOpen: boolean; kind: StatusKind; kinds: StatusKind[] }> = [
  { id: 'review', title: '待你审核', hint: '在视频工厂点「通过」后，系统会在下一个整点发出。', defaultOpen: true, kind: 'review', kinds: ['review'] },
  { id: 'problem', title: '出问题 / 被打回', hint: '这些要处理，或者让视频工厂重新出片。', defaultOpen: true, kind: 'problem', kinds: ['problem'] },
  { id: 'approved', title: '已通过，等发出', hint: '已经审核通过，排在下一个整点。', defaultOpen: true, kind: 'approved', kinds: ['approved'] },
  { id: 'making', title: '制作中', hint: '视频工厂还在做。', defaultOpen: false, kind: 'making', kinds: ['making'] },
  { id: 'draft', title: 'Facebook 草稿', hint: '已传到 Facebook 但还没公开；标「未核对」的是系统记录已上传、还没核对公开状态。', defaultOpen: false, kind: 'draft', kinds: ['draft', 'uploaded'] },
  { id: 'sent', title: '已发出', hint: '已在 Facebook 公开。', defaultOpen: true, kind: 'sent', kinds: ['sent'] },
  { id: 'closed', title: '旧记录', hint: '已归档，不会再发。', defaultOpen: false, kind: 'closed', kinds: ['closed'] },
]

/** The works in state groups, in the order a person should look at them; empty groups are left out. */
export function groupWorksByStage(works: ReadonlyArray<ReelWork>): ReelStage[] {
  return STAGES.map((stage) => ({
    id: stage.id,
    title: stage.title,
    hint: stage.hint,
    defaultOpen: stage.defaultOpen,
    kind: stage.kind,
    works: works.filter((work) => stage.kinds.includes(work.tag.kind)),
  })).filter((stage) => stage.works.length > 0)
}

export interface ReelCounts {
  works: number
  versions: number
  byKind: Record<StatusKind, number>
}

export function countReelWorks(works: ReadonlyArray<ReelWork>): ReelCounts {
  const byKind: Record<StatusKind, number> = { review: 0, approved: 0, sent: 0, uploaded: 0, draft: 0, problem: 0, making: 0, closed: 0 }
  let versions = 0
  for (const work of works) {
    byKind[work.tag.kind] += 1
    versions += work.versions.length
  }
  return { works: works.length, versions, byKind }
}

/**
 * The variety hint in plain words. Speaks only when the existing rule says something is off (same thresholds as the
 * Story/Reel headline), and says what to do about it instead of pointing at a rule document.
 */
export function describeVarietyAdvice(variety: ReelVariety): string | null {
  if (variety.total === 0 || !describeVarietyLine(variety).warn) return null
  const facts: string[] = []
  const advice: string[] = []
  if (variety.same_track_max >= 2) {
    facts.push(`同一首背景音乐用了 ${variety.same_track_max} 次`)
    advice.push('换一首背景音乐')
  }
  if (variety.total >= 4 && variety.price_screen_count * 3 > variety.total) {
    facts.push(`价格款占了 ${variety.price_screen_count} 条`)
    advice.push('少放价格款')
  }
  return `最近 ${variety.total} 条里，${facts.join('，')}。下一批建议${advice.join('、')}。`
}
