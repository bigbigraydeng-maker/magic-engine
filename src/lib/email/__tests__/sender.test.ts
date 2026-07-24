/**
 * The sender must never regress to the provider's sandbox address.
 *
 * That regression is invisible in every normal check — the code compiles, the
 * send call returns, and the failure only shows up as a 403 in the provider's
 * log while alerts and contact-form enquiries quietly go nowhere (2026-07-24).
 */

import { describe, it, expect } from 'vitest'
import { meMailFrom, ME_MAIL_FROM_ADDRESS } from '../sender'

describe('meMailFrom — must send from a verified domain', () => {
  it('never uses the provider sandbox sender', () => {
    expect(ME_MAIL_FROM_ADDRESS).not.toContain('resend.dev')
    expect(meMailFrom('Whatever')).not.toContain('resend.dev')
  })

  it('defaults to the proven verified-domain address', () => {
    expect(ME_MAIL_FROM_ADDRESS).toBe('hello@magicengine.cloud')
  })

  it('wraps the address in a labelled From header', () => {
    expect(meMailFrom('Magic Engine 广告自检')).toBe(
      'Magic Engine 广告自检 <hello@magicengine.cloud>',
    )
  })
})
