import Dypnsapi20170525, {
  CheckSmsVerifyCodeRequest,
  SendSmsVerifyCodeRequest,
} from '@alicloud/dypnsapi20170525'
import { Config } from '@alicloud/openapi-client'
import { RuntimeOptions } from '@alicloud/tea-util'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'

type SmsPurpose = 'auth' | 'phone-link'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error('SMS provider is not configured')
  return value
}

function createClient(): Dypnsapi20170525 {
  const config = new Config({
    accessKeyId: requiredEnv('ALICLOUD_ACCESS_KEY_ID'),
    accessKeySecret: requiredEnv('ALICLOUD_ACCESS_KEY_SECRET'),
  })
  config.endpoint = 'dypnsapi.aliyuncs.com'
  return new Dypnsapi20170525(config)
}

function toLocalNumber(phone: string): string {
  const normalized = normalizeChinaPhone(phone)
  if (!normalized) throw new Error('Invalid mainland China phone number')
  return normalized.slice(3)
}

function templateParam(code: string): string {
  return JSON.stringify({ code, min: '5' })
}

/** Send the exact GoTrue OTP or ask PNVS to create a code for phone linking. */
export async function sendChinaVerificationCode(
  phone: string,
  purpose: SmsPurpose,
  otp?: string,
): Promise<void> {
  const client = createClient()
  const generated = purpose === 'phone-link'
  if (!generated && (!otp || !/^\d{4,8}$/.test(otp))) {
    throw new Error('Invalid authentication code')
  }

  const response = await client.sendSmsVerifyCodeWithOptions(
    new SendSmsVerifyCodeRequest({
      countryCode: '86',
      phoneNumber: toLocalNumber(phone),
      signName: requiredEnv('PNVS_SIGN_NAME'),
      templateCode: requiredEnv('PNVS_TEMPLATE_CODE'),
      templateParam: templateParam(generated ? '##code##' : otp!),
      codeLength: 6,
      codeType: 1,
      validTime: 300,
      interval: 60,
      duplicatePolicy: 1,
      returnVerifyCode: false,
    }),
    new RuntimeOptions({ connectTimeout: 3_000, readTimeout: 5_000 }),
  )

  if (response.body?.success !== true || response.body.code !== 'OK') {
    throw new Error('SMS provider rejected the request')
  }
}

export async function verifyChinaPhoneCode(phone: string, code: string): Promise<boolean> {
  if (!/^\d{4,8}$/.test(code)) return false
  const response = await createClient().checkSmsVerifyCodeWithOptions(
    new CheckSmsVerifyCodeRequest({
      countryCode: '86',
      phoneNumber: toLocalNumber(phone),
      verifyCode: code,
    }),
    new RuntimeOptions({ connectTimeout: 3_000, readTimeout: 5_000 }),
  )

  return response.body?.code === 'OK' && response.body.model?.verifyResult === 'PASS'
}
