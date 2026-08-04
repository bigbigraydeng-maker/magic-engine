/**
 * 房子写入校验的测试。
 *
 * 重点不是 happy path,而是**非法值必须被挡下来** —— 这一层是绕过前端下拉之后
 * 的唯一闸门,它松了就等于没有校验(数据库 CHECK 会兜住,但用户看到的是 500)。
 *
 * 枚举那几条(property_type / price_band / status)是变异测试的目标:把
 * validation.ts 里的 guard 改成永远放行,下面对应的用例必须变红。
 */

import { describe, it, expect } from 'vitest'
import { validateListingCreate, validateListingPatch } from '../validation'
import { PROPERTY_TYPES, PRICE_BANDS, LISTING_STATUSES } from '../constants'

describe('validateListingCreate', () => {
  it('最小合法输入:只给地址,状态兜底成 prospect', () => {
    const r = validateListingCreate({ address_line: '30 Kiteroa Place' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.address_line).toBe('30 Kiteroa Place')
    expect(r.value.status).toBe('prospect')
  })

  it('地址两边空白会被清掉', () => {
    const r = validateListingCreate({ address_line: '  12 Queen St  ' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.address_line).toBe('12 Queen St')
  })

  it('缺地址 → 拒绝', () => {
    expect(validateListingCreate({}).ok).toBe(false)
  })

  it('地址只有空白 → 拒绝(不能建一套没门牌的房)', () => {
    const r = validateListingCreate({ address_line: '   ' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('地址')
  })

  it('body 不是对象 → 拒绝', () => {
    expect(validateListingCreate(null).ok).toBe(false)
    expect(validateListingCreate('30 Kiteroa').ok).toBe(false)
    expect(validateListingCreate([{ address_line: 'x' }]).ok).toBe(false)
  })

  // ── 枚举闸门(变异测试目标)──────────────────────────────────────────────

  it.each(PROPERTY_TYPES)('房型 %s 是合法值', (t) => {
    const r = validateListingCreate({ address_line: 'a', property_type: t })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.property_type).toBe(t)
  })

  it.each(PRICE_BANDS)('价格档 %s 是合法值', (b) => {
    const r = validateListingCreate({ address_line: 'a', price_band: b })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.price_band).toBe(b)
  })

  it.each(LISTING_STATUSES)('状态 %s 是合法值', (s) => {
    const r = validateListingCreate({ address_line: 'a', status: s })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.status).toBe(s)
  })

  it('非法房型被拒绝,不是被静默丢弃', () => {
    const r = validateListingCreate({ address_line: 'a', property_type: 'castle' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('房型')
  })

  it('非法价格档被拒绝 —— 数据库 CHECK 之外的第一道闸', () => {
    const r = validateListingCreate({ address_line: 'a', price_band: '10m_plus' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('价格档')
  })

  it('非法状态被拒绝', () => {
    const r = validateListingCreate({ address_line: 'a', status: 'pending' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('状态')
  })

  it('大小写不同的枚举值也算非法(slug 是逐字匹配的)', () => {
    expect(validateListingCreate({ address_line: 'a', status: 'LIVE' }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', property_type: 'House' }).ok).toBe(false)
  })

  it('枚举字段传非字符串 → 拒绝', () => {
    expect(validateListingCreate({ address_line: 'a', price_band: 12 }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', property_type: {} }).ok).toBe(false)
  })

  it('枚举字段传空字符串 = 不填,存 NULL', () => {
    const r = validateListingCreate({ address_line: 'a', property_type: '', price_band: '' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.property_type).toBeNull()
    expect(r.value.price_band).toBeNull()
  })

  // ── 数字 ────────────────────────────────────────────────────────────────

  it('卧室数接受数字和数字字符串', () => {
    const a = validateListingCreate({ address_line: 'a', bedrooms: 4 })
    const b = validateListingCreate({ address_line: 'a', bedrooms: '4' })
    expect(a.ok && a.value.bedrooms).toBe(4)
    expect(b.ok && b.value.bedrooms).toBe(4)
  })

  it('卧室数拒绝小数 / 负数 / 超大 / 非数字', () => {
    expect(validateListingCreate({ address_line: 'a', bedrooms: 2.5 }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', bedrooms: -1 }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', bedrooms: 999 }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', bedrooms: 'four' }).ok).toBe(false)
  })

  it('成交价保留两位小数,拒绝负数和超出 NUMERIC(12,2) 的值', () => {
    const r = validateListingCreate({ address_line: 'a', sold_price: 1234567.899 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.sold_price).toBe(1234567.9)

    expect(validateListingCreate({ address_line: 'a', sold_price: -5 }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', sold_price: 1e13 }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', sold_price: 'lots' }).ok).toBe(false)
  })

  // ── 日期 ────────────────────────────────────────────────────────────────

  it('日期接受 YYYY-MM-DD', () => {
    const r = validateListingCreate({ address_line: 'a', listed_on: '2026-07-30' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.listed_on).toBe('2026-07-30')
  })

  it('日期拒绝其他格式和不存在的日子', () => {
    expect(validateListingCreate({ address_line: 'a', listed_on: '30/07/2026' }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', listed_on: '2026-7-3' }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', sold_on: '2026-02-31' }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', sold_on: '2026-13-01' }).ok).toBe(false)
  })

  it('日期传空字符串 = 不填,存 NULL', () => {
    const r = validateListingCreate({ address_line: 'a', listed_on: '' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.listed_on).toBeNull()
  })

  // ── 越权 / 意外字段 ─────────────────────────────────────────────────────

  it('body 里的 client_id / id 不会被带进落库字段', () => {
    const r = validateListingCreate({
      address_line: 'a',
      client_id: 'someone-elses-client',
      id: 'forged-id',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).not.toHaveProperty('client_id')
    expect(r.value).not.toHaveProperty('id')
  })

  it('文本字段过长被拒绝', () => {
    expect(validateListingCreate({ address_line: 'x'.repeat(301) }).ok).toBe(false)
    expect(validateListingCreate({ address_line: 'a', suburb: 'x'.repeat(121) }).ok).toBe(false)
  })
})

describe('validateListingPatch', () => {
  it('只改一个字段', () => {
    const r = validateListingPatch({ status: 'sold' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({ status: 'sold' })
  })

  it('没出现的字段不进 patch(不会把别的列冲成 null)', () => {
    const r = validateListingPatch({ suburb: 'Rothesay Bay' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).not.toHaveProperty('address_line')
    expect(r.value).not.toHaveProperty('status')
  })

  it('显式传 null 表示清空这一列', () => {
    const r = validateListingPatch({ suburb: null })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.suburb).toBeNull()
  })

  it('空 patch 被拒绝', () => {
    expect(validateListingPatch({}).ok).toBe(false)
  })

  it('非法枚举同样被拒绝(编辑路径不能比建档路径松)', () => {
    expect(validateListingPatch({ status: 'archived' }).ok).toBe(false)
    expect(validateListingPatch({ price_band: 'cheap' }).ok).toBe(false)
    expect(validateListingPatch({ property_type: 'yacht' }).ok).toBe(false)
  })

  it('status 出现时不能清空(数据库上是 NOT NULL)', () => {
    expect(validateListingPatch({ status: null }).ok).toBe(false)
    expect(validateListingPatch({ status: '' }).ok).toBe(false)
  })

  it('地址出现时不能改成空', () => {
    expect(validateListingPatch({ address_line: '  ' }).ok).toBe(false)
  })

  it('改不了 client_id —— 一套房挪不到别的中介名下', () => {
    const r = validateListingPatch({ client_id: 'other-client', status: 'live' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).not.toHaveProperty('client_id')
  })
})
