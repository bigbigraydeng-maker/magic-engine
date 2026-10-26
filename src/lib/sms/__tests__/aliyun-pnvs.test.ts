import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  check: vi.fn(),
  Client: vi.fn(),
  SendSmsVerifyCodeRequest: vi.fn(),
  CheckSmsVerifyCodeRequest: vi.fn(),
}))

vi.mock('@alicloud/dypnsapi20170525', () => ({
  default: mocks.Client,
  SendSmsVerifyCodeRequest: mocks.SendSmsVerifyCodeRequest,
  CheckSmsVerifyCodeRequest: mocks.CheckSmsVerifyCodeRequest,
}))
vi.mock('@alicloud/openapi-client', () => ({
  Config: class Config {
    [key: string]: unknown
    constructor(values: Record<string, unknown>) { Object.assign(this, values) }
  },
}))
vi.mock('@alicloud/tea-util', () => ({
  RuntimeOptions: class RuntimeOptions {
    [key: string]: unknown
    constructor(values: Record<string, unknown>) { Object.assign(this, values) }
  },
}))

import { sendChinaVerificationCode, verifyChinaPhoneCode } from '../aliyun-pnvs'

describe('Aliyun PNVS adapter', () => {
  beforeEach(() => {
    vi.stubEnv('ALICLOUD_ACCESS_KEY_ID', 'test-id')
    vi.stubEnv('ALICLOUD_ACCESS_KEY_SECRET', 'test-secret')
    vi.stubEnv('PNVS_SIGN_NAME', 'system-sign')
    vi.stubEnv('PNVS_TEMPLATE_CODE', 'system-template')
    mocks.send.mockReset().mockResolvedValue({ body: { success: true, code: 'OK' } })
    mocks.check.mockReset().mockResolvedValue({ body: { code: 'OK', model: { verifyResult: 'PASS' } } })
    mocks.Client.mockReset().mockImplementation(() => ({
      sendSmsVerifyCodeWithOptions: mocks.send,
      checkSmsVerifyCodeWithOptions: mocks.check,
    }))
    mocks.SendSmsVerifyCodeRequest.mockReset().mockImplementation((fields: unknown) => fields)
    mocks.CheckSmsVerifyCodeRequest.mockReset().mockImplementation((fields: unknown) => fields)
  })

  it('sends the Supabase OTP verbatim using the mainland service and bounded timeouts', async () => {
    await sendChinaVerificationCode('+8613800001380', 'auth', '123456')

    const request = mocks.send.mock.calls[0][0] as Record<string, unknown>
    const runtime = mocks.send.mock.calls[0][1] as Record<string, unknown>
    expect(request).toMatchObject({
      countryCode: '86',
      phoneNumber: '13800001380',
      signName: 'system-sign',
      templateCode: 'system-template',
      templateParam: JSON.stringify({ code: '123456', min: '5' }),
      codeLength: 6,
      codeType: 1,
      validTime: 300,
      interval: 60,
      duplicatePolicy: 1,
      returnVerifyCode: false,
    })
    expect(runtime).toMatchObject({ connectTimeout: 3_000, readTimeout: 5_000 })
  })

  it('asks PNVS to create a code for account-phone linking', async () => {
    await sendChinaVerificationCode('+8613800001380', 'phone-link')
    const request = mocks.send.mock.calls[0][0] as Record<string, unknown>
    expect(request.templateParam).toBe(JSON.stringify({ code: '##code##', min: '5' }))
  })

  it('fails closed on provider errors and missing configuration', async () => {
    mocks.send.mockResolvedValueOnce({ body: { success: false, code: 'BUSINESS_LIMIT_CONTROL' } })
    await expect(sendChinaVerificationCode('+8613800001380', 'auth', '123456'))
      .rejects.toThrow('SMS provider rejected the request')

    vi.stubEnv('ALICLOUD_ACCESS_KEY_SECRET', '')
    await expect(sendChinaVerificationCode('+8613800001380', 'phone-link'))
      .rejects.toThrow('SMS provider is not configured')
  })

  it('accepts only a positive PNVS verification result', async () => {
    await expect(verifyChinaPhoneCode('+8613800001380', '123456')).resolves.toBe(true)
    expect(mocks.check).toHaveBeenCalledWith(
      expect.objectContaining({ countryCode: '86', phoneNumber: '13800001380', verifyCode: '123456' }),
      expect.objectContaining({ readTimeout: 5_000 }),
    )

    mocks.check.mockResolvedValueOnce({ body: { code: 'OK', model: { verifyResult: 'UNKNOWN' } } })
    await expect(verifyChinaPhoneCode('+8613800001380', '123456')).resolves.toBe(false)
  })
})
