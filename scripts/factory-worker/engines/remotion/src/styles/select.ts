import { applyBrand, readBrand } from './brand.ts'
import { craftById } from './craft.ts'
import { readRules } from './rules.ts'
import { AA_NORMAL, ensureContrast, flattenCss, isHexColor } from './contrast.ts'
import { presetById, STYLE_PRESETS } from './presets.ts'
import { safeZone } from './safe.ts'
import { PRESET_IDS, type PresetId, type ResolvedLook, type SelectionReason } from './types.ts'

const INDUSTRY_TO_PRESET: Record<string, PresetId> = {
  dining: 'dining',
  food: 'dining',
  restaurant: 'dining',
  cafe: 'dining',
  餐饮: 'dining',
  美食: 'dining',
  property: 'property',
  'real-estate': 'property',
  realestate: 'property',
  housing: 'property',
  房产: 'property',
  地产: 'property',
  travel: 'travel',
  tourism: 'travel',
  tour: 'travel',
  旅游: 'travel',
  旅行: 'travel',
  beauty: 'beauty',
  spa: 'beauty',
  salon: 'beauty',
  美容: 'beauty',
  美业: 'beauty',
  education: 'education',
  edu: 'education',
  school: 'education',
  教育: 'education',
  home: 'home',
  'home-service': 'home',
  housekeeping: 'home',
  家政: 'home',
  上门: 'home',
  retail: 'retail',
  ecommerce: 'retail',
  'e-commerce': 'retail',
  shop: 'retail',
  零售: 'retail',
  电商: 'retail',
  b2b: 'b2b',
  tech: 'b2b',
  saas: 'b2b',
  科技: 'b2b',
  clean: 'clean',
  simple: 'clean',
  简洁: 'clean',
  vivid: 'vivid',
  energetic: 'vivid',
  活力: 'vivid',
  premium: 'premium',
  luxury: 'premium',
  高端: 'premium',
}

function normKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

function isPresetId(value: string): value is PresetId {
  return (PRESET_IDS as readonly string[]).includes(value)
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label}必须是对象`)
  }
  return input as Record<string, unknown>
}

/** Drop style/look before a strict template schema sees the props. Same object when neither key is present. */
export function peelStyle(input: unknown): { body: unknown; style: unknown; look: unknown } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { body: input, style: undefined, look: undefined }
  }
  const raw = input as Record<string, unknown>
  const hasStyle = Object.prototype.hasOwnProperty.call(raw, 'style')
  const hasLook = Object.prototype.hasOwnProperty.call(raw, 'look')
  if (!hasStyle && !hasLook) return { body: input, style: undefined, look: undefined }
  const body: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    if (key === 'style' || key === 'look') continue
    body[key] = raw[key]
  }
  return { body, style: raw.style, look: raw.look }
}

function presetFromIndustry(industry: string): PresetId {
  const key = normKey(industry)
  const id = INDUSTRY_TO_PRESET[key]
  if (!id) {
    const known = STYLE_PRESETS.filter((preset) => preset.kind === 'industry').map((preset) => preset.name).join('、')
    throw new Error(`不认识的行业「${industry.slice(0, 40)}」。可以用：${known}`)
  }
  return id
}

function choosePreset(raw: Record<string, unknown>): { id: PresetId; selection: SelectionReason } {
  if (raw.preset !== undefined) {
    if (typeof raw.preset !== 'string' || !isPresetId(normKey(raw.preset))) {
      throw new Error(`不认识的风格包。可以用：${PRESET_IDS.join('、')}`)
    }
    return { id: normKey(raw.preset) as PresetId, selection: 'preset' }
  }
  if (typeof raw.industry === 'string' && raw.industry.trim() !== '') {
    return { id: presetFromIndustry(raw.industry), selection: 'industry' }
  }
  return { id: 'clean', selection: 'clean' }
}

/** Resolve a filled style object. An empty object selects the generic clean pack. */
export function resolveStyle(input: unknown): ResolvedLook {
  const raw = asRecord(input, 'style')
  const chosen = choosePreset(raw)
  const preset = presetById(chosen.id)
  if (!preset) throw new Error(`不认识的风格包 ${chosen.id}`)
  return applyBrand(preset, readBrand(raw.brand), chosen.selection, readRules(raw.rules))
}

function hexField(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isHexColor(value)) throw new Error(`已解析风格的${label}不是颜色`)
  return value.toLowerCase()
}

/** Re-apply the contrast floor and pin the safe area on a look that already rode along in props. */
export function coerceLook(input: unknown): ResolvedLook {
  const raw = asRecord(input, 'look')
  if (typeof raw.presetId !== 'string' || !isPresetId(raw.presetId)) {
    throw new Error('已解析风格缺少风格包 id')
  }
  const look = raw as unknown as ResolvedLook
  const cardBg = flattenCss(look.card.fill)
  const brand = hexField(look.colors?.brand, '品牌色')
  return {
    ...look,
    colors: {
      ...look.colors,
      brand,
      text: ensureContrast(hexField(look.colors?.text, '文字色'), cardBg, AA_NORMAL),
      muted: ensureContrast(hexField(look.colors?.muted, '次文字色'), cardBg, AA_NORMAL),
      textOnBrand: ensureContrast(hexField(look.colors?.textOnBrand, '品牌上的文字色'), brand, AA_NORMAL),
      brandInk: ensureContrast(hexField(look.colors?.brandInk, '品牌文字色'), cardBg, AA_NORMAL),
      onSurface: ensureContrast(hexField(look.colors?.onSurface, '辅色上的文字色'), hexField(look.colors?.surface, '辅色'), AA_NORMAL),
    },
    card: {
      ...look.card,
      placeColor: ensureContrast(hexField(look.card?.placeColor, '标签色'), cardBg, AA_NORMAL),
      lineColor: ensureContrast(hexField(look.card?.lineColor, '正文色'), cardBg, AA_NORMAL),
    },
    craft: craftById(look.presetId),
    rules: readRules(look.rules),
    safe: safeZone(),
  }
}

/**
 * Absent or null style keeps today's picture.
 * A carried look (already resolved on a previous pass) is reused.
 */
export function resolveRenderLook(style: unknown, carried: unknown): ResolvedLook | null {
  if (style !== undefined && style !== null) return resolveStyle(style)
  if (carried !== undefined && carried !== null) return coerceLook(carried)
  return null
}
