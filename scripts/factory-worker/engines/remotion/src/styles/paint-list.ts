import type { ResolvedLook } from './types.ts'

/** Price card colours. Omitted means the price card keeps its original paint. */
export interface PriceChrome {
  fontFamily: string
  brand: string
  textOnBrand: string
  ink: string
  surface: string
  onSurface: string
  chipRadius: number
  qualifierRadius: number
}

/** Brand colours for the price card. Only used once a style pack is on. */
export function priceChrome(look: ResolvedLook, family: string): PriceChrome {
  return {
    fontFamily: family,
    brand: look.colors.brand,
    textOnBrand: look.colors.textOnBrand,
    ink: look.colors.brandInk,
    surface: look.colors.surface,
    onSurface: look.colors.onSurface,
    chipRadius: look.shape.radiusChip,
    qualifierRadius: look.shape.radiusChip,
  }
}


/** Plain style bags for the checklist template. */
export interface ListPaint {
  hook: Record<string, string | number>
  line: Record<string, string | number>
  badge: Record<string, string | number>
  highlight: Record<string, string | number>
  block: Record<string, string | number>
  label: Record<string, string | number>
  stamp: Record<string, string | number>
  itemText: Record<string, string | number>
  track: Record<string, string | number>
  reveal: Record<string, string | number>
}

function legacyHook(family: string): Record<string, string | number> {
  return {
    position: 'absolute',
    left: 90,
    top: 640,
    width: 870,
    fontFamily: family,
    color: '#fff',
    textShadow: '0 6px 30px rgba(0,0,0,0.7)',
  }
}

function legacyLine(): Record<string, string | number> {
  return { fontSize: 118, fontWeight: 900, lineHeight: 1.12 }
}

function chip(brandColor: string, filled: boolean): Record<string, string | number> {
  if (filled) {
    return { color: '#fff', background: brandColor, padding: '0 16px', borderRadius: 10 }
  }
  return { color: brandColor, background: '#fff', padding: '0 16px', borderRadius: 10, marginRight: 18 }
}

/** Checklist chrome. A null look returns the styles the template used before style packs existed. */
export function listPaint(look: ResolvedLook | null, brandColor: string, family: string, labelSize: number, revealSize: number): ListPaint {
  if (!look) return legacyList(brandColor, family, labelSize, revealSize)
  return styledList(look, family, labelSize, revealSize)
}

function legacyList(brandColor: string, family: string, labelSize: number, revealSize: number): ListPaint {
  return {
    hook: legacyHook(family),
    line: legacyLine(),
    badge: chip(brandColor, false),
    highlight: chip(brandColor, true),
    block: {
      position: 'absolute',
      left: 90,
      top: 640,
      width: 870,
      fontFamily: family,
      color: '#fff',
      textShadow: '0 4px 24px rgba(0,0,0,0.85)',
    },
    label: { fontSize: labelSize, fontWeight: 900, letterSpacing: 4, opacity: 0.95 },
    stamp: {
      width: 150,
      height: 150,
      flex: '0 0 150px',
      borderRadius: 28,
      background: brandColor,
      color: '#fff',
      fontSize: 110,
      fontWeight: 900,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      textShadow: 'none',
    },
    itemText: { fontSize: 66, fontWeight: 900, lineHeight: 1.08, marginLeft: 28 },
    track: {
      position: 'absolute',
      left: 90,
      top: 1170,
      width: 780,
      height: 12,
      borderRadius: 6,
      background: 'rgba(255,255,255,0.3)',
      fill: brandColor,
    },
    reveal: {
      position: 'absolute',
      left: 90,
      top: 556,
      width: 900,
      fontFamily: family,
      color: '#fff',
      fontSize: revealSize,
      fontWeight: 900,
      textShadow: '0 4px 24px rgba(0,0,0,0.6)',
    },
  }
}

function styledChip(look: ResolvedLook, filled: boolean): Record<string, string | number> {
  const radius = look.shape.radiusChip
  if (filled) {
    return { color: look.colors.textOnBrand, background: look.colors.brand, padding: '0 16px', borderRadius: radius }
  }
  return {
    color: look.colors.brandInk,
    background: look.colors.surface,
    padding: '0 16px',
    borderRadius: radius,
    marginRight: 18,
  }
}

function styledList(look: ResolvedLook, family: string, labelSize: number, revealSize: number): ListPaint {
  const plate = {
    boxSizing: 'border-box' as const,
    background: look.card.fill,
    borderRadius: look.shape.radiusCard,
    border: look.shape.strokeWidth > 0 ? `${look.shape.strokeWidth}px solid ${look.shape.strokeColor}` : 'none',
    padding: '18px 22px',
  }
  return {
    hook: {
      position: 'absolute',
      left: 90,
      top: 640,
      width: 870,
      fontFamily: family,
      color: look.card.lineColor,
      textShadow: 'none',
      ...plate,
    },
    line: { fontSize: look.type.hook, fontWeight: look.type.weightHook, lineHeight: 1.12 },
    badge: styledChip(look, false),
    highlight: styledChip(look, true),
    block: {
      position: 'absolute',
      left: 90,
      top: 640,
      width: 870,
      fontFamily: family,
      color: look.card.lineColor,
      textShadow: 'none',
      ...plate,
    },
    label: {
      fontSize: labelSize,
      fontWeight: look.type.weightLabel,
      letterSpacing: look.type.trackingLabel,
      opacity: 0.95,
      color: look.card.placeColor,
      textTransform: look.type.labelCase === 'upper' ? 'uppercase' : 'none',
    },
    stamp: {
      width: 150,
      height: 150,
      flex: '0 0 150px',
      borderRadius: Math.max(look.shape.radiusChip, 8),
      background: look.colors.brand,
      color: look.colors.textOnBrand,
      fontSize: 110,
      fontWeight: 900,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: look.card.shadow,
      textShadow: 'none',
    },
    itemText: { fontSize: look.type.body, fontWeight: look.type.weightBody, lineHeight: 1.08, marginLeft: 28 },
    track: {
      position: 'absolute',
      left: 90,
      top: 1170,
      width: 780,
      height: 12,
      borderRadius: 6,
      background: 'rgba(255,255,255,0.3)',
      fill: look.colors.brand,
    },
    reveal: {
      position: 'absolute',
      left: 90,
      top: 556,
      width: 900,
      boxSizing: 'border-box',
      fontFamily: family,
      color: look.card.lineColor,
      fontSize: revealSize,
      fontWeight: look.type.weightTitle,
      textShadow: 'none',
      background: look.card.fill,
      borderRadius: look.shape.radiusCard,
      padding: '12px 18px',
    },
  }
}
