import { describe, it, expect } from 'vitest'
import { isAllowedForProject, filterByProject, projectOrFilter } from './project-scope'

const KITEROA = 'proj-kiteroa'
const PARKHOMES = 'proj-parkhomes'

const clip = (project_id: string | null, tag: string) => ({ project_id, tag })

describe('isAllowedForProject —— 楼盘级红线', () => {
  it('🔴 A 楼盘的素材进不了 B 楼盘（两个开发商是竞品）', () => {
    expect(isAllowedForProject(clip(KITEROA, 'k1'), PARKHOMES)).toBe(false)
    expect(isAllowedForProject(clip(PARKHOMES, 'p1'), KITEROA)).toBe(false)
  })

  it('本楼盘的素材本楼盘能用', () => {
    expect(isAllowedForProject(clip(KITEROA, 'k1'), KITEROA)).toBe(true)
  })

  it('不属于任何楼盘的素材（中介品牌片、通用空镜）哪都能用', () => {
    expect(isAllowedForProject(clip(null, 'brand'), KITEROA)).toBe(true)
    expect(isAllowedForProject(clip(null, 'brand'), PARKHOMES)).toBe(true)
    expect(isAllowedForProject(clip(null, 'brand'), null)).toBe(true)
  })

  it('🔴 不做楼盘时，楼盘素材一律不给 —— 别把房子拍进旅行社的片子', () => {
    expect(isAllowedForProject(clip(KITEROA, 'k1'), null)).toBe(false)
  })

  it('字段缺失当作「不属于任何楼盘」，不炸也不误锁', () => {
    expect(isAllowedForProject({}, KITEROA)).toBe(true)
    expect(isAllowedForProject({ project_id: undefined }, null)).toBe(true)
  })
})

describe('filterByProject', () => {
  const pool = [
    clip(KITEROA, 'kiteroa_bedroom'),
    clip(PARKHOMES, 'parkhomes_kitchen'),
    clip(null, 'roman_brand_intro'),
  ]

  it('做 Kiteroa 时：拿到本楼盘 + 通用，拿不到 Parkhomes', () => {
    const out = filterByProject(pool, KITEROA).map((c) => c.tag)
    expect(out).toEqual(['kiteroa_bedroom', 'roman_brand_intro'])
  })

  it('做 Parkhomes 时对称成立', () => {
    const out = filterByProject(pool, PARKHOMES).map((c) => c.tag)
    expect(out).toEqual(['parkhomes_kitchen', 'roman_brand_intro'])
  })

  it('不做楼盘时只剩通用素材', () => {
    expect(filterByProject(pool, null).map((c) => c.tag)).toEqual(['roman_brand_intro'])
  })

  it('空池子不炸', () => {
    expect(filterByProject([], KITEROA)).toEqual([])
  })
})

describe('projectOrFilter', () => {
  it('做楼盘时同时放行本楼盘与通用素材', () => {
    expect(projectOrFilter(KITEROA)).toBe(`project_id.is.null,project_id.eq.${KITEROA}`)
  })

  it('不做楼盘时返回 null —— 调用方该用 .is(null)，不该拼 or', () => {
    expect(projectOrFilter(null)).toBeNull()
  })
})
