import { describe, expect, it } from 'vitest'
import { MAX_ERROR_CHARS, sanitizeError } from '../sanitize'

describe('sanitizeError · 错误文案进回执 / 待办之前先洗一遍（令牌绝不外带）', () => {
  it('access_token 查询参数被抹掉，其余内容保留', () => {
    const out = sanitizeError('GET https://graph.facebook.com/v21.0/x?access_token=EAAB123abc&fields=id failed')
    expect(out).not.toContain('EAAB123abc')
    expect(out).toContain('graph.facebook.com')
    expect(out).toContain('[已隐藏]')
  })

  it('Bearer 令牌被抹掉', () => {
    const out = sanitizeError('Authorization: Bearer abc.DEF-123_xyz was rejected')
    expect(out).not.toContain('abc.DEF-123_xyz')
  })

  it('token= / secret: / api_key= / client_secret= 这类键值对被抹掉', () => {
    for (const raw of ['token=SECRETVALUE1', 'secret: SECRETVALUE1', 'api_key=SECRETVALUE1', 'client_secret=SECRETVALUE1']) {
      expect(sanitizeError(`boom ${raw} end`), raw).not.toContain('SECRETVALUE1')
    }
  })

  it('裸的超长令牌样子的字符串（≥ 40 位字母数字）被抹掉', () => {
    const token = `EAAGm0PX4ZCpsBO${'A'.repeat(60)}`
    expect(sanitizeError(`Invalid token ${token}`)).not.toContain(token)
  })

  it('15–16 位的像素编号 / 账户编号不是令牌，原样保留', () => {
    expect(sanitizeError('数据集 2000000000000007 读不到')).toContain('2000000000000007')
  })

  it('超长文案截到 MAX_ERROR_CHARS（160）字以内', () => {
    expect(MAX_ERROR_CHARS).toBe(160)
    expect(sanitizeError('错'.repeat(500)).length).toBeLessThanOrEqual(MAX_ERROR_CHARS)
  })

  it('换行和控制字符压成空格', () => {
    expect(sanitizeError('第一行\n第二行\t第三行\u0000结束')).toBe('第一行 第二行 第三行 结束')
  })

  it('接受 Error / 字符串 / 带 message 的对象；其它一律「未知错误」', () => {
    expect(sanitizeError(new Error('连不上'))).toBe('连不上')
    expect(sanitizeError('直接一句话')).toBe('直接一句话')
    expect(sanitizeError({ message: '对象里的话' })).toBe('对象里的话')
    expect(sanitizeError(null)).toBe('未知错误')
    expect(sanitizeError(42)).toBe('未知错误')
    expect(sanitizeError({})).toBe('未知错误')
  })

  it('调用方明确知道的密钥值：不管长什么样、在句子哪里，整段精确抹掉', () => {
    const out = sanitizeError('Invalid OAuth access token SECRET_TOKEN_VALUE_123 expired', ['SECRET_TOKEN_VALUE_123'])
    expect(out).not.toContain('SECRET_TOKEN_VALUE_123')
    expect(out).toContain('Invalid OAuth')
  })

  it('密钥正好压在截断线上也不会漏半截（先抹再截）', () => {
    const out = sanitizeError(`${'x'.repeat(150)}SECRET_TOKEN_VALUE_123`, ['SECRET_TOKEN_VALUE_123'])
    expect(out).not.toContain('SECRET')
    expect(out.length).toBeLessThanOrEqual(MAX_ERROR_CHARS)
  })

  it('太短的“密钥”（少于 6 个字符）忽略，不把正常文字抹坏', () => {
    expect(sanitizeError('连接 abc 失败', ['abc'])).toBe('连接 abc 失败')
    expect(sanitizeError('连接失败', [''])).toBe('连接失败')
  })

  it('普通中文短句不变', () => {
    expect(sanitizeError('这个客户还没有可用的 Google 授权')).toBe('这个客户还没有可用的 Google 授权')
  })
})
