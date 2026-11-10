/**
 * Address of the standalone Magic Network site (PM 2026-11-10: Magic Network leaves ME).
 * Set MAGIC_NETWORK_URL once the real domain is registered; until then the temporary Render address.
 */
const DEFAULT_URL = 'https://magic-network.onrender.com'

type Params = Record<string, string | string[] | undefined>

/** Absolute URL on the Magic Network site for `path`, carrying the visitor's query string (e.g. ?ref=). */
export function magicNetworkUrl(path: string, params: Params = {}): string {
  const base = (process.env.MAGIC_NETWORK_URL || DEFAULT_URL).replace(/\/+$/, '')
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v)
  }
  const qs = query.toString()
  return `${base}${path}${qs ? `?${qs}` : ''}`
}
