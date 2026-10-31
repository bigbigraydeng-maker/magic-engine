import type { StylePreset } from './types.ts'

const SANS_SC = { latinId: 'Nunito', cjkId: 'NotoSansSC' }
const SERIF_SC = { latinId: 'LibreBaskerville', cjkId: 'NotoSerifSC' }
const DISPLAY_SC = { latinId: 'Oswald', cjkId: 'ZCOOLKuaiLe' }

/** Eleven packs. Appearance only — none of them names a frame size. */
export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'dining',
    name: '餐饮',
    kind: 'industry',
    fonts: {
      defaultRole: 'display',
      sans: { latinId: 'Nunito', cjkId: 'NotoSansSC' },
      serif: { latinId: 'LibreBaskerville', cjkId: 'NotoSerifSC' },
      display: { latinId: 'Fraunces', cjkId: 'ZCOOLKuaiLe' },
    },
    colors: { canvas: '#2a120c', surface: '#f6e2c8', brand: '#c4452d', accent: '#e2a15a', text: '#2a120c', muted: '#6b3a2a' },
    type: { hook: 100, title: 72, body: 64, label: 40, weightHook: 900, weightTitle: 800, weightBody: 800, weightLabel: 800, trackingLabel: 1, labelCase: 'none' },
    shape: { radiusCard: 28, radiusChip: 16, strokeWidth: 0, strokeColor: '#e2a15a' },
    motion: { kind: 'pop', damping: 8, stiffness: 190, mass: 0.6, enterFrames: 10, flashPeak: 0.35, flashFrames: 7 },
    card: { fill: 'rgba(42,18,12,0.86)', placeColor: '#e2a15a', lineColor: '#fff6ec', shadow: '0 10px 28px rgba(42,18,12,0.45)' },
  },
  {
    id: 'property',
    name: '房产',
    kind: 'industry',
    fonts: {
      defaultRole: 'serif',
      sans: { latinId: 'Outfit', cjkId: 'NotoSansSC' },
      serif: { latinId: 'CormorantGaramond', cjkId: 'NotoSerifSC' },
      display: DISPLAY_SC,
    },
    colors: { canvas: '#e7e1d8', surface: '#f7f4ef', brand: '#8c7355', accent: '#1c1c1c', text: '#1c1c1c', muted: '#5c564e' },
    type: { hook: 84, title: 60, body: 54, label: 34, weightHook: 600, weightTitle: 600, weightBody: 600, weightLabel: 600, trackingLabel: 6, labelCase: 'upper' },
    shape: { radiusCard: 2, radiusChip: 2, strokeWidth: 1, strokeColor: '#8c7355' },
    motion: { kind: 'fade', damping: 22, stiffness: 70, mass: 1, enterFrames: 22, flashPeak: 0, flashFrames: 12 },
    card: { fill: 'rgba(247,244,239,0.94)', placeColor: '#8c7355', lineColor: '#1c1c1c', shadow: '0 8px 24px rgba(28,28,28,0.18)' },
  },
  {
    id: 'travel',
    name: '旅游',
    kind: 'industry',
    fonts: {
      defaultRole: 'sans',
      sans: { latinId: 'Outfit', cjkId: 'NotoSansSC' },
      serif: SERIF_SC,
      display: { latinId: 'Fraunces', cjkId: 'ZCOOLKuaiLe' },
    },
    colors: { canvas: '#083041', surface: '#f3e6d0', brand: '#e07a5f', accent: '#f2c14e', text: '#f7f3ee', muted: '#d7c4a8' },
    type: { hook: 96, title: 66, body: 60, label: 40, weightHook: 800, weightTitle: 800, weightBody: 700, weightLabel: 800, trackingLabel: 3, labelCase: 'upper' },
    shape: { radiusCard: 18, radiusChip: 10, strokeWidth: 0, strokeColor: '#f2c14e' },
    motion: { kind: 'slide', damping: 14, stiffness: 140, mass: 0.7, enterFrames: 16, flashPeak: 0.15, flashFrames: 10 },
    card: { fill: 'rgba(8,48,65,0.78)', placeColor: '#f2c14e', lineColor: '#f7f3ee', shadow: '0 8px 24px rgba(8,48,65,0.4)' },
  },
  {
    id: 'beauty',
    name: '美容',
    kind: 'industry',
    fonts: {
      defaultRole: 'serif',
      sans: { latinId: 'Nunito', cjkId: 'NotoSansSC' },
      serif: { latinId: 'PlayfairDisplay', cjkId: 'NotoSerifSC' },
      display: { latinId: 'CormorantGaramond', cjkId: 'ZCOOLXiaoWei' },
    },
    colors: { canvas: '#3a242c', surface: '#f8e6e4', brand: '#c46b7a', accent: '#e8d5c4', text: '#3a242c', muted: '#8a5c66' },
    type: { hook: 88, title: 64, body: 56, label: 34, weightHook: 700, weightTitle: 700, weightBody: 600, weightLabel: 600, trackingLabel: 4, labelCase: 'upper' },
    shape: { radiusCard: 36, radiusChip: 20, strokeWidth: 1, strokeColor: '#e8d5c4' },
    motion: { kind: 'fade', damping: 20, stiffness: 80, mass: 0.9, enterFrames: 20, flashPeak: 0, flashFrames: 14 },
    card: { fill: 'rgba(248,230,228,0.94)', placeColor: '#8e3d4e', lineColor: '#3a242c', shadow: '0 12px 30px rgba(58,36,44,0.22)' },
  },
  {
    id: 'education',
    name: '教育',
    kind: 'industry',
    fonts: {
      defaultRole: 'sans',
      sans: { latinId: 'DMSans', cjkId: 'NotoSansSC' },
      serif: { latinId: 'LibreBaskerville', cjkId: 'NotoSerifSC' },
      display: DISPLAY_SC,
    },
    colors: { canvas: '#f4f0e6', surface: '#fffdf8', brand: '#1b3a4b', accent: '#e0a106', text: '#f7f4ef', muted: '#d5d0c6' },
    type: { hook: 92, title: 64, body: 58, label: 36, weightHook: 800, weightTitle: 700, weightBody: 700, weightLabel: 700, trackingLabel: 3, labelCase: 'upper' },
    shape: { radiusCard: 12, radiusChip: 8, strokeWidth: 0, strokeColor: '#e0a106' },
    motion: { kind: 'slide', damping: 16, stiffness: 130, mass: 0.75, enterFrames: 14, flashPeak: 0.12, flashFrames: 8 },
    card: { fill: 'rgba(27,58,75,0.92)', placeColor: '#e0a106', lineColor: '#f7f4ef', shadow: '0 8px 22px rgba(27,58,75,0.35)' },
  },
  {
    id: 'home',
    name: '家政上门',
    kind: 'industry',
    fonts: {
      defaultRole: 'sans',
      sans: { latinId: 'Nunito', cjkId: 'NotoSansSC' },
      serif: SERIF_SC,
      display: { latinId: 'Outfit', cjkId: 'ZCOOLKuaiLe' },
    },
    colors: { canvas: '#e7f3ec', surface: '#f4ede4', brand: '#1f7a4d', accent: '#f2c14e', text: '#f4ede4', muted: '#d7e6dc' },
    type: { hook: 96, title: 68, body: 60, label: 38, weightHook: 900, weightTitle: 800, weightBody: 800, weightLabel: 800, trackingLabel: 1, labelCase: 'none' },
    shape: { radiusCard: 32, radiusChip: 18, strokeWidth: 0, strokeColor: '#1f7a4d' },
    motion: { kind: 'pop', damping: 10, stiffness: 160, mass: 0.7, enterFrames: 12, flashPeak: 0.2, flashFrames: 8 },
    card: { fill: 'rgba(31,122,77,0.92)', placeColor: '#f4ede4', lineColor: '#ffffff', shadow: '0 10px 24px rgba(31,122,77,0.35)' },
  },
  {
    id: 'retail',
    name: '零售电商',
    kind: 'industry',
    fonts: {
      defaultRole: 'display',
      sans: { latinId: 'Oswald', cjkId: 'NotoSansSC' },
      serif: SERIF_SC,
      display: { latinId: 'BebasNeue', cjkId: 'ZCOOLKuaiLe' },
    },
    colors: { canvas: '#111111', surface: '#f4f4f4', brand: '#ff3b1f', accent: '#111111', text: '#ffffff', muted: '#ffd0c8' },
    type: { hook: 108, title: 70, body: 62, label: 36, weightHook: 900, weightTitle: 800, weightBody: 800, weightLabel: 800, trackingLabel: 1, labelCase: 'upper' },
    shape: { radiusCard: 6, radiusChip: 4, strokeWidth: 3, strokeColor: '#ff3b1f' },
    motion: { kind: 'cut', damping: 12, stiffness: 200, mass: 0.55, enterFrames: 8, flashPeak: 0.55, flashFrames: 6 },
    card: { fill: 'rgba(17,17,17,0.86)', placeColor: '#ff3b1f', lineColor: '#ffffff', shadow: '0 0 0 rgba(0,0,0,0)' },
  },
  {
    id: 'b2b',
    name: 'B2B 科技',
    kind: 'industry',
    fonts: {
      defaultRole: 'sans',
      sans: { latinId: 'SpaceGrotesk', cjkId: 'NotoSansSC' },
      serif: { latinId: 'LibreBaskerville', cjkId: 'NotoSerifSC' },
      display: DISPLAY_SC,
    },
    colors: { canvas: '#0e141b', surface: '#e8eef4', brand: '#3ddcff', accent: '#6e7cff', text: '#e8eef4', muted: '#9eb0c2' },
    type: { hook: 86, title: 60, body: 54, label: 32, weightHook: 700, weightTitle: 600, weightBody: 600, weightLabel: 600, trackingLabel: 3, labelCase: 'upper' },
    shape: { radiusCard: 8, radiusChip: 4, strokeWidth: 1, strokeColor: '#3ddcff' },
    motion: { kind: 'fade', damping: 18, stiffness: 120, mass: 0.8, enterFrames: 14, flashPeak: 0.08, flashFrames: 8 },
    card: { fill: 'rgba(14,20,27,0.9)', placeColor: '#3ddcff', lineColor: '#e8eef4', shadow: '0 0 24px rgba(61,220,255,0.25)' },
  },
  {
    id: 'clean',
    name: '简洁',
    kind: 'generic',
    fonts: {
      defaultRole: 'sans',
      sans: { latinId: 'Montserrat', cjkId: 'NotoSansSC' },
      serif: { latinId: 'LibreBaskerville', cjkId: 'NotoSerifSC' },
      display: { latinId: 'Oswald', cjkId: 'NotoSansSC' },
    },
    colors: { canvas: '#111111', surface: '#f5f5f5', brand: '#2f5d50', accent: '#111111', text: '#ffffff', muted: '#d9d9d9' },
    type: { hook: 96, title: 66, body: 60, label: 40, weightHook: 900, weightTitle: 800, weightBody: 800, weightLabel: 800, trackingLabel: 2, labelCase: 'upper' },
    shape: { radiusCard: 16, radiusChip: 8, strokeWidth: 0, strokeColor: '#2f5d50' },
    motion: { kind: 'slide', damping: 14, stiffness: 140, mass: 0.7, enterFrames: 16, flashPeak: 0.2, flashFrames: 9 },
    card: { fill: 'rgba(0,0,0,0.62)', placeColor: '#ffffff', lineColor: '#ffffff', shadow: '0 6px 20px rgba(0,0,0,0.35)' },
  },
  {
    id: 'vivid',
    name: '活力',
    kind: 'generic',
    fonts: {
      defaultRole: 'display',
      sans: SANS_SC,
      serif: SERIF_SC,
      display: { latinId: 'Nunito', cjkId: 'ZCOOLKuaiLe' },
    },
    colors: { canvas: '#141414', surface: '#fff3c4', brand: '#ff2e88', accent: '#ffd23f', text: '#141414', muted: '#5c4a12' },
    type: { hook: 104, title: 72, body: 64, label: 40, weightHook: 900, weightTitle: 900, weightBody: 800, weightLabel: 900, trackingLabel: 0, labelCase: 'upper' },
    shape: { radiusCard: 40, radiusChip: 18, strokeWidth: 4, strokeColor: '#141414' },
    motion: { kind: 'pop', damping: 7, stiffness: 210, mass: 0.55, enterFrames: 8, flashPeak: 0.4, flashFrames: 6 },
    card: { fill: 'rgba(255,210,63,0.96)', placeColor: '#ff2e88', lineColor: '#141414', shadow: '0 12px 0 rgba(20,20,20,0.9)' },
  },
  {
    id: 'premium',
    name: '高端',
    kind: 'generic',
    fonts: {
      defaultRole: 'serif',
      sans: { latinId: 'Outfit', cjkId: 'NotoSansSC' },
      serif: { latinId: 'CormorantGaramond', cjkId: 'NotoSerifSC' },
      display: { latinId: 'PlayfairDisplay', cjkId: 'ZCOOLXiaoWei' },
    },
    colors: { canvas: '#0a0a0a', surface: '#f6f1e7', brand: '#c6a15b', accent: '#f6f1e7', text: '#f6f1e7', muted: '#d9cbb3' },
    type: { hook: 80, title: 58, body: 52, label: 30, weightHook: 600, weightTitle: 600, weightBody: 600, weightLabel: 600, trackingLabel: 8, labelCase: 'upper' },
    shape: { radiusCard: 0, radiusChip: 0, strokeWidth: 1, strokeColor: '#c6a15b' },
    motion: { kind: 'fade', damping: 24, stiffness: 60, mass: 1.05, enterFrames: 24, flashPeak: 0, flashFrames: 16 },
    card: { fill: 'rgba(10,10,10,0.8)', placeColor: '#c6a15b', lineColor: '#f6f1e7', shadow: '0 8px 28px rgba(0,0,0,0.45)' },
  },
]

const BY_ID = new Map(STYLE_PRESETS.map((preset) => [preset.id, preset]))

/** Preset by id, or null when the id is not one of the eleven. */
export function presetById(id: string): StylePreset | null {
  return BY_ID.get(id as StylePreset['id']) ?? null
}
