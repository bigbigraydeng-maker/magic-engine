// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { Resend } from 'resend'
import {
  loadResendWebhookSecret,
  verifyResendSignature,
  resendSecretEnvName,
  REPLAY_WINDOW_SEC,
} from '../resend-signature'

// 独立签名实现：不 import 被测工具里的 signWebhook / computeSignature，避免「自己验自己」。
function signIndependent(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  return 'v1,' + createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
}

const SECRET = 'whsec_' + 'ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3'
const OTHER_SECRET = 'whsec_' + 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek'

// 当前真实时钟（秒）。时间窗用例必须用真实时钟，不用 fake timers。
function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

describe('A. fixed vectors', () => {
  it('1. Svix official docs example verifies', () => {
    const result = verifyResendSignature({
      bodyText: '{"test": 2432232314}',
      svixId: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      svixTimestamp: '1614265330',
      svixSignature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
      secret: 'whsec_' + 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      nowSec: 1614265330,
    })
    expect(result).toEqual({ valid: true })
  })

  it('2. self-computed vector with CJK and emoji verifies', () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-11-01T01:02:03.000Z',
      data: {
        email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
        from: 'CTS Tours <info@example.com>',
        to: ['guest@example.com'],
        subject: '欢迎 🎉 Welcome to 2027 春季团',
      },
    })
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: '1730000000',
      svixSignature: 'v1,6mew4L6CTExk6ssGcBj/upLaKteo7tfykh2o5yPkgVU=',
      secret: SECRET,
      nowSec: 1730000000,
    })
    expect(result).toEqual({ valid: true })
  })
})

describe('B. rejection paths', () => {
  it('3. tampered body yields signature_mismatch', () => {
    const ts = String(nowSec())
    const body = '{"type":"email.delivered"}'
    const sig = signIndependent(SECRET, ID, ts, body)
    const result = verifyResendSignature({
      bodyText: '{"type":"email.delivered"!}',
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: sig,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' })
  })

  it('4. wrong secret yields signature_mismatch', () => {
    const ts = String(nowSec())
    const body = '{"type":"email.delivered"}'
    const sig = signIndependent(SECRET, ID, ts, body)
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: sig,
      secret: OTHER_SECRET,
    })
    expect(result).toEqual({ valid: false, reason: 'signature_mismatch' })
  })

  it('5a. missing svixId yields missing_headers', () => {
    const ts = String(nowSec())
    const body = '{"type":"email.delivered"}'
    const sig = signIndependent(SECRET, ID, ts, body)
    const result = verifyResendSignature({
      bodyText: body,
      svixId: null,
      svixTimestamp: ts,
      svixSignature: sig,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: false, reason: 'missing_headers' })
  })

  it('5b. missing svixTimestamp yields missing_headers', () => {
    const ts = String(nowSec())
    const body = '{"type":"email.delivered"}'
    const sig = signIndependent(SECRET, ID, ts, body)
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: null,
      svixSignature: sig,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: false, reason: 'missing_headers' })
  })

  it('5c. missing svixSignature yields missing_headers', () => {
    const ts = String(nowSec())
    const body = '{"type":"email.delivered"}'
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: null,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: false, reason: 'missing_headers' })
  })

  it('5d. empty svixSignature yields missing_headers', () => {
    const ts = String(nowSec())
    const body = '{"type":"email.delivered"}'
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: '',
      secret: SECRET,
    })
    expect(result).toEqual({ valid: false, reason: 'missing_headers' })
  })

  it('6. non-numeric timestamp yields bad_timestamp', () => {
    const body = '{"type":"email.delivered"}'
    const sig = signIndependent(SECRET, ID, 'abc', body)
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: 'abc',
      svixSignature: sig,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: false, reason: 'bad_timestamp' })
  })

  it('7a. timestamp now-299 is inside window', () => {
    const ts = String(nowSec() - 299)
    const body = '{"type":"email.delivered"}'
    const sig = signIndependent(SECRET, ID, ts, body)
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: sig,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: true })
  })

  it('7b. timestamp now-301 is outside window', () => {
    const ts = String(nowSec() - 301)
    const body = '{"type":"email.delivered"}'
    const sig = signIndependent(SECRET, ID, ts, body)
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: sig,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: false, reason: 'outside_window' })
  })

  it('7c. timestamp now+299 is inside window', () => {
    const ts = String(nowSec() + 299)
    const body = '{"type":"email.delivered"}'
    const sig = signIndependent(SECRET, ID, ts, body)
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: sig,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: true })
  })

  it('7d. timestamp now+301 is outside window (future side)', () => {
    const ts = String(nowSec() + 301)
    const body = '{"type":"email.delivered"}'
    const sig = signIndependent(SECRET, ID, ts, body)
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: sig,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: false, reason: 'outside_window' })
  })

  it('8a. wrong signature first, correct second still verifies', () => {
    const ts = String(nowSec())
    const body = '{"type":"email.delivered"}'
    const good = signIndependent(SECRET, ID, ts, body)
    const bad = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: `${bad} ${good}`,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: true })
  })

  it('8b. correct signature first, wrong second still verifies', () => {
    const ts = String(nowSec())
    const body = '{"type":"email.delivered"}'
    const good = signIndependent(SECRET, ID, ts, body)
    const bad = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: `${good} ${bad}`,
      secret: SECRET,
    })
    expect(result).toEqual({ valid: true })
  })

  it('8c. v2 prefix on otherwise-correct signature is invalid', () => {
    const ts = String(nowSec())
    const body = '{"type":"email.delivered"}'
    const good = signIndependent(SECRET, ID, ts, body)
    const v2 = 'v2,' + good.replace(/^v1,/, '')
    const result = verifyResendSignature({
      bodyText: body,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: v2,
      secret: SECRET,
    })
    expect(result.valid).toBe(false)
  })
})

describe('C. raw body fidelity', () => {
  it('9. signature over raw body verifies raw, not re-serialized JSON', () => {
    // 注意：源码里 \\u00e9 是反斜杠 + u00e9 的字面文本，不是 é。
    const raw = '{ "type" : "email.delivered",\n "data": {"email_id":"x","note":"caf\\u00e9"} }'
    const ts = String(nowSec())
    const sig = signIndependent(SECRET, ID, ts, raw)

    const rawResult = verifyResendSignature({
      bodyText: raw,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: sig,
      secret: SECRET,
    })
    expect(rawResult).toEqual({ valid: true })

    const reserialized = JSON.stringify(JSON.parse(raw))
    const reserializedResult = verifyResendSignature({
      bodyText: reserialized,
      svixId: ID,
      svixTimestamp: ts,
      svixSignature: sig,
      secret: SECRET,
    })
    expect(reserializedResult).toEqual({ valid: false, reason: 'signature_mismatch' })
  })
})

describe('D. cross-check against official Resend SDK', () => {
  // 用官方库独立判断有效性：不抛错 = 有效，抛错 = 无效。
  function officialValid(
    body: string,
    id: string,
    timestamp: string,
    signature: string,
    secret: string,
  ): boolean {
    try {
      new Resend('re_test_key').webhooks.verify({
        payload: body,
        headers: { id, timestamp, signature },
        webhookSecret: secret,
      })
      return true
    } catch {
      return false
    }
  }

  interface Scenario {
    name: string
    body: string
    id: string
    timestamp: string
    signature: string
    secret: string
  }

  const baseBody = '{"type":"email.delivered","data":{"email_id":"x"}}'
  const now = nowSec()
  const nowTs = String(now)
  const goodSig = signIndependent(SECRET, ID, nowTs, baseBody)

  const scenarios: Scenario[] = [
    {
      name: 'valid signature at current time',
      body: baseBody,
      id: ID,
      timestamp: nowTs,
      signature: goodSig,
      secret: SECRET,
    },
    {
      name: 'tampered body',
      body: baseBody + ' ',
      id: ID,
      timestamp: nowTs,
      signature: goodSig,
      secret: SECRET,
    },
    {
      name: 'wrong secret',
      body: baseBody,
      id: ID,
      timestamp: nowTs,
      signature: goodSig,
      secret: OTHER_SECRET,
    },
    {
      name: 'timestamp now-400',
      body: baseBody,
      id: ID,
      timestamp: String(now - 400),
      signature: signIndependent(SECRET, ID, String(now - 400), baseBody),
      secret: SECRET,
    },
    {
      name: 'timestamp now+400',
      body: baseBody,
      id: ID,
      timestamp: String(now + 400),
      signature: signIndependent(SECRET, ID, String(now + 400), baseBody),
      secret: SECRET,
    },
    {
      name: 'empty signature header',
      body: baseBody,
      id: ID,
      timestamp: nowTs,
      signature: '',
      secret: SECRET,
    },
  ]

  it.each(scenarios)('10. agrees with official SDK: $name', (s) => {
    const ours = verifyResendSignature({
      bodyText: s.body,
      svixId: s.id,
      svixTimestamp: s.timestamp,
      svixSignature: s.signature,
      secret: s.secret,
    })
    const official = officialValid(s.body, s.id, s.timestamp, s.signature, s.secret)
    expect(ours.valid).toBe(official)
  })
})

describe('E. secret loading', () => {
  // 只对指定变量名返回值的 env 工厂。
  function envWith(name: string, value: string | undefined): (n: string) => string | undefined {
    return (n: string) => (n === name ? value : undefined)
  }

  it('11. env var name for system account', () => {
    expect(resendSecretEnvName('system')).toBe('RESEND_WEBHOOK_SECRET_SYSTEM')
  })

  it('12a. valid secret returned as-is', () => {
    const env = envWith('RESEND_WEBHOOK_SECRET_SYSTEM', SECRET)
    expect(loadResendWebhookSecret('system', env)).toBe(SECRET)
  })

  it('12b. surrounding whitespace is trimmed', () => {
    const env = envWith('RESEND_WEBHOOK_SECRET_SYSTEM', `  ${SECRET}\n`)
    expect(loadResendWebhookSecret('system', env)).toBe(SECRET)
  })

  it('13. invalid secrets return null', () => {
    const cases: Array<string | undefined> = [
      undefined,
      '',
      '   ',
      'whsec_',
      'whsec_abc',
      // 没有 whsec_ 前缀的合法 base64
      'ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3',
      // 非法字符
      'whsec_' + '-'.repeat(30),
      // 解码 15 字节，不够 16
      'whsec_' + 'A'.repeat(21),
      // 带非法字符
      'whsec_' + 'AAAAAAAAAAAAAAAAAAAAAA!',
    ]
    for (const value of cases) {
      const env = envWith('RESEND_WEBHOOK_SECRET_SYSTEM', value)
      expect(loadResendWebhookSecret('system', env)).toBeNull()
    }
  })

  it('14. exactly 16 decoded bytes is accepted', () => {
    const value = 'whsec_' + 'A'.repeat(22)
    const env = envWith('RESEND_WEBHOOK_SECRET_SYSTEM', value)
    expect(loadResendWebhookSecret('system', env)).not.toBeNull()
  })

  it('15. wrong env var name returns null', () => {
    const env = envWith('RESEND_WEBHOOK_SECRET_OTHER', SECRET)
    expect(loadResendWebhookSecret('system', env)).toBeNull()
  })
})

// 引用 REPLAY_WINDOW_SEC，确保导出存在且为 300 秒。
describe('REPLAY_WINDOW_SEC export', () => {
  it('is 300 seconds', () => {
    expect(REPLAY_WINDOW_SEC).toBe(300)
  })
})
