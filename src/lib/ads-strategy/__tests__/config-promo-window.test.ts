import { describe, it, expect } from 'vitest'
import { parseCreativePool } from '../config'

describe('parseCreativePool — promo_window / alias_refs', () => {
  it('dated + alias_refs 完整保留', () => {
    const raw = [
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'approved',
        promo_window: { kind: 'dated', start: '2026-11-01', end: '2026-11-30' },
        alias_refs: ['v2', 'v3'],
      },
    ]
    expect(parseCreativePool(raw)).toEqual([
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'approved',
        promo_window: { kind: 'dated', start: '2026-11-01', end: '2026-11-30' },
        alias_refs: ['v2', 'v3'],
      },
    ])
  })

  it('evergreen 保留', () => {
    const raw = [
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'candidate',
        promo_window: { kind: 'evergreen' },
      },
    ]
    expect(parseCreativePool(raw)).toEqual([
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'candidate',
        promo_window: { kind: 'evergreen' },
      },
    ])
  })

  it('promo_window 非法 → 条目保留、promo_window 缺失（不是 evergreen）', () => {
    const raw = [
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'approved',
        promo_window: { kind: 'dated', start: '2026-02-30', end: '2026-03-01' },
      },
    ]
    const result = parseCreativePool(raw)
    expect(result).toHaveLength(1)
    expect(result[0].promo_window).toBeUndefined()
    expect('promo_window' in result[0]).toBe(false)
  })

  it('alias_refs 混入空串/非字符串/重复 → 清洗后', () => {
    const raw = [
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'approved',
        alias_refs: ['v2', '', 42, 'v2', 'v3', null],
      },
    ]
    expect(parseCreativePool(raw)).toEqual([
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'approved',
        alias_refs: ['v2', 'v3'],
      },
    ])
  })

  it('alias_refs 全无效 → 不带该字段', () => {
    const raw = [
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'approved',
        alias_refs: ['', 42, null],
      },
    ]
    const result = parseCreativePool(raw)
    expect(result).toHaveLength(1)
    expect('alias_refs' in result[0]).toBe(false)
  })

  it('原有行为不变：非法 kind/status 条目仍被丢', () => {
    const raw = [
      { kind: 'bogus', ref: 'v1', status: 'approved' },
      { kind: 'meta_video', ref: 'v2', status: 'bogus' },
      { kind: 'meta_video', ref: 'v3', status: 'approved' },
    ]
    expect(parseCreativePool(raw)).toEqual([
      { kind: 'meta_video', ref: 'v3', status: 'approved' },
    ])
  })

  it('approved_by / approved_at 仍保留', () => {
    const raw = [
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'approved',
        approved_by: 'alice',
        approved_at: '2026-11-01T00:00:00Z',
      },
    ]
    expect(parseCreativePool(raw)).toEqual([
      {
        kind: 'meta_video',
        ref: 'v1',
        status: 'approved',
        approved_by: 'alice',
        approved_at: '2026-11-01T00:00:00Z',
      },
    ])
  })
})
