import { LOGO_EXTS, SAFE_REL_PATH } from '../schema.ts'
import { AA_NORMAL, ensureContrast, flattenCss, isHexColor } from './contrast.ts'
import { craftById } from './craft.ts'
import type { ViralRules } from './rules.ts'
import type { BrandInput, FontRole, ResolvedLook, StylePreset } from './types.ts'
import { safeZone } from './safe.ts'

const ROLES: readonly FontRole[] = ['sans', 'serif', 'display']

function isRole(value: string): value is FontRole {
  return (ROLES as readonly string[]).includes(value)
}

function hexOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isHexColor(value)) {
    throw new Error(`${label}必须是 #RRGGBB`)
  }
  return value.toLowerCase()
}

function logoOf(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REL_PATH.test(value)) {
    throw new Error('品牌 logo 只能是相对文件名')
  }
  const lower = value.toLowerCase()
  if (!LOGO_EXTS.some((ext) => lower.endsWith(ext))) {
    throw new Error('品牌 logo 扩展名只能是 .png/.jpg/.jpeg/.webp')
  }
  return value
}

/** Read a brand kit. Missing fields are omitted so the preset can fill them. */
export function readBrand(input: unknown): BrandInput {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('style.brand 必须是对象')
  }
  const raw = input as Record<string, unknown>
  const brand: BrandInput = {}
  if (raw.primary !== undefined) brand.primary = hexOf(raw.primary, '品牌主色')
  if (raw.secondary !== undefined) brand.secondary = hexOf(raw.secondary, '品牌辅色')
  if (raw.logo !== undefined) brand.logo = logoOf(raw.logo)
  if (raw.font !== undefined) {
    if (typeof raw.font !== 'string' || raw.font.trim() === '') {
      throw new Error('字体偏好必须是 sans、serif 或 display')
    }
    brand.font = raw.font.trim().toLowerCase()
  }
  return brand
}

function roleOf(font: string | undefined, preset: StylePreset): FontRole {
  if (font !== undefined && isRole(font)) return font
  return preset.fonts.defaultRole
}

function hexToRgba(hex: string, alpha: number): string {
  const n = (index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
  return `rgba(${n(0)},${n(1)},${n(2)},${alpha})`
}

/** Lay a brand kit over a preset and lift text until it clears WCAG AA. */
export function applyBrand(preset: StylePreset, brand: BrandInput, selection: ResolvedLook['selection'], rules: ViralRules): ResolvedLook {
  const role = roleOf(brand.font, preset)
  const pair = preset.fonts[role]
  const brandColor = brand.primary ?? preset.colors.brand
  const surface = brand.secondary ?? preset.colors.surface
  const fill = brand.secondary ? hexToRgba(brand.secondary, 0.94) : preset.card.fill
  const cardBg = flattenCss(fill)
  const placeSource = brand.primary ? brandColor : preset.card.placeColor
  const look: ResolvedLook = {
    presetId: preset.id,
    name: preset.name,
    selection,
    fonts: { latinId: pair.latinId, cjkId: pair.cjkId, role },
    colors: {
      canvas: preset.colors.canvas,
      surface,
      brand: brandColor,
      accent: brand.secondary ?? preset.colors.accent,
      text: ensureContrast(preset.colors.text, cardBg, AA_NORMAL),
      muted: ensureContrast(preset.colors.muted, cardBg, AA_NORMAL),
      textOnBrand: ensureContrast('#ffffff', brandColor, AA_NORMAL),
      brandInk: ensureContrast(brandColor, cardBg, AA_NORMAL),
      onSurface: ensureContrast(preset.colors.text, surface, AA_NORMAL),
    },
    type: preset.type,
    shape: {
      ...preset.shape,
      strokeColor: brand.secondary ?? preset.shape.strokeColor,
    },
    motion: preset.motion,
    card: {
      fill,
      placeColor: ensureContrast(placeSource, cardBg, AA_NORMAL),
      lineColor: ensureContrast(preset.card.lineColor, cardBg, AA_NORMAL),
      shadow: preset.card.shadow,
    },
    craft: craftById(preset.id),
    rules,
    safe: safeZone(),
  }
  if (brand.logo !== undefined) look.logoFile = brand.logo
  return look
}
