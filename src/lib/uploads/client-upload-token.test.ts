/**
 * 免登录上传令牌测试。
 *
 * 这是一条**公开、无登录、长期有效**的写入口,签名是唯一的门。所以重点全在:
 * 伪造进不来、密钥缺失时不发链接也不放行、客户之间不能串。
 */

import { describe, expect, it } from 'vitest'
import { createUploadToken, verifyUploadToken } from './client-upload-token'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const SECRET = 'test-secret-abc'

describe('createUploadToken / verifyUploadToken — 往返', () => {
  it('签出来的令牌能验回同一个客户', () => {
    const t = createUploadToken(CTS, SECRET)!
    expect(t).toBeTruthy()
    expect(verifyUploadToken(t, SECRET)).toBe(CTS)
  })

  it('同客户同密钥 → 令牌恒等(链接发出去后不会因为刷新页面而变)', () => {
    expect(createUploadToken(CTS, SECRET)).toBe(createUploadToken(CTS, SECRET))
  })

  it('不同客户 → 不同令牌', () => {
    expect(createUploadToken(CTS, SECRET)).not.toBe(createUploadToken(OZTOP, SECRET))
  })

  it('令牌可安全放进 URL(只含 URL 安全字符)', () => {
    const t = createUploadToken(CTS, SECRET)!
    expect(t).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(encodeURIComponent(t)).toBe(t)
  })
})

describe('verifyUploadToken — 伪造与越权', () => {
  it('🔴 改签名 → 拒', () => {
    const t = createUploadToken(CTS, SECRET)!
    expect(verifyUploadToken(t.slice(0, -1) + 'X', SECRET)).toBeNull()
  })

  it('🔴 换客户 id 保留原签名 → 拒(不能拿 A 的链接传给 B)', () => {
    const t = createUploadToken(CTS, SECRET)!
    const sig = t.slice(t.lastIndexOf('.') + 1)
    expect(verifyUploadToken(`${OZTOP}.${sig}`, SECRET)).toBeNull()
  })

  it('🔴 换密钥 → 旧链接全部失效(这是目前唯一的作废手段)', () => {
    const t = createUploadToken(CTS, SECRET)!
    expect(verifyUploadToken(t, 'rotated-secret')).toBeNull()
  })

  it('🔴 密钥缺失 → 既不签发也不放行(fail-closed,绝不用空密钥签人人可伪造的链接)', () => {
    expect(createUploadToken(CTS, undefined)).toBeNull()
    expect(createUploadToken(CTS, '')).toBeNull()
    expect(verifyUploadToken(createUploadToken(CTS, SECRET)!, undefined)).toBeNull()
    expect(verifyUploadToken(createUploadToken(CTS, SECRET)!, '')).toBeNull()
  })

  it('无签名 / 空 / 畸形 → 拒', () => {
    expect(verifyUploadToken(CTS, SECRET)).toBeNull()          // 只有 id 没签名
    expect(verifyUploadToken(`${CTS}.`, SECRET)).toBeNull()     // 空签名
    expect(verifyUploadToken('.abc', SECRET)).toBeNull()
    expect(verifyUploadToken('', SECRET)).toBeNull()
    expect(verifyUploadToken(undefined, SECRET)).toBeNull()
  })

  it('🔴 client_id 不是 uuid → 拒(挡住路径穿越/注入类的花样 id)', () => {
    expect(createUploadToken('../../etc/passwd', SECRET)).toBeNull()
    expect(createUploadToken('not-a-uuid', SECRET)).toBeNull()
    expect(verifyUploadToken(`../evil.${'x'.repeat(32)}`, SECRET)).toBeNull()
  })

  it('签名长度不对 → 拒,且不抛异常', () => {
    expect(() => verifyUploadToken(`${CTS}.short`, SECRET)).not.toThrow()
    expect(verifyUploadToken(`${CTS}.short`, SECRET)).toBeNull()
    expect(verifyUploadToken(`${CTS}.${'x'.repeat(64)}`, SECRET)).toBeNull()
  })
})
