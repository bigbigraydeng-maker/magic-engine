import { describe, it, expect } from 'vitest'
import { registerStaffPhone } from '../staff-phone'

const MAP = { '+64277520888': 'boss@example.com' }

describe('registerStaffPhone', () => {
  it('登记新西兰手机：写成国际格式，邮箱统一小写，不动别人的', () => {
    const r = registerStaffPhone(MAP, 'Op1@Example.com', '021 234 5678')
    expect(r).toEqual({ ok: true, phone: '+64212345678', map: { '+64277520888': 'boss@example.com', '+64212345678': 'op1@example.com' } })
  })
  it('换号码：旧号码被替换，一个邮箱只留一个', () => {
    const r = registerStaffPhone({ '+64211111111': 'op1@example.com' }, 'op1@example.com', '0229998888')
    expect(r.ok && Object.keys(r.map)).toEqual(['+64229998888'])
  })
  it('同一个人重复登记同一个号码不报错', () => {
    expect(registerStaffPhone(MAP, 'boss@example.com', '027 752 0888').ok).toBe(true)
  })
  it('号码已属于别的同事 → 拒绝', () => {
    const r = registerStaffPhone(MAP, 'op1@example.com', '0277520888')
    expect(r).toEqual({ ok: false, error: '这个号码已经登记给别的同事了' })
  })
  it('固话 / 国外号 / 乱填 → 拒绝', () => {
    for (const bad of ['09 123 4567', '+61412345678', '+6490001234', 'abc', '', '0900 12345']) {
      expect(registerStaffPhone(MAP, 'op1@example.com', bad).ok).toBe(false)
    }
  })
  it('读不到登录邮箱 → 拒绝', () => {
    expect(registerStaffPhone(MAP, null, '0212345678').ok).toBe(false)
    expect(registerStaffPhone(MAP, '  ', '0212345678').ok).toBe(false)
  })
  it('不改传入的原表', () => {
    const copy = { ...MAP }
    registerStaffPhone(copy, 'op1@example.com', '0212345678')
    expect(copy).toEqual(MAP)
  })
})

import { cleanExtensionMap } from '../staff-phone'

describe('cleanExtensionMap', () => {
  it('只留字符串→字符串；null / 数字 / 数组 / 字符串整体都当空表', () => {
    expect(cleanExtensionMap({ a: 'x', b: null, c: 1, d: { e: 1 } })).toEqual({ a: 'x' })
    expect(cleanExtensionMap(null)).toEqual({})
    expect(cleanExtensionMap(['a'])).toEqual({})
    expect(cleanExtensionMap('x')).toEqual({})
    expect(cleanExtensionMap(undefined)).toEqual({})
  })
})
