/**
 * Fixed marketing_plans id for one prescription version.
 * A repeat insert hits the primary key and cannot create a second row.
 */

import { createHash } from 'node:crypto'

/** Project namespace. Not a client id and not a customer fact. */
export const PLAN_DRAFT_NAMESPACE = 'a3c1e5b0-7d24-4f88-9a11-0b2c4d6e8f10'

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('namespace must be a uuid')
  return Buffer.from(hex, 'hex')
}

/** RFC 4122 UUID version 5 (SHA-1). */
export function uuidV5(namespace: string, name: string): string {
  const hash = createHash('sha1').update(uuidToBytes(namespace)).update(name, 'utf8').digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function planDraftId(prescriptionId: string, version: number): string {
  return uuidV5(PLAN_DRAFT_NAMESPACE, `${prescriptionId}:${version}`)
}
