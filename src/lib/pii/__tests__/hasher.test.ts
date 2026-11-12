import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { hashEmail, hashName, hashPhone, hashStoredPhone } from '../hasher'

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

// 2026-11-10：库里的电话是入库时就规范好的国际格式纯数字，发送时不能再规范一遍
describe('已入库的电话（国际格式纯数字）', () => {
  it('没配默认国家码也照样哈希 —— 之前会被当成「不知道哪国」整条丢掉', () => {
    expect(hashPhone('6421555123', null)).toBeNull() // 老行为：丢
    expect(hashStoredPhone('6421555123', null)).toBe(hashPhone('+6421555123', null))
  })

  it('配了国家码时，别国的号码不会被再拼一遍国家码', () => {
    // 澳洲号码存在一个默认国家是新西兰的客户名下
    expect(hashStoredPhone('61412345678', '64')).toBe(hashPhone('+61412345678', null))
    expect(hashStoredPhone('61412345678', '64')).not.toBe(hashPhone('61412345678', '64'))
  })

  it('本国号码配不配国家码结果一样', () => {
    expect(hashStoredPhone('6421555123', '64')).toBe(hashStoredPhone('6421555123', null))
  })

  it.each([
    ['0 开头的本地写法', '0215551234'],
    ['带空格', '021 555 1234'],
    ['带加号', '+64 21 555 1234'],
  ])('不是纯数字国际格式（%s）→ 退回原来的规范化，结果一致', (_label, raw) => {
    expect(hashStoredPhone(raw, '64')).toBe(hashPhone(raw, '64'))
  })

  it('本地写法又没有国家码 → 仍然不猜，返回空', () => {
    expect(hashStoredPhone('0215551234', null)).toBeNull()
  })

  it.each([['太短', '1234567'], ['太长', '1234567890123456'], ['空', ''], ['null', null]])('%s → 不产生哈希', (_l, raw) => {
    expect(hashStoredPhone(raw, null)).toBeNull()
  })
})
