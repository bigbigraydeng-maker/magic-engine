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
    expect(verifyUploadToken(t, SECRET)).toEqual({ clientId: CTS })
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

/**
 * 一房一链接（PM 2026-08-05 的产品要求）。
 *
 * 地产的营销单位是一套房。归类不能丢给上传的人（破掉「三步不填表」），
 * 也不能丢给后台人工（永远做不完）—— 由链接本身完成。
 */
describe('房源链接', () => {
  const LISTING = '11111111-2222-3333-4444-555555555555'

  it('带房源的链接能验回客户 + 房源', () => {
    const t = createUploadToken({ clientId: CTS, listingId: LISTING }, SECRET)!
    expect(verifyUploadToken(t, SECRET)).toEqual({ clientId: CTS, listingId: LISTING })
  })

  it('老链接（只有客户）继续可用，不带房源', () => {
    const t = createUploadToken(CTS, SECRET)!
    const back = verifyUploadToken(t, SECRET)!
    expect(back.clientId).toBe(CTS)
    expect(back.listingId).toBeUndefined()
  })

  it('🔴 房源 id 不合法 → 不签发，而不是悄悄降级成客户级链接', () => {
    // 悄悄降级最坏：FDE 以为绑上了，实际传进来的又是一堆没主的照片。
    expect(createUploadToken({ clientId: CTS, listingId: 'not-a-uuid' }, SECRET)).toBeNull()
    expect(createUploadToken({ clientId: CTS, listingId: '' }, SECRET)).toBeNull()
  })

  it('同客户不同房源 → 不同链接', () => {
    const a = createUploadToken({ clientId: CTS, listingId: LISTING }, SECRET)!
    const b = createUploadToken({ clientId: CTS, listingId: '99999999-2222-3333-4444-555555555555' }, SECRET)!
    expect(a).not.toBe(b)
    expect(verifyUploadToken(a, SECRET)!.listingId)
      .not.toBe(verifyUploadToken(b, SECRET)!.listingId)
  })

  it('🔴 房源链接同样挡篡改', () => {
    const t = createUploadToken({ clientId: CTS, listingId: LISTING }, SECRET)!
    const [nonce, ct, tag] = t.split('.')
    const bend = (x: string) => (x[0] === 'A' ? 'B' : 'A') + x.slice(1)
    expect(verifyUploadToken(`${nonce}.${bend(ct)}.${tag}`, SECRET)).toBeNull()
  })
})

/**
 * 2026-08-05 魏征变异测试逃逸的几条 —— 全是「注释吹得最狠、测试一行都没锁」的。
 */
describe('逃逸补测', () => {
  const LISTING2 = '11111111-2222-3333-4444-555555555555'

  it('🔴 载荷被截断时不许降级放行（T4：注释专门吹的那条，原来零覆盖）', () => {
    // 文件头写着「不做『至少 client_id 是对的所以放行』这种降级：那会让一条被
    // 截断的链接静默退化成客户级上传口」。原来把 `return null` 改成降级放行，
    // 53 条测试全绿 —— 吹的那条防护一行测试都没锁。
    //
    // 直接构造密文来验：走真实加密路径，只改明文载荷。
    const { createCipheriv, createHash, randomBytes } = require('node:crypto') as typeof import('node:crypto')
    const key = createHash('sha256').update(SECRET).digest()
    const mint = (payload: string) => {
      const nonce = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', key, nonce)
      const ct = Buffer.concat([c.update(payload, 'utf8'), c.final()])
      const b64 = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return `${b64(nonce)}.${b64(ct)}.${b64(c.getAuthTag())}`
    }

    // 第二段不是合法 UUID → 整条作废，**不许只取第一段放行**
    expect(verifyUploadToken(mint(`${CTS}:not-a-uuid`), SECRET)).toBeNull()
    expect(verifyUploadToken(mint(`${CTS}:`), SECRET)).toBeNull()
    // 三段 → 作废
    expect(verifyUploadToken(mint(`${CTS}:${LISTING2}:${CTS}`), SECRET)).toBeNull()
    // 第一段不合法 → 作废
    expect(verifyUploadToken(mint(`bad:${LISTING2}`), SECRET)).toBeNull()
    // 对照：两段都合法才放行
    expect(verifyUploadToken(mint(`${CTS}:${LISTING2}`), SECRET)).toEqual({
      clientId: CTS, listingId: LISTING2,
    })
  })

  it('🔴 密钥必须整条参与派生，不能只用前几个字符（T6）', () => {
    // 原来测试只用了 `test-secret-abc` 和 `rotated-secret`（首字母就不同），
    // 所以把 `sha256(secret)` 改成 `sha256(secret.slice(0,3))` 全绿 ——
    // 密钥被截断、熵塌掉，测试看不见。
    const a = 'aaaaaaaa-prefix-shared-XXXX'
    const b = 'aaaaaaaa-prefix-shared-YYYY'   // 只有结尾不同
    const t = createUploadToken(CTS, a)!
    expect(verifyUploadToken(t, b)).toBeNull()
  })

  it('roundTripOk 也覆盖带房源的链接', () => {
    // 它自称「往返成立的一致性保障」，原来完全不碰 listingId。
    const t = createUploadToken({ clientId: CTS, listingId: LISTING2 }, SECRET)!
    const back = verifyUploadToken(t, SECRET)!
    expect(back.listingId).toBe(LISTING2)
    expect(back.clientId).toBe(CTS)
  })
})
