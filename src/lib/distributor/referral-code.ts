/** Referral codes: 8 characters, unambiguous alphabet (no 0/O, 1/I), so one read over the phone still works. */
import { randomInt } from 'crypto'

export const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const REFERRAL_CODE = /^[A-HJ-NP-Z2-9]{8}$/

export function newReferralCode(): string {
  let code = ''
  for (let i = 0; i < 8; i += 1) code += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)]
  return code
}

/** Accepts lower case, spaces and dashes as typed by a person; null if it cannot be a code. */
export function normaliseReferralCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.replace(/[\s-]/g, '').toUpperCase()
  return REFERRAL_CODE.test(code) ? code : null
}
