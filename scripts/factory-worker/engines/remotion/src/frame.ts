import { CORNER_LOGO, type SafeRect, safeRectFor } from './safeZone.ts'
import { textWidthUnits } from './postcard.ts'

/** Shown when a reel has no headline, hook lines, or question. */
export const FALLBACK_HOOK_LINE = 'Watch this'
/** Chinese hook line, used only when the work order copy is already Chinese. */
export const FALLBACK_HOOK_LINE_ZH = '先看这里'
/** Shown when a reel has no end title and no call to action. */
export const FALLBACK_CTA = 'Learn more'
/** Chinese action, used only when the work order copy is already Chinese. */
export const FALLBACK_CTA_ZH = '了解更多'
/** Brand colour when a template does not carry one. */
export const DEFAULT_BRAND = '#14364A'
/** Opening overlay length at 30 fps (2 seconds). */
export const HOOK_WINDOW_FRAMES = 60
/** End-card overlay length at 30 fps (2.5 seconds). */
export const END_WINDOW_FRAMES = 75

export type HookStyle = 'kinetic' | 'stat' | 'question'
export type CardZone = 'upper' | 'lower' | 'alternate'
export type EndingKind = 'end' | 'price' | 'none'

export interface FrameHookSpec {
  style?: HookStyle
  text?: string
  stat?: string
  question?: string
}

export interface FrameEndSpec {
  cta?: string
  contact?: string
  brandName?: string
}

export interface FrameConfig {
  hook?: false | FrameHookSpec
  endCard?: false | FrameEndSpec
}

export interface ResolvedHookLine {
  text: string
  badge: string | null
}

export interface ResolvedHook {
  style: HookStyle
  lines: ResolvedHookLine[]
  stat: string | null
  question: string | null
  fallbackLine: boolean
}

export interface ResolvedEndCard {
  cta: string
  contact: string | null
  brandName: string | null
  logoFile: string | null
  monogram: string
  fallbackCta: boolean
}

export interface FramePlan {
  hook: ResolvedHook | null
  endCard: ResolvedEndCard | null
}

const QUESTION_END = /[?？]\s*$/
const CJK = /[\u3400-\u9fff]/
// Media file names carry no copy language, so the language scan skips them.
const ASSET_FILE = /\.(?:png|jpe?g|webp|gif|avif|mp4|mov|m4v|webm|mp3|wav|m4a|aac)$/i
const HOOK_DEFAULT_ON =new Set(['postcard'])

/** True when the string contains Han characters. */
export function looksChinese(value: string): boolean {
  return CJK.test(value)
}

function collectStrings(value: unknown, out: string[], depth: number): void {
  if (depth > 5 || out.length > 80) return
  if (typeof value === 'string') {
    const text = value.trim()
    if (text && !ASSET_FILE.test(text)) out.push(text)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, out, depth + 1)
  }
}

/** True when any existing work-order string is Chinese. There is no language field. */
export function workOrderLooksChinese(props: object): boolean {
  const bits: string[] = []
  collectStrings(props, bits, 0)
  return bits.some(looksChinese)
}

function fallbackHookLine(chinese: boolean): string {
  return chinese ? FALLBACK_HOOK_LINE_ZH : FALLBACK_HOOK_LINE
}

function fallbackCtaLine(chinese: boolean): string {
  return chinese ? FALLBACK_CTA_ZH : FALLBACK_CTA
}

/** Type size that fills about 70% of the frame width, clamped to the safe width. */
export function hookTypeSize(frameWidth: number, safeWidth: number, longestChars: number, cjk: boolean): number {
  const unit = cjk ? 1.02 : 0.58
  const longest = Math.max(1, longestChars)
  const fit = Math.floor((frameWidth * 0.72) / (longest * unit))
  const limit = Math.floor((safeWidth - 16) / (longest * unit))
  return Math.max(72, Math.min(200, fit, limit))
}

/** Digit size for a stat hook. Narrow glyphs get a higher cap than a sentence. */
export function statTypeSize(frameWidth: number, safeWidth: number, stat: string): number {
  const cjk = looksChinese(stat)
  const unit = cjk ? 1 : 0.62
  const longest = Math.max(1, Array.from(stat).length)
  const fit = Math.floor((frameWidth * 0.48) / (longest * unit))
  const limit = Math.floor((safeWidth - 16) / (longest * unit))
  return Math.max(120, Math.min(320, fit, limit))
}

/** Call-to-action width. At least 55% of the frame, and never past the safe width. */
export function ctaButtonWidth(frameWidth: number, safeWidth: number): number {
  return Math.min(safeWidth, Math.round(frameWidth * 0.7))
}

/** Split a hook sentence into 1–3 short rows so the type can stay large. */
export function hookDisplayRows(text: string): string[] {
  const trimmedText = text.trim()
  const chars = Array.from(trimmedText)
  if (chars.length === 0) return []
  if (!looksChinese(trimmedText)) return chars.length <= 22 ? [trimmedText] : wrapHeadline(trimmedText)
  if (chars.length <= 6) return [trimmedText]
  const tail = Math.min(4, Math.max(2, chars.length - 5))
  const head = chars.slice(0, chars.length - tail)
  const last = chars.slice(chars.length - tail).join('')
  if (head.length <= 6) return [head.join(''), last]
  const mid = Math.ceil(head.length / 2)
  return [head.slice(0, mid).join(''), head.slice(mid).join(''), last]
}

export const MAX_HOOK_ROWS = 3

/**
 * Lay hook lines out in at most MAX_HOOK_ROWS rows without dropping any text.
 * Split rows are used when they fit; otherwise the unsplit lines are used; more than
 * MAX_HOOK_ROWS source lines are refused instead of truncated.
 */
export function hookRows(lines: ResolvedHookLine[]): ResolvedHookLine[] {
  if (lines.length > MAX_HOOK_ROWS) {
    throw new Error(`hook has ${lines.length} lines; at most ${MAX_HOOK_ROWS} fit without dropping text`)
  }
  const split: ResolvedHookLine[] = []
  for (const line of lines) {
    const parts = line.badge ? [line.text] : hookDisplayRows(line.text)
    parts.forEach((text, index) => split.push({ text, badge: index === 0 ? line.badge : null }))
  }
  return split.length <= MAX_HOOK_ROWS ? split : lines.map((line) => ({ text: line.text, badge: line.badge }))
}

function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

function digitToken(value: string): string | null {
  const match = value.match(/\d[\d,.]*%?/)
  return match ? match[0] : null
}

function readStyle(value: unknown): HookStyle | undefined {
  if (value === 'kinetic' || value === 'stat' || value === 'question') return value
  return undefined
}

function readHookSpec(value: Record<string, unknown>): FrameHookSpec {
  const spec: FrameHookSpec = {}
  const style = readStyle(value.style)
  const text = trimmed(value.text)
  const stat = trimmed(value.stat)
  const question = trimmed(value.question)
  if (style) spec.style = style
  if (text) spec.text = text
  if (stat) spec.stat = stat
  if (question) spec.question = question
  return spec
}

function readEndSpec(value: Record<string, unknown>): FrameEndSpec {
  const spec: FrameEndSpec = {}
  const cta = trimmed(value.cta)
  const contact = trimmed(value.contact)
  const brandName = trimmed(value.brandName)
  if (cta) spec.cta = cta
  if (contact) spec.contact = contact
  if (brandName) spec.brandName = brandName
  return spec
}

/** Read a frame switch from unknown props. Invalid shapes are ignored, never thrown. */
export function readFrame(value: unknown): FrameConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const rec = value as Record<string, unknown>
  const frame: FrameConfig = {}
  if (rec.hook === false) frame.hook = false
  else if (rec.hook && typeof rec.hook === 'object') frame.hook = readHookSpec(rec.hook as Record<string, unknown>)
  if (rec.endCard === false) frame.endCard = false
  else if (rec.endCard && typeof rec.endCard === 'object') frame.endCard = readEndSpec(rec.endCard as Record<string, unknown>)
  return frame
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

/** True when the shared opening hook should replace or cover the template's own opener. */
export function hookActive(template: string, frame: FrameConfig | undefined): boolean {
  if (frame?.hook === false) return false
  if (frame?.hook && typeof frame.hook === 'object') return true
  return HOOK_DEFAULT_ON.has(template)
}

/** True when the shared end card should play. Postcard defaults on only for a title ending, not a price card. */
export function endCardActive(template: string, frame: FrameConfig | undefined, ending: EndingKind): boolean {
  if (frame?.endCard === false) return false
  if (frame?.endCard && typeof frame.endCard === 'object') return true
  return template === 'postcard' && ending === 'end'
}

/** Pick a style from an explicit switch, else a question mark, else a number, else kinetic type. */
export function inferHookStyle(lines: string[], spec: FrameHookSpec): HookStyle {
  if (spec.style) return spec.style
  const text = spec.text ?? ''
  if (spec.question || lines.some((line) => QUESTION_END.test(line)) || QUESTION_END.test(text)) return 'question'
  if (spec.stat || lines.some((line) => digitToken(line)) || digitToken(text)) return 'stat'
  return 'kinetic'
}

function chunkChars(text: string, size: number): string[] {
  const chars = Array.from(text)
  if (chars.length <= size) return [text]
  const lines: string[] = []
  for (let i = 0; i < chars.length && lines.length < 3; i += size) {
    lines.push(chars.slice(i, i + size).join(''))
  }
  return lines
}

/** Break a headline into at most three lines that can sit in the safe width. */
export function wrapHeadline(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return chunkChars(text, 10)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (current && Array.from(next).length > 16 && lines.length < 2) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 3)
}

function plainLines(input: Array<string | { text?: string; badge?: string | null }>): ResolvedHookLine[] {
  const out: ResolvedHookLine[] = []
  for (const line of input) {
    if (typeof line === 'string') {
      const text = line.trim()
      if (text) out.push({ text, badge: null })
      continue
    }
    const text = line.text?.trim() ?? ''
    if (!text) continue
    const badge = typeof line.badge === 'string' && line.badge.trim() ? line.badge.trim() : null
    out.push({ text, badge })
  }
  return out
}

function explicitQuestionLines(spec: FrameHookSpec): ResolvedHookLine[] {
  const question = spec.question?.trim() ?? ''
  const text = spec.text?.trim() ?? ''
  const lines: ResolvedHookLine[] = []
  if (question) lines.push({ text: question, badge: null })
  if (text && text !== question) lines.push({ text, badge: null })
  return lines
}

/** Explicit copy is drawn first. Source lines stay only when all of them still fit in three rows. */
function questionLines(explicit: ResolvedHookLine[], source: ResolvedHookLine[]): ResolvedHookLine[] {
  if (explicit.length === 0) return source
  const seen = new Set(explicit.map((line) => line.text))
  const rest = source.filter((line) => !seen.has(line.text))
  if (explicit.length + rest.length <= MAX_HOOK_ROWS) return [...explicit, ...rest]
  return explicit.slice(0, MAX_HOOK_ROWS)
}

function resolveQuestion(source: ResolvedHookLine[], spec: FrameHookSpec, chinese: boolean): ResolvedHook {
  const explicit = explicitQuestionLines(spec)
  const provided = explicit.length > 0 || source.length > 0
  const question =
    explicit[0]?.text ||
    source.find((line) => QUESTION_END.test(line.text))?.text ||
    source[0]?.text ||
    fallbackHookLine(chinese)
  const picked = questionLines(explicit, source)
  const lines = picked.length > 0 ? picked : [{ text: question, badge: null }]
  return {
    style: 'question',
    lines,
    stat: spec.stat?.trim() || null,
    question,
    fallbackLine: !provided,
  }
}

function resolveStat(source: ResolvedHookLine[], spec: FrameHookSpec, chinese: boolean): ResolvedHook {
  const fromText = spec.text?.trim() ? digitToken(spec.text.trim()) : null
  const fromLine = source.map((line) => digitToken(line.text)).find((token): token is string => Boolean(token)) ?? null
  const provided = Boolean(spec.stat?.trim() || fromText || fromLine || spec.text?.trim() || source.length > 0)
  const stat = spec.stat?.trim() || fromText || fromLine || spec.text?.trim() || source[0]?.text || fallbackHookLine(chinese)
  const caption = spec.text?.trim() && spec.text.trim() !== stat
    ? [{ text: spec.text.trim(), badge: null }]
    : source.filter((line) => line.text !== stat).slice(0, 2)
  return { style: 'stat', lines: caption, stat, question: null, fallbackLine: !provided }
}

function resolveKinetic(source: ResolvedHookLine[], spec: FrameHookSpec, chinese: boolean): ResolvedHook {
  if (spec.text?.trim()) {
    const lines = wrapHeadline(spec.text.trim()).map((text) => ({ text, badge: null as string | null }))
    return { style: 'kinetic', lines, stat: null, question: null, fallbackLine: false }
  }
  if (source.length === 0) {
    return {
      style: 'kinetic',
      lines: [{ text: fallbackHookLine(chinese), badge: null }],
      stat: null,
      question: null,
      fallbackLine: true,
    }
  }
  return { style: 'kinetic', lines: source.slice(0, 3), stat: null, question: null, fallbackLine: false }
}

/** Resolve hook copy. Missing text becomes one generic line; style is inferred when omitted. */
export function resolveHook(input: {
  lines?: Array<string | { text?: string; badge?: string | null }>
  spec?: FrameHookSpec
  chinese?: boolean
}): ResolvedHook {
  const spec = input.spec ?? {}
  const source = plainLines(input.lines ?? [])
  const chinese = input.chinese === true
  const style = inferHookStyle(source.map((line) => line.text), spec)
  if (style === 'question') return resolveQuestion(source, spec, chinese)
  if (style === 'stat') return resolveStat(source, spec, chinese)
  return resolveKinetic(source, spec, chinese)
}

function firstGlyph(value: string): string {
  const glyph = Array.from(value)[0]
  return glyph ? glyph.toLocaleUpperCase() : '•'
}

/** Resolve the end card. Logo may be absent; the caller then draws the monogram. */
export function resolveEndCard(input: {
  spec?: FrameEndSpec
  title?: string | null
  logoFile?: string | null
  chinese?: boolean
}): ResolvedEndCard {
  const spec = input.spec ?? {}
  const fallback = fallbackCtaLine(input.chinese === true)
  const cta = trimmed(spec.cta) || trimmed(input.title) || fallback
  const contact = trimmed(spec.contact)
  const brandName = trimmed(spec.brandName)
  const logoFile = trimmed(input.logoFile)
  return {
    cta,
    contact,
    brandName,
    logoFile,
    monogram: firstGlyph(brandName || cta),
    fallbackCta: cta === fallback && !trimmed(spec.cta) && !trimmed(input.title),
  }
}

function endingOf(props: Record<string, unknown>): EndingKind {
  if (asRecord(props.end)) return 'end'
  if (asRecord(props.price)) return 'price'
  return 'none'
}

function endTitleOf(props: Record<string, unknown>): string | null {
  const end = asRecord(props.end)
  const title = end ? trimmed(end.title) : null
  if (title) return title
  return trimmed(props.revealTitle)
}

function isSpec<T extends object>(value: false | T | undefined): value is T {
  return typeof value === 'object' && value !== null
}

function specOfHook(frame: FrameConfig | undefined): FrameHookSpec | undefined {
  return isSpec(frame?.hook) ? frame.hook : undefined
}

function specOfEnd(frame: FrameConfig | undefined): FrameEndSpec | undefined {
  return isSpec(frame?.endCard) ? frame.endCard : undefined
}

function sourceLines(template: string, props: Record<string, unknown>): Array<string | { text?: string; badge?: string | null }> {
  if (template === 'atmosphere') {
    const line = asRecord(props.line)
    return line && typeof line.text === 'string' ? [line.text] : []
  }
  if (template === 'montage') return []
  const hook = asRecord(props.hook)
  const lines = hook?.lines
  if (!Array.isArray(lines)) return []
  return lines.filter((line) => typeof line === 'string' || (line && typeof line === 'object')) as Array<
    string | { text?: string; badge?: string | null }
  >
}

/** What the shared hook and end card will actually draw for these props. */
export function resolveFramePlan(template: string, props: Record<string, unknown>): FramePlan {
  const frame = readFrame(props.frame)
  const ending = endingOf(props)
  const chinese = workOrderLooksChinese(props)
  const hook = hookActive(template, frame)
    ? resolveHook({ lines: sourceLines(template, props), spec: specOfHook(frame), chinese })
    : null
  const endCard = endCardActive(template, frame, ending)
    ? resolveEndCard({
        spec: specOfEnd(frame),
        title: endTitleOf(props),
        logoFile: typeof props.logoFile === 'string' ? props.logoFile : null,
        chinese,
      })
    : null
  return { hook, endCard }
}

function pushSpec(bits: string[], value: string | undefined): void {
  if (value && !bits.includes(value)) bits.push(value)
}

/**
 * On-screen strings introduced by the frame switch that are not already in the template caption.
 * Inferred splits of existing hook lines are not repeated.
 */
export function extraCaptionLines(template: string, props: Record<string, unknown>): string[] {
  const frame = readFrame(props.frame)
  const ending = endingOf(props)
  const chinese = workOrderLooksChinese(props)
  const bits: string[] = []
  if (hookActive(template, frame)) {
    const spec = specOfHook(frame)
    const resolved = resolveHook({ lines: sourceLines(template, props), spec, chinese })
    if (resolved.fallbackLine) pushSpec(bits, resolved.lines[0]?.text)
    pushSpec(bits, spec?.text)
    pushSpec(bits, spec?.stat)
    pushSpec(bits, spec?.question)
  }
  if (endCardActive(template, frame, ending)) {
    const spec = specOfEnd(frame)
    const resolved = resolveEndCard({
      spec,
      title: endTitleOf(props),
      logoFile: typeof props.logoFile === 'string' ? props.logoFile : null,
      chinese,
    })
    if (resolved.fallbackCta) pushSpec(bits, resolved.cta)
    pushSpec(bits, spec?.cta)
    pushSpec(bits, spec?.contact)
    pushSpec(bits, spec?.brandName)
  }
  return bits
}

/** Brand colour from props, or the generic default. */
export function brandColorOf(props: Record<string, unknown>): string {
  if (typeof props.brandColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(props.brandColor)) return props.brandColor
  return DEFAULT_BRAND
}

/** Frame windows for an opt-in overlay. The two windows do not overlap. */
export function overlayWindows(totalFrames: number): { hookFrames: number; endFrom: number; endFrames: number } {
  const total = Math.max(0, Math.floor(totalFrames))
  const hookFrames = Math.min(HOOK_WINDOW_FRAMES, total)
  const endFrames = Math.min(END_WINDOW_FRAMES, Math.max(0, total - hookFrames))
  return { hookFrames, endFrom: total - endFrames, endFrames }
}

const CARD_PAD_Y = 56
const PLACE_BLOCK = 72
const LINE_PX = 76
const UNITS_PER_LINE = 9
const CARD_GAP = 20

/** Conservative card height so a wrapped scene line still ends inside the safe rect. */
export function estimatePostcardCardHeight(line: string): number {
  const units = Math.max(1, textWidthUnits(line))
  const lines = Math.min(4, Math.max(1, Math.ceil(units / UNITS_PER_LINE)))
  return CARD_PAD_Y + PLACE_BLOCK + lines * LINE_PX
}

function clampTop(top: number, minTop: number, maxTop: number): number {
  return Math.min(maxTop, Math.max(minTop, top))
}

/**
 * Vertical origin of a postcard scene card.
 * An explicit cardTop is kept (then clamped). Otherwise scenes alternate the upper and lower safe bands
 * so the card is not parked on the middle of the picture for the whole reel.
 */
export function postcardCardTop(input: {
  sceneIndex: number
  cardHeight: number
  cardTop?: number
  cardZone?: CardZone
  logoVisible?: boolean
  width?: number
  height?: number
}): number {
  const safe: SafeRect = safeRectFor(input.width ?? 1080, input.height ?? 1920)
  const minTop = safe.top + CARD_GAP
  const maxTop = Math.max(minTop, safe.bottom - CARD_GAP - input.cardHeight)
  if (input.cardTop !== undefined && input.cardZone === undefined) {
    return clampTop(input.cardTop, minTop, maxTop)
  }
  const belowLogo = CORNER_LOGO.top + CORNER_LOGO.height + 16
  const upper = input.logoVisible ? clampTop(belowLogo, minTop, maxTop) : minTop
  const zone = input.cardZone ?? 'alternate'
  const pick = zone === 'upper' ? 'upper' : zone === 'lower' ? 'lower' : input.sceneIndex % 2 === 0 ? 'lower' : 'upper'
  return pick === 'upper' ? upper : maxTop
}
