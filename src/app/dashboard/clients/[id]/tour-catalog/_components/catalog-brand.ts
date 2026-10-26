import type { CSSProperties } from 'react'
import type { CatalogSettings } from '@/lib/tour-catalog/catalog-contract'

/** Where page feedback goes. */
export const FEEDBACK_EMAIL = 'hello@magicengine.cloud'
export const FEEDBACK_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('团目录反馈')}`

export const NEUTRAL_BRAND = '#1A1A1A' // charcoal
export const NEUTRAL_ACCENT = '#C4912E' // ochre
export const ON_BRAND_LIGHT = '#FFFFFF'
export const ON_BRAND_DARK = '#1A1A1A'

/** Tailwind classes that read the CSS variables with a neutral fallback, so they also work outside the branded container. */
export const BRAND_BUTTON_CLASS =
  'bg-[color:var(--tc-brand,#1A1A1A)] text-[color:var(--tc-on-brand,#FFFFFF)] hover:opacity-90'
export const BRAND_BADGE_CLASS =
  'bg-[color:var(--tc-brand,#1A1A1A)] text-[color:var(--tc-on-brand,#FFFFFF)]'
export const BRAND_SELECTED_BORDER_CLASS = 'border-[color:var(--tc-accent,#C4912E)]'
export const BRAND_BAND_CLASS = 'bg-[color:var(--tc-brand,#1A1A1A)]'
/** Secondary colour: thin lines and small labels only, never large fills. */
export const BRAND_LINE_CLASS = 'border-[color:var(--tc-brand-2,rgba(0,0,0,0.1))]'

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

export function relativeLuminance(hex: string): number {
  if (!isHexColor(hex)) return 0
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  const [r, g, b] = channels
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function onBrandTextColor(hex: string): string {
  return relativeLuminance(hex) > 0.6 ? ON_BRAND_DARK : ON_BRAND_LIGHT
}

export interface BrandTheme {
  /** True only when BOTH a usable logo and a valid primary colour exist. */
  branded: boolean
  logoUrl: string | null
  /** CSS custom properties for the outermost container. Empty object in neutral mode. */
  style: CSSProperties
}

function usableLogoUrl(logoUrl: unknown): string | null {
  if (typeof logoUrl !== 'string') return null
  const trimmed = logoUrl.trim()
  return trimmed.startsWith('https://') ? trimmed : null
}

export function brandTheme(
  settings: Pick<CatalogSettings, 'logoUrl' | 'brandPrimary' | 'brandSecondary'> | null | undefined,
): BrandTheme {
  const logoUrl = usableLogoUrl(settings?.logoUrl)
  const primary = settings?.brandPrimary
  if (!logoUrl || !isHexColor(primary)) {
    return { branded: false, logoUrl: null, style: {} }
  }
  const secondary = settings?.brandSecondary
  const style: Record<string, string> = {
    '--tc-brand': primary,
    '--tc-accent': primary,
    '--tc-on-brand': onBrandTextColor(primary),
    '--tc-brand-2': isHexColor(secondary) ? secondary : primary,
  }
  return { branded: true, logoUrl, style: style as CSSProperties }
}
