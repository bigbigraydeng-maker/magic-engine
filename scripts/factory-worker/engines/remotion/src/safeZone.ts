/** Safe-zone insets. 9:16 matches the Reels/TikTok numbers already used by the templates. */

export const SAFE_LEFT = 60
export const SAFE_TOP = 270
export const SAFE_BOTTOM = 1248
export const SAFE_RIGHT = 960

/** Corner wordmark box. Must stay in sync with the Logo component. */
export const CORNER_LOGO = { left: 54, top: 292, width: 470, height: 171 }

export interface SafeRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function rect(left: number, top: number, right: number, bottom: number): SafeRect {
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

/** Safe rectangle for a canvas. Portrait uses the 9:16 Reels insets; other shapes keep a caption margin. */
export function safeRectFor(width: number, height: number): SafeRect {
  const portrait = height / Math.max(1, width) >= 1.2
  if (portrait) {
    const sx = width / 1080
    const sy = height / 1920
    return rect(
      Math.round(SAFE_LEFT * sx),
      Math.round(SAFE_TOP * sy),
      Math.round(SAFE_RIGHT * sx),
      Math.round(SAFE_BOTTOM * sy),
    )
  }
  return rect(
    Math.round(width * 0.07),
    Math.round(height * 0.08),
    Math.round(width * 0.93),
    Math.round(height * 0.78),
  )
}

/** Black or white, whichever stays readable on the given #RRGGBB fill. */
export function readableOn(hex: string): '#111111' | '#ffffff' {
  const raw = hex.replace('#', '')
  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return y > 0.62 ? '#111111' : '#ffffff'
}
