import type { Craft } from './craft.ts'
import type { ViralRules } from './rules.ts'

/** Visual roles a brand may ask for. Unknown values fall back to the preset default. */
export type FontRole = 'sans' | 'serif' | 'display'

/** How a preset moves type onto the screen. Positions stay put; only the rhythm changes. */
export type MotionKind = 'cut' | 'fade' | 'slide' | 'pop'

/** Industry packs plus three generic packs. Ids are stable machine names. */
export const PRESET_IDS = [
  'dining',
  'property',
  'travel',
  'beauty',
  'education',
  'home',
  'retail',
  'b2b',
  'clean',
  'vivid',
  'premium',
] as const

/** One style-pack id. */
export type PresetId = (typeof PRESET_IDS)[number]

/** A Latin face plus a Chinese face. The renderer loads both. */
export interface FontPair {
  latinId: string
  cjkId: string
}

/** Industry or generic look. No frame size: safe area and aspect stay outside the pack. */
export interface StylePreset {
  id: PresetId
  name: string
  kind: 'industry' | 'generic'
  fonts: {
    defaultRole: FontRole
    sans: FontPair
    serif: FontPair
    display: FontPair
  }
  colors: {
    canvas: string
    surface: string
    brand: string
    accent: string
    text: string
    muted: string
  }
  type: {
    hook: number
    title: number
    body: number
    label: number
    weightHook: number
    weightTitle: number
    weightBody: number
    weightLabel: number
    trackingLabel: number
    labelCase: 'upper' | 'none'
  }
  shape: {
    radiusCard: number
    radiusChip: number
    strokeWidth: number
    strokeColor: string
  }
  motion: {
    kind: MotionKind
    damping: number
    stiffness: number
    mass: number
    enterFrames: number
    flashPeak: number
    flashFrames: number
  }
  card: {
    fill: string
    placeColor: string
    lineColor: string
    shadow: string
  }
}

/** Optional brand kit. Missing fields stay on the preset. */
export interface BrandInput {
  primary?: string
  secondary?: string
  logo?: string
  font?: string
}

/** Why this pack was chosen. */
export type SelectionReason = 'preset' | 'industry' | 'clean'

/** Preset after the brand kit and contrast floor have been applied. Safe area is fixed. */
export interface ResolvedLook {
  presetId: PresetId
  name: string
  selection: SelectionReason
  fonts: { latinId: string; cjkId: string; role: FontRole }
  colors: {
    canvas: string
    surface: string
    brand: string
    accent: string
    text: string
    muted: string
    textOnBrand: string
    brandInk: string
    onSurface: string
  }
  type: StylePreset['type']
  shape: StylePreset['shape']
  motion: StylePreset['motion']
  card: StylePreset['card']
  /** Edit craft. Shared by every render of this pack. Brand colours do not replace it. */
  craft: Craft
  /** Viral-rule floor. The same defaults for every pack unless the brief overrides a rhythm field. */
  rules: ViralRules
  logoFile?: string
  safe: { top: number; bottom: number; left: number; right: number }
}
