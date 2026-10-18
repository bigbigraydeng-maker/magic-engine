import { describe, expect, it } from 'vitest'
import { findCallerNumber, noticeTwiml, outboundBridgeTwiml, outboundNumberAllowed, parseAllowedPrefixes, staffPhoneForEmail, startOutboundCall } from '../outbound'

const ACC = 'AC' + 'a'.repeat(32)
const CONN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })

describe('staffPhoneForEmail', () => {
  it('按邮箱反查手机号（不分大小写）；没登记 / 多个号码 / 号码格式不对都不猜', () => {
    expect(staffPhoneForEmail({ '+64210000099': 'Staff@Example.test' }, 'staff@example.test')).toBe('+64210000099')
    expect(staffPhoneForEmail({ '+64210000099': 'a@x.test' }, 'b@x.test')).toBeNull()
    expect(staffPhoneForEmail({ '+64210000099': 'a@x.test', '+64210000098': 'a@x.test' }, 'a@x.test')).toBeNull()
    expect(staffPhoneForEmail({ '021 000': 'a@x.test' }, 'a@x.test')).toBeNull()
    expect(staffPhoneForEmail({ '+64210000099': 'a@x.test' }, '')).toBeNull()
  })
})

describe('TwiML', () => {
  it('桥接：双声道录音、告知挂在客户那一段、地址被转义', () => {
    const x = outboundBridgeTwiml({ customer: '+64210000001', callerId: '+6498000000', dialActionUrl: 'https://h/dial?cp=%2B64210000001&a=1', recordingCallbackUrl: 'https://h/recording', noticeUrl: 'https://h/notice' })
    expect(x).toContain('record="record-from-answer-dual"')
    expect(x).toContain('<Number url="https://h/notice">+64210000001</Number>')
    expect(x).toContain('callerId="+6498000000"')
    expect(x).toContain('cp=%2B64210000001&amp;a=1')
  })
  it('号码格式不对就不生成', () => {
    expect(() => outboundBridgeTwiml({ customer: '021 000', callerId: '+6498000000', dialActionUrl: 'u', recordingCallbackUrl: 'r', noticeUrl: 'n' })).toThrow()
  })
  it('告知语音', () => expect(noticeTwiml()).toContain('may be recorded'))
})

describe('findCallerNumber / startOutboundCall', () => {
  const numbers = { incoming_phone_numbers: [{ phone_number: '+6411111111', voice_url: 'https://other' }, { phone_number: '+6498000000', voice_url: `https://h/api/webhooks/twilio/${CONN}/voice` }] }

  it('找来电地址指向这条连接的号码；找不到就报错', async () => {
    expect(await findCallerNumber({ accountSid: ACC, authToken: 't', connectionId: CONN, fetcher: (async () => json(numbers)) as unknown as typeof fetch })).toBe('+6498000000')
    await expect(findCallerNumber({ accountSid: ACC, authToken: 't', connectionId: 'zzz', fetcher: (async () => json(numbers)) as unknown as typeof fetch })).rejects.toThrow()
  })

  it('发起外呼：先打员工，TwiML 里带客户，回调地址带验签覆盖的 cp', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('IncomingPhoneNumbers')) return json(numbers)
      calls.push({ url: String(url), body: String(init?.body) })
      return json({ sid: 'CAnew' }, 201)
    }) as unknown as typeof fetch
    const out = await startOutboundCall({ accountSid: ACC, authToken: 't', connectionId: CONN, staffPhone: '+64210000099', customer: '+64210000001', baseUrl: 'https://h', fetcher })
    expect(out).toEqual({ callSid: 'CAnew' })
    const p = new URLSearchParams(calls[0].body)
    expect(p.get('To')).toBe('+64210000099')
    expect(p.get('From')).toBe('+6498000000')
    expect(p.get('Twiml')).toContain('+64210000001')
    expect(p.get('StatusCallback')).toBe(`https://h/api/webhooks/twilio/${CONN}/status?cp=%2B64210000001`)
    expect(p.getAll('StatusCallbackEvent')).toContain('completed')
  })

  it('号码格式不对 / 接口报错 → 报错，不假装成功', async () => {
    await expect(startOutboundCall({ accountSid: ACC, authToken: 't', connectionId: CONN, staffPhone: 'x', customer: '+64210000001', baseUrl: 'https://h' })).rejects.toThrow()
    const fetcher = (async (url: string) => (String(url).includes('IncomingPhoneNumbers') ? json(numbers) : json({}, 400))) as unknown as typeof fetch
    await expect(startOutboundCall({ accountSid: ACC, authToken: 't', connectionId: CONN, staffPhone: '+64210000099', customer: '+64210000001', baseUrl: 'https://h', fetcher })).rejects.toThrow('400')
  })
})

describe('号码放行名单', () => {
  it('默认只放新西兰，澳洲等其余国家与高价号段都不放', () => {
    expect(outboundNumberAllowed('+6421841210')).toBe(true)
    expect(outboundNumberAllowed('+61412345678')).toBe(false)
    expect(outboundNumberAllowed('+8613800138000')).toBe(false)
    expect(outboundNumberAllowed('+882123456789')).toBe(false)
    expect(outboundNumberAllowed('+64900123456')).toBe(false)
    expect(outboundNumberAllowed('+611900123456')).toBe(false)
    expect(outboundNumberAllowed('021 000 0001')).toBe(false)
  })
  it('环境变量可加国家；写坏了回到默认', () => {
    expect(outboundNumberAllowed('+8613800138000', parseAllowedPrefixes('+86, +64'))).toBe(true)
    expect(parseAllowedPrefixes('86;;abc')).toEqual(['+64'])
    expect(parseAllowedPrefixes(undefined)).toEqual(['+64'])
    // 环境变量仍可显式加回澳洲
    expect(outboundNumberAllowed('+61412345678', parseAllowedPrefixes('+64,+61'))).toBe(true)
  })
})
