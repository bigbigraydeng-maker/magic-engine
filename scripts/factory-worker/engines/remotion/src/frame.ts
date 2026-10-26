import { CORNER_LOGO, type SafeRect, safeRectFor } from './safeZone.ts'
import { textWidthUnits } from './postcard.ts'

/** Shown when a reel has no headline, hook lines, or question. */
export const FALLBACK_HOOK_LINE = 'Watch this'
/** Shown when a reel has no end title and no call to action. */
export const FALLBACK_CTA = 'Learn more'
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
const HOOK_DEFAULT_ON = new Set(['postcard'])

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

function resolveQuestion(source: ResolvedHookLine[], spec: FrameHookSpec): ResolvedHook {
  const provided = Boolean(spec.question?.trim() || spec.text?.trim() || source.length > 0)
  const question =
    spec.question?.trim() ||
    spec.text?.trim() ||
    source.find((line) => QUESTION_END.test(line.text))?.text ||
    source[0]?.text ||
    FALLBACK_HOOK_LINE
  return {
    style: 'question',
    lines: [{ text: question, badge: null }],
    stat: spec.stat?.trim() || null,
    question,
    fallbackLine: !provided,
  }
}

function resolveStat(source: ResolvedHookLine[], spec: FrameHookSpec): ResolvedHook {
  const fromText = spec.text?.trim() ? digitToken(spec.text.trim()) : null
  const fromLine = source.map((line) => digitToken(line.text)).find((token): token is string => Boolean(token)) ?? null
  const provided = Boolean(spec.stat?.trim() || fromText || fromLine || spec.text?.trim() || source.length > 0)
  const stat = spec.stat?.trim() || fromText || fromLine || spec.text?.trim() || source[0]?.text || FALLBACK_HOOK_LINE
  const caption = spec.text?.trim() && spec.text.trim() !== stat
    ? [{ text: spec.text.trim(), badge: null }]
    : source.filter((line) => line.text !== stat).slice(0, 2)
  return { style: 'stat', lines: caption, stat, question: null, fallbackLine: !provided }
}

function resolveKinetic(source: ResolvedHookLine[], spec: FrameHookSpec): ResolvedHook {
  if (spec.text?.trim()) {
    const lines = wrapHeadline(spec.text.trim()).map((text) => ({ text, badge: null as string | null }))
    return { style: 'kinetic', lines, stat: null, question: null, fallbackLine: false }
  }
  if (source.length === 0) {
    return {
      style: 'kinetic',
      lines: [{ text: FALLBACK_HOOK_LINE, badge: null }],
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
}): ResolvedHook {
  const spec = input.spec ?? {}
  const source = plainLines(input.lines ?? [])
  const style = inferHookStyle(source.map((line) => line.text), spec)
  if (style === 'question') return resolveQuestion(source, spec)
  if (style === 'stat') return resolveStat(source, spec)
  return resolveKinetic(source, spec)
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
}): ResolvedEndCard {
  const spec = input.spec ?? {}
  const cta = trimmed(spec.cta) || trimmed(input.title) || FALLBACK_CTA
  const contact = trimmed(spec.contact)
  const brandName = trimmed(spec.brandName)
  const logoFile = trimmed(input.logoFile)
  return {
    cta,
    contact,
    brandName,
    logoFile,
    monogram: firstGlyph(brandName || cta),
    fallbackCta: cta === FALLBACK_CTA && !trimmed(spec.cta) && !trimmed(input.title),
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
  const hook = hookActive(template, frame)
    ? resolveHook({ lines: sourceLines(template, props), spec: specOfHook(frame) })
    : null
  const endCard = endCardActive(template, frame, ending)
    ? resolveEndCard({
        spec: specOfEnd(frame),
        title: endTitleOf(props),
        logoFile: typeof props.logoFile === 'string' ? props.logoFile : null,
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
  const bits: string[] = []
  if (hookActive(template, frame)) {
    const spec = specOfHook(frame)
    const resolved = resolveHook({ lines: sourceLines(template, props), spec })
    if (resolved.fallbackLine) pushSpec(bits, FALLBACK_HOOK_LINE)
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
    })
    if (resolved.fallbackCta) pushSpec(bits, FALLBACK_CTA)
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
