import { beatEvery, effectiveShotSec, type Craft } from './craft.ts'
import { logoStartFrame, type ViralRules } from './rules.ts'

/** A resolved pack. Only the fields the clocks read. */
export interface CraftLook {
  craft: Craft
  rules: ViralRules
}

export interface ListCraftTiming {
  hookFrames: number
  itemFrom: number[]
  itemDur: number[]
  revealFrom: number
  logoFrom: number
  totalFrames: number
  shotFrames: number
  /** Picture cuts. Zero means the whole list is one shot. */
  cuts: number
}

export interface MontageCraftTiming {
  shotFrames: number
  shots: number
  cuts: number
  totalFrames: number
  logoFrom: number
}

export interface DataCraftTiming {
  hookFrames: number
  rowFrames: number
  rowFrom: number[]
  totalFrames: number
  /** Row entrances. The number board itself is never replaced by a cut. */
  cuts: number
  /** Every value, in order. The card stays about these figures. */
  values: string[]
  primary: 'numbers'
}

export interface AtmosphereShotPlan {
  shots: 1
  cuts: 0
  totalFrames: number
}

function shotOf(look: CraftLook, fps: number): number {
  return Math.max(1, Math.round(effectiveShotSec(look) * fps))
}

/** List clock used only when a style pack is on. Beat times on the brief stay as written. */
export function styledListTiming(
  itemCount: number,
  look: CraftLook,
  fps = 30,
  logoMode?: 'last_beats' | 'always',
): ListCraftTiming {
  if (look.rules.singleShot) return singleList(itemCount, look, fps, logoMode)
  return cutList(itemCount, look, fps, logoMode)
}

function singleList(itemCount: number, look: CraftLook, fps: number, logoMode?: 'last_beats' | 'always'): ListCraftTiming {
  const totalFrames = Math.round(look.rules.singleShotSec * fps)
  const requested = logoMode === 'always' ? 0 : Math.max(0, totalFrames - fps)
  return {
    hookFrames: totalFrames,
    itemFrom: Array.from({ length: itemCount }, () => 0),
    itemDur: Array.from({ length: itemCount }, () => totalFrames),
    revealFrom: 0,
    logoFrom: logoStartFrame(requested, look.rules, fps),
    totalFrames,
    shotFrames: totalFrames,
    cuts: 0,
  }
}

function cutList(itemCount: number, look: CraftLook, fps: number, logoMode?: 'last_beats' | 'always'): ListCraftTiming {
  const shotFrames = shotOf(look, fps)
  const shots = itemCount + 2
  const revealFrom = shotFrames * (itemCount + 1)
  const totalFrames = shotFrames * shots
  const requested = logoMode === 'always' ? 0 : Math.max(revealFrom, totalFrames - 2 * fps)
  return {
    hookFrames: shotFrames,
    itemFrom: Array.from({ length: itemCount }, (_, i) => shotFrames * (i + 1)),
    itemDur: Array.from({ length: itemCount }, () => shotFrames),
    revealFrom,
    logoFrom: logoStartFrame(requested, look.rules, fps),
    totalFrames,
    shotFrames,
    cuts: shots - 1,
  }
}

/** Montage clock: one shot per clip or word, whichever is more. Still many shots. */
export function styledMontageTiming(clipCount: number, wordCount: number, look: CraftLook, fps = 30): MontageCraftTiming {
  if (look.rules.singleShot) {
    const totalFrames = Math.round(look.rules.singleShotSec * fps)
    return {
      shotFrames: totalFrames,
      shots: 1,
      cuts: 0,
      totalFrames,
      logoFrom: logoStartFrame(Math.max(0, totalFrames - fps), look.rules, fps),
    }
  }
  const shotFrames = shotOf(look, fps)
  const shots = Math.max(clipCount, wordCount, 1)
  const totalFrames = shotFrames * shots
  return {
    shotFrames,
    shots,
    cuts: shots - 1,
    totalFrames,
    logoFrom: logoStartFrame(Math.max(0, totalFrames - 2 * fps), look.rules, fps),
  }
}

/** One cue per on-screen word, in seconds. */
export function styledMontageCues(
  clipCount: number,
  words: readonly string[],
  look: CraftLook,
  fps = 30,
): Array<[number, number, string]> {
  const plan = styledMontageTiming(clipCount, words.length, look, fps)
  const end = plan.totalFrames / fps - 0.1
  return words.map((text, i) => {
    const from = plan.shots === 1 ? 0 : (i % plan.shots) * plan.shotFrames / fps
    const to = plan.shots === 1 ? end : Math.min(end, from + plan.shotFrames / fps)
    return [from, to, text]
  })
}

/** Data-card clock. Rows step on the pack beat. Every value is kept. */
export function styledDataCardTiming(rows: readonly { value: string }[], look: CraftLook, fps = 30): DataCraftTiming {
  const values = rows.map((row) => row.value)
  if (look.rules.singleShot) {
    const totalFrames = Math.round(look.rules.singleShotSec * fps)
    return {
      hookFrames: totalFrames,
      rowFrames: totalFrames,
      rowFrom: rows.map(() => 0),
      totalFrames,
      cuts: 0,
      values,
      primary: 'numbers',
    }
  }
  const shot = shotOf(look, fps)
  const rowFrames = beatEvery(look.craft, fps)
  const rowFrom = rows.map((_, i) => shot + i * rowFrames)
  const grown = shot + rows.length * rowFrames + shot
  const totalFrames = Math.max(grown, Math.round(6 * fps))
  return { hookFrames: shot, rowFrames, rowFrom, totalFrames, cuts: rows.length, values, primary: 'numbers' }
}

/** True when the styled card still lists every source value, in order. */
export function datacardKeepsNumbers(rows: readonly { value: string }[], timing: DataCraftTiming): boolean {
  return timing.primary === 'numbers' && timing.values.length === rows.length && timing.values.every((value, i) => value === rows[i].value)
}

/**
 * Atmosphere stays one shot. Caption and picture treatment follow the pack.
 * Transitions are dropped so a flash pack cannot insert a cut.
 */
export function atmosphereCraftOf(craft: Craft): Craft {
  return { ...craft, transitions: ['cut'] }
}

/** One continuous shot. The authored length is kept. */
export function atmosphereShotPlan(totalFrames: number): AtmosphereShotPlan {
  return { shots: 1, cuts: 0, totalFrames }
}
