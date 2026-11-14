import { normaliseReferralCode } from '../referral-code'
import { MnConfigError } from './money'

/** One code per partner, one link per product. The code is the existing referral code. */
export function productShareLink(origin: string, productCode: string, referralCode: string): { code: string; url: string } {
  const code = normaliseReferralCode(referralCode)
  if (!code) throw new MnConfigError('referral code is not usable')
  if (!/^[\w.-]+$/.test(productCode)) throw new MnConfigError('product code is not usable')
  const url = new URL(`/mn/p/${encodeURIComponent(productCode)}`, origin.endsWith('/') ? origin : `${origin}/`)
  url.searchParams.set('ref', code)
  return { code, url: url.toString() }
}
