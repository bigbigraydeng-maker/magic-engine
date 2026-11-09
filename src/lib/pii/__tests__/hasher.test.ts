import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { hashEmail, hashName, hashPhone } from '../hasher'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

describe('哈希前必须先规范化（否则同一个人会算成两个人）', () => {
  it('邮箱：大小写与空白不影响结果', () => {
    expect(hashEmail('  Rosalind@Example.COM ')).toBe(hashEmail('rosalind@example.com'))
    expect(hashEmail('rosalind@example.com')).toBe(sha('rosalind@example.com'))
  })

  it('电话：本地写法与国际写法哈希一致', () => {
    expect(hashPhone('021 555 1234', '64')).toBe(hashPhone('+64 21 555 1234', '64'))
    expect(hashPhone('021 555 1234', '64')).toBe(sha('64215551234'))
  })

  it('姓名：大小写与空白不影响结果', () => {
    expect(hashName(' Rosalind ')).toBe(sha('rosalind'))
  })
})

describe('空值不产生哈希', () => {
  it.each([null, undefined, ''])('%s → null', (v) => {
    // 🔴 哈希空串会得到一个人人相同的值 —— 那是个假身份，
    //    发给平台不但匹配不上，还会拉低整体匹配质量。
    expect(hashEmail(v)).toBeNull()
    expect(hashName(v)).toBeNull()
    expect(hashPhone(v, '64')).toBeNull()
  })

  it('只有空白的输入也不产生哈希', () => {
    expect(hashEmail('   ')).toBeNull()
    expect(hashName('   ')).toBeNull()
    expect(hashEmail('   ')).not.toBe(sha(''))
  })
})

describe('电话：拿不到国家码就不猜', () => {
  it('本地格式 + 无国家码 → null', () => {
    // 猜错国家生成的哈希会匹配到**别人**。宁可少一个匹配键。
    expect(hashPhone('021 555 1234', null)).toBeNull()
  })

  it('换个国家，同一串本地号码哈希不同', () => {
    expect(hashPhone('021 555 1234', '64')).not.toBe(hashPhone('021 555 1234', '61'))
  })
})

describe('输出形状', () => {
  it('永远是 64 位小写十六进制', () => {
    for (const h of [hashEmail('a@b.co'), hashPhone('+6421555', '64'), hashName('x')]) {
      expect(h).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
