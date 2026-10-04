import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  APPROVER_ENV_NAME,
  parseApproverList,
  isApproverEmail,
  isActivationApprover,
} from '../activation-approver'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseApproverList', () => {
  it('丢掉不含 @ 的项、去重、丢空项', () => {
    expect(parseApproverList('a, ray@x.com, *')).toEqual(['ray@x.com'])
    expect(parseApproverList('ray@x.com, ray@x.com')).toEqual(['ray@x.com'])
    expect(parseApproverList(' , , ray@x.com , ')).toEqual(['ray@x.com'])
  })

  it('null / undefined / 空串 → 空数组', () => {
    expect(parseApproverList(null)).toEqual([])
    expect(parseApproverList(undefined)).toEqual([])
    expect(parseApproverList('')).toEqual([])
  })
})

describe('名单没配', () => {
  it('undefined 读环境变量且环境里没有 → 谁都不是授权人', () => {
    vi.stubEnv(APPROVER_ENV_NAME, '')
    expect(isApproverEmail('ray@x.com')).toBe(false)
  })

  it('null → 谁都不是授权人', () => {
    expect(isApproverEmail('ray@x.com', null)).toBe(false)
  })

  it('空串 → 谁都不是授权人', () => {
    expect(isApproverEmail('ray@x.com', '')).toBe(false)
  })

  it('只有逗号和空格 → 谁都不是授权人', () => {
    expect(isApproverEmail('ray@x.com', ' , , ')).toBe(false)
  })
})

describe('精确匹配', () => {
  it('名单里有这个邮箱 → 通过', () => {
    expect(isApproverEmail('ray@x.com', 'ray@x.com')).toBe(true)
  })

  it('大小写不敏感', () => {
    expect(isApproverEmail('RAY@X.COM', 'ray@x.com')).toBe(true)
    expect(isApproverEmail('ray@x.com', 'RAY@X.COM')).toBe(true)
  })

  it('名单项和邮箱两边的首尾空格都被忽略', () => {
    expect(isApproverEmail('  ray@x.com  ', '  ray@x.com  ')).toBe(true)
  })
})

describe('不做前缀 / 后缀 / 域名 / 通配匹配', () => {
  it('xray@x.com 不让 ray@x.com 通过', () => {
    expect(isApproverEmail('ray@x.com', 'xray@x.com')).toBe(false)
  })

  it('@x.com 不让 ray@x.com 通过', () => {
    expect(isApproverEmail('ray@x.com', '@x.com')).toBe(false)
  })

  it('x.com 不让 ray@x.com 通过', () => {
    expect(isApproverEmail('ray@x.com', 'x.com')).toBe(false)
  })

  it('* 不让 ray@x.com 通过', () => {
    expect(isApproverEmail('ray@x.com', '*')).toBe(false)
  })

  it('*@x.com 不让 ray@x.com 通过', () => {
    expect(isApproverEmail('ray@x.com', '*@x.com')).toBe(false)
  })
})

describe('邮箱本身不合法', () => {
  it('null / undefined / 空串 → false', () => {
    expect(isApproverEmail(null, 'ray@x.com')).toBe(false)
    expect(isApproverEmail(undefined, 'ray@x.com')).toBe(false)
    expect(isApproverEmail('', 'ray@x.com')).toBe(false)
  })

  it('不含 @ → false', () => {
    expect(isApproverEmail('ray', 'ray@x.com')).toBe(false)
  })
})

describe('isActivationApprover', () => {
  it('邮箱在名单里但 emailConfirmed 为 false → false', () => {
    expect(isActivationApprover({ email: 'ray@x.com', emailConfirmed: false }, 'ray@x.com')).toBe(false)
  })

  it('邮箱在名单里且 emailConfirmed 为 true → true', () => {
    expect(isActivationApprover({ email: 'ray@x.com', emailConfirmed: true }, 'ray@x.com')).toBe(true)
  })

  it('isApproverEmail 不看验证状态', () => {
    expect(isApproverEmail('ray@x.com', 'ray@x.com')).toBe(true)
  })
})

describe('环境变量读取发生在调用时', () => {
  it('stubEnv 后不传 rawList 能通过', () => {
    vi.stubEnv(APPROVER_ENV_NAME, 'ray@x.com')
    expect(isApproverEmail('ray@x.com')).toBe(true)
  })

  it('unstubAllEnvs 后又不通过', () => {
    vi.stubEnv(APPROVER_ENV_NAME, 'ray@x.com')
    expect(isApproverEmail('ray@x.com')).toBe(true)
    vi.unstubAllEnvs()
    expect(isApproverEmail('ray@x.com')).toBe(false)
  })

  it('传了 rawList 时不看环境变量', () => {
    vi.stubEnv(APPROVER_ENV_NAME, 'other@x.com')
    expect(isApproverEmail('ray@x.com', 'ray@x.com')).toBe(true)
    expect(isApproverEmail('other@x.com', 'ray@x.com')).toBe(false)
  })
})
