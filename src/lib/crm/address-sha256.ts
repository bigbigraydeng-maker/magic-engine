/**
 * The fingerprint of an e-mail address that ME stores instead of the address itself (send ledger, unsubscribe records):
 * SHA-256 of the trimmed, lower-cased address, as hex. It must stay byte-for-byte the same as the send ledger's
 * `addressSha256` (src/lib/messaging/triggered-send/shadow-store.ts); a test pins the two together.
 */

import { createHash } from 'node:crypto'

export function emailAddressSha256(address: string): string {
  return createHash('sha256').update(address.trim().toLowerCase()).digest('hex')
}

/** The fingerprints of every usable address, without duplicates. Blank entries are left out. */
export function emailAddressSha256s(addresses: readonly string[]): string[] {
  const out = new Set<string>()
  for (const address of addresses) {
    if (address.trim() !== '') out.add(emailAddressSha256(address))
  }
  return Array.from(out)
}
