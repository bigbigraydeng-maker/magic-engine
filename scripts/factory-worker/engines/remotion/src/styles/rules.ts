/** Shared viral-rule defaults. Every style pack uses these; an empty brief does not. */

export interface ViralRules {
  /** Rule 1. Cards sit on the picture and must carry the selling point. */
  silentRead: true
  /** Rule 2. The first shot is already moving inside this many seconds. */
  firstMoveSec: number
  /** Rule 3. Product-intro shot length, in seconds. */
  shotSec: number
  /** Rule 3 cap. A longer request is refused. */
  shotSecMax: number
  /** Rule 4. One uncut shot. Off unless the brief asks. */
  singleShot: boolean
  /** Rule 4 length when singleShot is on. Kept in range even while off. */
  singleShotSec: number
  /** Rule 5. Chinese hook length before shrink-or-warn. */
  hookMaxChars: number
  /** Rule 5. English hook length before shrink-or-warn. */
  hookMaxWords: number
  /** Rule 5. Never drop characters. */
  hookOverflow: 'shrink' | 'warn'
  /** True only when the brief set shotSec. Otherwise the style pack's own rhythm is used. */
  shotFromBrief: boolean
}

export interface HookFit {
  text: string
  fontScale: number
  warning: string | null
  over: boolean
}

export interface OpeningPose {
  scale: number
  translateY: number
}

export interface PostcardRhythm {
  hookFrames: number
  sceneFrom: number[]
  sceneDur: number[]
  priceFrom: number
  totalFrames: number
  singleShot: boolean
}

const HAN = /\p{Script=Han}/u

export const VIRAL_DEFAULTS: ViralRules = {
  silentRead: true,
  firstMoveSec: 1,
  shotSec: 2,
  shotSecMax: 3,
  singleShot: false,
  singleShotSec: 7,
  hookMaxChars: 12,
  hookMaxWords: 8,
  hookOverflow: 'shrink',
  shotFromBrief: false,
}

const LOCKED: Array<keyof ViralRules> = ['silentRead', 'firstMoveSec', 'shotSecMax', 'hookMaxChars', 'hookMaxWords']

/** A fresh copy of the shared defaults. */
export function defaultRules(): ViralRules {
  return { ...VIRAL_DEFAULTS }
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label}必须是对象`)
  }
  return input as Record<string, unknown>
}

function num(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是数字`)
  return value
}

/** Rule 3. Positive, and never above the shared cap. */
export function clampShotSec(sec: number, max = VIRAL_DEFAULTS.shotSecMax): number {
  if (!(sec > 0)) throw new Error('镜头秒数必须是正数')
  if (sec > max) throw new Error(`镜头不能超过 ${max} 秒`)
  return sec
}

/** Rule 4. Uncut shots stay between 6 and 8 seconds. */
export function clampSingleShotSec(sec: number): number {
  if (sec < 6 || sec > 8) throw new Error('单镜头必须在 6 到 8 秒之间')
  return sec
}

function lockShared(raw: Record<string, unknown>, rules: ViralRules): void {
  for (const key of LOCKED) {
    if (raw[key] === undefined) continue
    if (raw[key] !== rules[key]) throw new Error(`${key}是所有风格包共用的默认值，不能单独改`)
  }
}

/** Read brief overrides. Missing fields stay on the shared defaults. */
export function readRules(input: unknown): ViralRules {
  const rules = defaultRules()
  if (input === undefined || input === null) return rules
  const raw = asRecord(input, 'style.rules')
  const known = new Set([...LOCKED, 'shotSec', 'singleShot', 'singleShotSec', 'hookOverflow', 'shotFromBrief'])
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new Error(`不认识的爆款规则参数：${key}`)
  }
  lockShared(raw, rules)
  if (raw.shotFromBrief !== undefined && typeof raw.shotFromBrief !== 'boolean') {
    throw new Error('shotFromBrief 必须是 true 或 false')
  }
  const briefShot = raw.shotSec !== undefined && raw.shotFromBrief !== false
  if (briefShot) {
    rules.shotSec = clampShotSec(num(raw.shotSec, 'shotSec'), rules.shotSecMax)
    rules.shotFromBrief = true
  }
  if (raw.singleShot !== undefined) {
    if (typeof raw.singleShot !== 'boolean') throw new Error('singleShot 必须是 true 或 false')
    rules.singleShot = raw.singleShot
  }
  if (raw.singleShotSec !== undefined) rules.singleShotSec = clampSingleShotSec(num(raw.singleShotSec, 'singleShotSec'))
  if (raw.hookOverflow !== undefined) {
    if (raw.hookOverflow !== 'shrink' && raw.hookOverflow !== 'warn') {
      throw new Error('hookOverflow 只能是 shrink 或 warn')
    }
    rules.hookOverflow = raw.hookOverflow
  }
  return rules
}

/** Rule 5. Over-long hooks shrink or warn. The returned text is the input text. */
export function measureHook(text: string, rules: ViralRules): HookFit {
  const han = Array.from(text).filter((ch) => HAN.test(ch)).length
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length
  const over = han > 0 ? han > rules.hookMaxChars : words > rules.hookMaxWords
  const warning = over
    ? (han > 0 ? `钩子超过 ${rules.hookMaxChars} 个字，已保留全文` : `钩子超过 ${rules.hookMaxWords} 个词，已保留全文`)
    : null
  if (!over || rules.hookOverflow === 'warn') return { text, fontScale: 1, warning, over }
  const limit = han > 0 ? rules.hookMaxChars : rules.hookMaxWords
  const used = han > 0 ? han : Math.max(1, words)
  return { text, fontScale: Math.max(0.62, limit / used), warning, over }
}

/** Rule 1. The card is on the picture and the point string is kept. */
export function silentCard(rules: ViralRules, point: string): { onPicture: true; point: string } {
  if (rules.silentRead !== true) throw new Error('静音可读是风格包默认值')
  if (point.trim() === '') throw new Error('字卡必须带着卖点')
  return { onPicture: true, point }
}

/** Rule 2. Frame 0 is already off the resting pose, and it has moved by firstMoveSec. */
export function openingMove(frame: number, fps: number, rules: ViralRules): OpeningPose {
  const window = Math.max(1, Math.round(rules.firstMoveSec * fps))
  const t = Math.min(Math.max(frame, 0), window) / window
  return { scale: 1.08 - 0.08 * t, translateY: Math.round(36 * (1 - t)) }
}

/** Rule 2. A style pack never puts the logo on frame 0. No rules means the old frame. */
export function logoStartFrame(requested: number, rules: ViralRules | null, fps: number): number {
  if (!rules) return requested
  return Math.max(requested, Math.round(rules.firstMoveSec * fps))
}

/** Rule 3. Frames in one product-intro shot. */
export function shotFrames(rules: ViralRules, fps: number): number {
  return Math.max(1, Math.round(rules.shotSec * fps))
}

function singlePostcard(rules: ViralRules, fps: number): PostcardRhythm {
  const totalFrames = Math.round(rules.singleShotSec * fps)
  const priceFrom = Math.max(1, totalFrames - Math.round(1.5 * fps))
  return { hookFrames: totalFrames, sceneFrom: [], sceneDur: [], priceFrom, totalFrames, singleShot: true }
}

function cutPostcard(sceneCount: number, shot: number): PostcardRhythm {
  const sceneFrom = Array.from({ length: sceneCount }, (_, i) => shot * (i + 1))
  const sceneDur = Array.from({ length: sceneCount }, () => shot)
  const priceFrom = shot * (sceneCount + 1)
  return { hookFrames: shot, sceneFrom, sceneDur, priceFrom, totalFrames: priceFrom + shot, singleShot: false }
}

/** Shot plan used only when a style pack is on. The props timing fields stay as written. */
export function styledPostcardTiming(
  props: { scenes: readonly unknown[] },
  rules: ViralRules,
  fps = 30,
  shotSec = rules.shotSec,
): PostcardRhythm {
  if (rules.singleShot) return singlePostcard(rules, fps)
  return cutPostcard(props.scenes.length, Math.max(1, Math.round(shotSec * fps)))
}
