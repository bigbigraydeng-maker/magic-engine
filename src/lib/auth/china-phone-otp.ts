import 'server-only'
import { createHmac } from 'node:crypto'

export function isChinaPhoneOtpEnabled(): boolean {
  return process.env.CHINA_PHONE_OTP_ENABLED === 'true'
}

export function chinaPhoneSmsDailyMax(): number | null {
  const cap = Number.parseInt(process.env.CHINA_PHONE_SMS_DAILY_MAX ?? '', 10)
  return Number.isSafeInteger(cap) && cap > 0 ? cap : null
}

export function isChinaPhoneSignupEnabled(): boolean {
  return isChinaPhoneOtpEnabled()
    && process.env.CHINA_PHONE_SIGNUP_ENABLED === 'true'
    && chinaPhoneSmsDailyMax() !== null
}

/** Keep raw phone numbers and webhook IDs out of the persistent quota table. */
export function phoneQuotaKey(value: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Phone quota key is not configured')
  return createHmac('sha256', key).update(value).digest('hex')
}
