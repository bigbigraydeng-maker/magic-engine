/**
 * 免登录上传令牌测试(AES-256-GCM 加密版)。
 *
 * 这是一条**公开、无登录、长期有效**的写入口,令牌是唯一的门。重点全在:
 * 令牌里不泄露明文 client UUID、伪造/篡改进不来、密钥缺失时既不签发也不放行。
 */

import { describe, expect, it } from 'vitest'
import { createUploadToken, roundTripOk, verifyUploadToken } from './client-upload-token'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const SECRET = 'test-secret-abc'

describe('往返', () => {
  it('签出来的令牌能验回同一个客户', () => {
    const t = createUploadToken(CTS, SECRET)!
    expect(t).toBeTruthy()
    expect(verifyUploadToken(t, SECRET)).toBe(CTS)
  })

  it('roundTripOk 对合法输入为真', () => {
    expect(roundTripOk(CTS, SECRET)).toBe(true)
  })

  it('令牌可安全放进 URL(只含 URL 安全字符)', () => {
    const t = createUploadToken(CTS, SECRET)!
    expect(t).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(encodeURIComponent(t)).toBe(t)
  })
})

describe('🔴 令牌不泄露明文 client UUID', () => {
  it('令牌里不包含 client UUID 的任何形态', () => {
    const t = createUploadToken(CTS, SECRET)!
    expect(t).not.toContain(CTS)
    expect(t).not.toContain(CTS.replace(/-/g, ''))
    // base64url 编码后也不该出现
    expect(t).not.toContain(Buffer.from(CTS).toString('base64').replace(/=+$/, ''))
  })

  it('每次生成用新 nonce → 同客户同密钥,令牌每次都不同(密文不可比对、不可累积分析)', () => {
    expect(createUploadToken(CTS, SECRET)).not.toBe(createUploadToken(CTS, SECRET))
  })

  it('不同客户 → 不同令牌', () => {
    expect(createUploadToken(CTS, SECRET)).not.toBe(createUploadToken(OZTOP, SECRET))
  })
})

describe('伪造与篡改', () => {
  it('🔴 篡改密文任意一段 → 拒(GCM 完整性校验)', () => {
    const t = createUploadToken(CTS, SECRET)!
    const [nonce, ct, tag] = t.split('.')
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1)
    expect(verifyUploadToken(`${flip(nonce)}.${ct}.${tag}`, SECRET)).toBeNull()
    expect(verifyUploadToken(`${nonce}.${flip(ct)}.${tag}`, SECRET)).toBeNull()
    expect(verifyUploadToken(`${nonce}.${ct}.${flip(tag)}`, SECRET)).toBeNull()
  })

  it('🔴 换密钥 → 旧链接全部失效(这是目前唯一的作废手段)', () => {
    const t = createUploadToken(CTS, SECRET)!
    expect(verifyUploadToken(t, 'rotated-secret')).toBeNull()
  })

  it('🔴 密钥缺失 → 既不签发也不放行(fail-closed)', () => {
    expect(createUploadToken(CTS, undefined)).toBeNull()
    expect(createUploadToken(CTS, '')).toBeNull()
    expect(verifyUploadToken(createUploadToken(CTS, SECRET)!, undefined)).toBeNull()
    expect(verifyUploadToken(createUploadToken(CTS, SECRET)!, '')).toBeNull()
  })

  it('🔴 client_id 不是 uuid → 不签发(挡路径穿越/注入类花样 id)', () => {
    expect(createUploadToken('../../etc/passwd', SECRET)).toBeNull()
    expect(createUploadToken('not-a-uuid', SECRET)).toBeNull()
  })

  it('段数不对 / 空 / 畸形 → 拒,不抛', () => {
    expect(() => verifyUploadToken('a.b', SECRET)).not.toThrow()
    expect(verifyUploadToken('a.b', SECRET)).toBeNull()       // 少一段
    expect(verifyUploadToken('a.b.c.d', SECRET)).toBeNull()   // 多一段
    expect(verifyUploadToken('...', SECRET)).toBeNull()
    expect(verifyUploadToken('', SECRET)).toBeNull()
    expect(verifyUploadToken(undefined, SECRET)).toBeNull()
    expect(verifyUploadToken('not-base64-!!!.x.y', SECRET)).toBeNull()
  })

  it('nonce / tag 长度不对 → 拒(不进解密)', () => {
    const t = createUploadToken(CTS, SECRET)!
    const [, ct, tag] = t.split('.')
    expect(verifyUploadToken(`AAAA.${ct}.${tag}`, SECRET)).toBeNull()      // nonce 太短
    expect(verifyUploadToken(`${t.split('.')[0]}.${ct}.AAAA`, SECRET)).toBeNull() // tag 太短
  })
})
