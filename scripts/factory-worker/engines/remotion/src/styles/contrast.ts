/** WCAG AA for normal text. Large type is allowed a lower bar; we hold this stricter floor. */
export const AA_NORMAL = 4.5

const HEX6 = /^#[0-9A-Fa-f]{6}$/

/** True for #RRGGBB. */
export function isHexColor(value: string): boolean {
  return HEX6.test(value)
}

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function srgb(value: number): number {
  const s = value / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of a #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  const r = srgb(channel(hex, 0))
  const g = srgb(channel(hex, 1))
  const b = srgb(channel(hex, 2))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const left = relativeLuminance(a)
  const right = relativeLuminance(b)
  const hi = Math.max(left, right)
  const lo = Math.min(left, right)
  return (hi + 0.05) / (lo + 0.05)
}

/** Mix a #RRGGBB colour over another at 0..1 alpha. */
export function compositeOver(front: string, alpha: number, back: string): string {
  const mix = (index: number) => Math.round(channel(front, index) * alpha + channel(back, index) * (1 - alpha))
  return toHex(mix(0), mix(1), mix(2))
}

function mixHex(from: string, to: string, amount: number): string {
  const mix = (index: number) => Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount)
  return toHex(mix(0), mix(1), mix(2))
}

/** Parse #RRGGBB or rgb/rgba(). Returns null when the string is not a colour. */
export function parseCssColor(input: string): { hex: string; alpha: number } | null {
  if (isHexColor(input)) return { hex: input.toLowerCase(), alpha: 1 }
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/.exec(input)
  if (!match) return null
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  if (!Number.isFinite(alpha)) return null
  return { hex: toHex(Number(match[1]), Number(match[2]), Number(match[3])), alpha }
}

/** Flatten a css colour over a solid backdrop so contrast can be measured. */
export function flattenCss(color: string, behind = '#111111'): string {
  const parsed = parseCssColor(color)
  if (!parsed) return behind
  if (parsed.alpha >= 1) return parsed.hex
  return compositeOver(parsed.hex, parsed.alpha, behind)
}

function bestExtreme(bg: string): string {
  const white = contrastRatio('#ffffff', bg)
  const black = contrastRatio('#000000', bg)
  return white >= black ? '#ffffff' : '#000000'
}

/**
 * Foreground that reaches `min` contrast against `bg`.
 * Keeps the original when it already passes, otherwise walks toward black or white.
 */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (!isHexColor(fg) || !isHexColor(bg)) return fg
  const front = fg.toLowerCase()
  const back = bg.toLowerCase()
  if (contrastRatio(front, back) >= min) return front
  const target = bestExtreme(back)
  if (contrastRatio(target, back) >= min) return target
  for (let step = 1; step <= 20; step++) {
    const next = mixHex(front, target, step / 20)
    if (contrastRatio(next, back) >= min) return next
  }
  return target
}
