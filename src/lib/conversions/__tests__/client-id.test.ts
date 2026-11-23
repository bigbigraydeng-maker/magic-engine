import { describe, expect, it } from 'vitest'
import { clientIdFromSearch, extractUuid } from '../client-id'

const ID = 'c0000000-0000-0000-0000-000000000000'

describe('extractUuid', () => {
  it('原样的客户 ID 取出来并转成小写', () => {
    expect(extractUuid(ID.toUpperCase())).toBe(ID)
  })

  it('邮件折行、前后空格、零宽字符都不挡', () => {
    expect(extractUuid(`${ID}\n`)).toBe(ID)
    expect(extractUuid(`  ${ID.slice(0, 8)}\n${ID.slice(8)}  `)).toBe(ID)
    expect(extractUuid(`${ID}\u200B`)).toBe(ID)
    expect(extractUuid(`\uFEFF${ID}\u200D`)).toBe(ID)
  })

  it('前后多出来的字不影响认出中间那段', () => {
    expect(extractUuid(`客户 ${ID} 看这条`)).toBe(ID)
  })

  it('没有客户 ID 就返回空，不拿残段充数', () => {
    expect(extractUuid('')).toBeNull()
    expect(extractUuid(null)).toBeNull()
    expect(extractUuid('not-a-uuid')).toBeNull()
    expect(extractUuid('c0000000-0000-0000-0000')).toBeNull()
  })
})

describe('clientIdFromSearch', () => {
  it('认 client，也认 client_id', () => {
    expect(clientIdFromSearch(`?client=${ID}`).id).toBe(ID)
    expect(clientIdFromSearch(`?client_id=${ID}%0A`).id).toBe(ID)
  })

  it('两个都没有时，raw 是空的', () => {
    expect(clientIdFromSearch('?focus=abc')).toEqual({ id: null, raw: '' })
  })
})
