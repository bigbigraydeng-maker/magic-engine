/**
 * Plain sentences for the go-live card. No code punctuation, no secrets.
 */

const FORBIDDEN = /[{}[\]`]/

export function plainClip(value: string, max = 160): string {
  return value.replace(/[{}[\]`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** A label a person can read. Rejects blanks, code, and over-long text. */
export function usableLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > 180 || FORBIDDEN.test(text)) return null
  if (/act_\d/i.test(text)) return null
  return text
}

/** Drop token-shaped fragments before a failure is shown or stored. */
export function publicFailure(error: string): string {
  const stripped = error
    .replace(/access_token=[^&\s]+/gi, '')
    .replace(/EAA[A-Za-z0-9]+/g, '')
  return plainClip(stripped, 180) || '开投没有完成'
}
