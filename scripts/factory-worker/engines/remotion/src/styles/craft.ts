import type { PresetId } from './types.ts'
import type { ViralRules } from './rules.ts'

/** How the picture changes between shots. A pack uses one or two. */
export type TransitionKind = 'cut' | 'flash' | 'push' | 'slide' | 'wipe' | 'punch' | 'fade'

/** How the words arrive. */
export type TextMotionKind = 'typewriter' | 'pop' | 'highlight' | 'slide-line' | 'stroke'

/** Cut density. Fast is about 1.5s, medium about 2s, slow is a long take over 3s. */
export type RhythmKind = 'fast' | 'medium' | 'slow'

/** Where the words sit inside the 9:16 safe area. */
export type CaptionKind = 'stroke-bottom' | 'center-card' | 'lower-third' | 'sticker'

/** What happens to the picture itself. */
export type PictureKind = 'kenburns' | 'shake' | 'grain' | 'split' | 'pip'

/** One of the six looks a person can tell apart without reading the label. */
export type FamilyId = 'flash' | 'minimal' | 'warm' | 'data' | 'promo' | 'documentary'

/** Platform-generic, industry, or the brand kit that sits on top of either. */
export type StyleTier = 'generic' | 'industry' | 'brand'

export interface Craft {
  family: FamilyId
  transitions: readonly [TransitionKind] | readonly [TransitionKind, TransitionKind]
  textMotion: TextMotionKind
  rhythm: RhythmKind
  /** Seconds between picture cuts. Slow packs are longer than 3. */
  shotSec: number
  /** Seconds between beat accents. */
  beatSec: number
  caption: CaptionKind
  picture: PictureKind
}

export const FAMILY_NAME: Record<FamilyId, string> = {
  flash: '抖音快节奏',
  minimal: '高级极简',
  warm: '温暖生活感',
  data: '硬核数据',
  promo: '促销冲击',
  documentary: '纪录片质感',
}

/** Brand is not a seventh look. It recolours whichever pack is already chosen. */
export const FAMILY_TIER: Record<FamilyId, Exclude<StyleTier, 'brand'>> = {
  flash: 'generic',
  minimal: 'generic',
  warm: 'industry',
  data: 'industry',
  promo: 'industry',
  documentary: 'industry',
}

const CRAFTS: Record<PresetId, Craft> = {
  vivid: { family: 'flash', transitions: ['flash', 'cut'], textMotion: 'typewriter', rhythm: 'fast', shotSec: 1.5, beatSec: 0.5, caption: 'sticker', picture: 'shake' },
  clean: { family: 'minimal', transitions: ['wipe'], textMotion: 'slide-line', rhythm: 'medium', shotSec: 2, beatSec: 2, caption: 'center-card', picture: 'kenburns' },
  premium: { family: 'minimal', transitions: ['wipe', 'push'], textMotion: 'slide-line', rhythm: 'slow', shotSec: 3.4, beatSec: 3.4, caption: 'lower-third', picture: 'kenburns' },
  dining: { family: 'warm', transitions: ['slide'], textMotion: 'pop', rhythm: 'medium', shotSec: 2, beatSec: 1, caption: 'lower-third', picture: 'kenburns' },
  home: { family: 'warm', transitions: ['slide', 'push'], textMotion: 'pop', rhythm: 'medium', shotSec: 2, beatSec: 1, caption: 'sticker', picture: 'shake' },
  beauty: { family: 'warm', transitions: ['fade'], textMotion: 'stroke', rhythm: 'medium', shotSec: 2, beatSec: 1, caption: 'sticker', picture: 'grain' },
  travel: { family: 'documentary', transitions: ['fade'], textMotion: 'stroke', rhythm: 'slow', shotSec: 3.4, beatSec: 3.4, caption: 'stroke-bottom', picture: 'grain' },
  property: { family: 'documentary', transitions: ['push'], textMotion: 'slide-line', rhythm: 'slow', shotSec: 3.2, beatSec: 3.2, caption: 'center-card', picture: 'kenburns' },
  retail: { family: 'promo', transitions: ['punch', 'flash'], textMotion: 'pop', rhythm: 'fast', shotSec: 1.5, beatSec: 0.5, caption: 'sticker', picture: 'pip' },
  b2b: { family: 'data', transitions: ['cut'], textMotion: 'highlight', rhythm: 'medium', shotSec: 2, beatSec: 1, caption: 'lower-third', picture: 'split' },
  education: { family: 'data', transitions: ['cut', 'flash'], textMotion: 'typewriter', rhythm: 'medium', shotSec: 2, beatSec: 1, caption: 'stroke-bottom', picture: 'pip' },
}

/** Edit craft for a pack. Throws when the id is not one of the eleven. */
export function craftById(id: string): Craft {
  const craft = CRAFTS[id as PresetId]
  if (!craft) throw new Error(`不认识的风格包 ${id}`)
  return craft
}

/** Stable string so tests can prove two packs are not the same edit. */
export function craftSignature(craft: Craft): string {
  return [craft.transitions.join('+'), craft.textMotion, craft.rhythm, craft.caption, craft.picture].join('|')
}

/** The moving transition. A flash, when present, is the second effect. */
export function motionTransition(craft: Craft): TransitionKind {
  return craft.transitions.find((kind) => kind !== 'flash') ?? craft.transitions[0]
}

/** True when this pack opens a cut with a white flash. */
export function usesFlash(craft: Craft): boolean {
  return craft.transitions.includes('flash')
}

/**
 * Cut length actually used. A brief that set shotSec wins, and is already capped.
 * Otherwise the pack's own fast / medium / slow length is used, including long takes over 3s.
 */
export function effectiveShotSec(look: { rules: ViralRules; craft: Craft }): number {
  if (look.rules.shotFromBrief) return look.rules.shotSec
  return look.craft.shotSec
}

/** Frames between beat accents. */
export function beatEvery(craft: Craft, fps = 30): number {
  return Math.max(1, Math.round(craft.beatSec * fps))
}

/** How many shots fit in a 6 to 8 second study clip. */
export function studyPlan(craft: Craft, fps = 30): { shotFrames: number; shots: number; totalFrames: number } {
  const shotFrames = Math.max(1, Math.round(craft.shotSec * fps))
  let shots = 2
  for (const count of [4, 3, 2]) {
    const total = count * craft.shotSec
    if (total >= 6 && total <= 8.05) {
      shots = count
      break
    }
  }
  return { shotFrames, shots, totalFrames: shotFrames * shots }
}

export interface CaptionBox {
  left: number
  top: number
  width: number
  height: number
}

/** Caption rectangle. Callers pass the fixed safe area; the box stays inside it. */
export function captionBox(kind: CaptionKind, safe: { top: number; bottom: number; left: number; right: number }): CaptionBox {
  const width = safe.right - safe.left
  if (kind === 'center-card') return { left: safe.left + 80, top: 560, width: width - 160, height: 520 }
  if (kind === 'lower-third') return { left: safe.left, top: 900, width, height: 320 }
  if (kind === 'sticker') return { left: safe.left + 36, top: 780, width: width - 160, height: 420 }
  return { left: safe.left, top: 1000, width, height: 230 }
}

/** Smallest body size used by any pack. Caption type must not go under this. */
export const MIN_BODY_PX = 52

/** Hook size, never under this pack's body or the smallest body of any pack. */
export function captionFontSize(hook: number, body: number, fontScale: number): number {
  const scaled = Math.min(84, Math.round(hook * fontScale))
  return Math.max(MIN_BODY_PX, Math.min(84, body), scaled)
}

/** Selling-point line. Same floor as body copy, not a tiny label. */
export function pointFontSize(body: number): number {
  return Math.max(MIN_BODY_PX, Math.min(84, body))
}

function captionSubstance(value: string): string {
  return value.replace(/^\d+\s*\/\s*\d+\s+/, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Hide the second line when it repeats the first, including a "1/4 " prefix. */
export function singleCaption(text: string, point: string): { text: string; point: string } {
  const line = captionSubstance(text)
  const note = captionSubstance(point)
  if (line !== '' && line === note) return { text, point: '' }
  return { text, point }
}

/** Typewriter keeps the full string in layout while only part of it is painted. */
export function typewriterReserve(text: string, frame: number, revealFrames: number): { reserved: string; visible: string } {
  return { reserved: text, visible: shownChars(text, frame, revealFrames) }
}

/** True when every edge of the box is inside the safe area. */
export function captionInside(box: CaptionBox, safe: { top: number; bottom: number; left: number; right: number }): boolean {
  return box.left >= safe.left && box.top >= safe.top && box.left + box.width <= safe.right && box.top + box.height <= safe.bottom
}

export interface PicturePose {
  scale: number
  x: number
  y: number
}

/** Picture motion at a frame. Frame 0 is already off the resting pose. */
export function picturePose(frame: number, picture: PictureKind): PicturePose {
  const drift = 1.05 + Math.min(Math.max(frame, 0), 120) * 0.0016
  if (picture === 'shake') {
    return { scale: drift, x: Math.round(Math.sin(frame + 1) * 16), y: Math.round(Math.cos(frame + 1) * 10) }
  }
  if (picture === 'pip' || picture === 'split') return { scale: drift, x: 0, y: Math.round(Math.sin(frame + 1) * 6) }
  return { scale: drift, x: 0, y: 0 }
}

export interface TransitionPose {
  x: number
  y: number
  scale: number
  opacity: number
  wipe: number
}

/** Enter move for the first frames of a shot. A hard cut stays put; the picture pose still moves. */
export function transitionPose(frame: number, kind: TransitionKind): TransitionPose {
  const t = Math.min(1, Math.max(frame, 0) / 12)
  const rest = { x: 0, y: 0, scale: 1, opacity: 1, wipe: 0 }
  if (kind === 'push') return { ...rest, y: Math.round((1 - t) * 180) }
  if (kind === 'slide') return { ...rest, x: Math.round((1 - t) * 240) }
  if (kind === 'wipe') return { ...rest, wipe: 1 - t }
  if (kind === 'punch') return { ...rest, scale: 1.45 - 0.45 * t }
  if (kind === 'fade') return { ...rest, opacity: 0.3 + 0.7 * t }
  return rest
}

/** White-flash strength. Zero after the flash window. */
export function flashOpacity(frame: number): number {
  if (frame <= 0) return 0.9
  if (frame >= 9) return 0
  return 0.9 * (1 - frame / 9)
}

/** Characters visible at this frame. At the end of the reveal the whole string is back. */
export function shownChars(text: string, frame: number, revealFrames: number): string {
  const all = Array.from(text)
  if (all.length === 0) return ''
  const span = Math.max(1, revealFrames)
  const n = frame >= span ? all.length : Math.max(0, Math.ceil((frame / span) * all.length))
  return all.slice(0, n).join('')
}
