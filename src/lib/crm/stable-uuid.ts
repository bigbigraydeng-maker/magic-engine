/**
 * A stable UUID (version 5 layout) from a seed: the same seed always gives the same id.
 * Used for request ids that must be the same on every page load, so the send route can refuse a second send.
 * Imports nothing but the hash: safe to use from any module, client or server side of the data layer.
 */

import { createHash } from 'node:crypto'

export function uuidFromSeed(seed: string): string {
  const h = createHash('sha1').update(seed).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}
