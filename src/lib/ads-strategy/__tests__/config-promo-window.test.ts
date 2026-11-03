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

  it('时间戳必须是合法 ISO：乱写的字符串不保留', () => {
    const out = parseCreativePool([{
      kind: 'meta_video', ref: 'v1', status: 'candidate',
      promo_window_set_at: 'Oct 21, 2026', promo_window_changed_at: '2026-10-21T00:00:00.000Z',
      promo_window_set_by: 'fde@staff.test',
    }])
    expect(out[0]).not.toHaveProperty('promo_window_set_at')
    expect(out[0].promo_window_changed_at).toBe('2026-10-21T00:00:00.000Z')
    expect(out[0].promo_window_set_by).toBe('fde@staff.test')
  })

  it('库里有 promo_window 但读不懂：按未声明处理，并留一条警告（不静默丢）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const out = parseCreativePool([{ kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'dated', start: '2026-12-01', end: '2026-11-01' } }])
    expect(out[0]).not.toHaveProperty('promo_window')
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('没有 promo_window 键的条目不产生警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    parseCreativePool([{ kind: 'meta_video', ref: 'v1', status: 'candidate' }])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
