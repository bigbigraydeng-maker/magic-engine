/**
 * The address fingerprint must be byte-for-byte the send ledger's own: the weekly cap and the unsubscribe check find
 * ME's mails and unsubscribes by it. If the two ever drifted apart, a guest would silently stop being counted.
 */

import { describe, expect, it } from 'vitest'
import { addressSha256 } from '@/lib/messaging/triggered-send/shadow-store'
import { emailAddressSha256, emailAddressSha256s } from '../address-sha256'

describe('emailAddressSha256', () => {
  it.each(['amy@example.com', '  Amy@Example.COM ', 'li.wei+tours@gmail.com', 'ÉLODIE@exemple.fr'])('is the ledger fingerprint for %j', (address) => {
    expect(emailAddressSha256(address)).toBe(addressSha256(address))
  })

  it('ignores case and surrounding spaces, and is hex', () => {
    expect(emailAddressSha256(' AMY@example.com')).toBe(emailAddressSha256('amy@example.com'))
    expect(emailAddressSha256('amy@example.com')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a list keeps one fingerprint per address and drops blanks', () => {
    expect(emailAddressSha256s(['amy@example.com', 'AMY@example.com', '  ', 'b@x.co'])).toEqual([
      emailAddressSha256('amy@example.com'),
      emailAddressSha256('b@x.co'),
    ])
  })
})
