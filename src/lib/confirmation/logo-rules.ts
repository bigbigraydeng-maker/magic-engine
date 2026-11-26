/** Pure logo checks, safe for the browser bundle (no JSZip, no Buffer). */

/** A logo is a small PNG/JPEG data URI. The browser shrinks uploads before they get here. */
export const MAX_LOGO_CHARS = 1_500_000
const LOGO_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/

export function isLogo(v: unknown): v is string {
  return typeof v === 'string' && (v === '' || (v.length <= MAX_LOGO_CHARS && LOGO_RE.test(v)))
}
