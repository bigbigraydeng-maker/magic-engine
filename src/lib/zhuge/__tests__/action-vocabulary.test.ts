import { describe, it, expect } from 'vitest'

import { ADS_ACTION_TYPE, GEO_ACTION_TYPE, SEO_ACTION_TYPE, SOCIAL_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { ACTION_KEYS } from '@/lib/kernel/registry'

import { isKnownActionType, knownActionTypes } from '../action-vocabulary'

// 真时钟：没有 vi.useFakeTimers()。本词汇表没有时间依赖，不需要造时钟。

describe('isKnownActionType()', () => {
  it('接受 flywheel vocabulary 已登记的 seo action', () => {
    expect(isKnownActionType(SEO_ACTION_TYPE.PUBLISH_BLOG)).toBe(true)
    expect(isKnownActionType('seo.publish_blog')).toBe(true)
  })

  it('接受 flywheel vocabulary 已登记的 ads action', () => {
    expect(isKnownActionType(ADS_ACTION_TYPE.PAUSE_CAMPAIGN)).toBe(true)
    expect(isKnownActionType('ads.pause_campaign')).toBe(true)
  })

  it('接受 flywheel vocabulary 已登记的 geo action', () => {
    expect(isKnownActionType(GEO_ACTION_TYPE.DEPLOY_DIRECTIVE)).toBe(true)
    expect(isKnownActionType('geo.deploy_directive')).toBe(true)
  })

  it('接受 flywheel vocabulary 已登记的 social action', () => {
    const anySocial = Object.values(SOCIAL_ACTION_TYPE)[0]
    expect(typeof anySocial).toBe('string')
    expect(isKnownActionType(anySocial)).toBe(true)
  })

  it('接受 kernel registry 已登记的 action', () => {
    expect(ACTION_KEYS.length).toBeGreaterThan(0)
    for (const key of ACTION_KEYS) {
      expect(isKnownActionType(key)).toBe(true)
    }
  })

  it('拒绝 LLM 临场编的 slug', () => {
    expect(isKnownActionType('launch_google_search_ads_3pl')).toBe(false)
    expect(isKnownActionType('configure_target_keywords')).toBe(false)
    expect(isKnownActionType('seo.fix_titles')).toBe(false)
    expect(isKnownActionType('ads.pause_losers')).toBe(false)
    expect(isKnownActionType('geo.deploy')).toBe(false)
    expect(isKnownActionType('reputation.monitoring')).toBe(false)
    expect(isKnownActionType('competitor.analysis')).toBe(false)
  })

  it('拒绝空字符串和空白：空白串在 flywheel/kernel 都没登记，直接 false', () => {
    expect(isKnownActionType('')).toBe(false)
    expect(isKnownActionType('   ')).toBe(false)
    expect(isKnownActionType('\n')).toBe(false)
  })

  it('拒绝非字符串', () => {
    expect(isKnownActionType(null)).toBe(false)
    expect(isKnownActionType(undefined)).toBe(false)
    expect(isKnownActionType(42)).toBe(false)
    expect(isKnownActionType({})).toBe(false)
    expect(isKnownActionType([])).toBe(false)
  })

  it('严格字面匹配：带前后空白的变体不是同一个 slug', () => {
    // 不吞空白：以免 ' seo.publish_blog ' 跟干净版本一起进 execution_items
    // 看板，造成同一类动作在 kanban 上出现两行。
    expect(isKnownActionType('  seo.publish_blog  ')).toBe(false)
    expect(isKnownActionType('seo.publish_blog ')).toBe(false)
    expect(isKnownActionType(' seo.publish_blog')).toBe(false)
  })
})

describe('knownActionTypes()', () => {
  it('返回去重排序的已登记 action 全集', () => {
    const list = knownActionTypes()
    expect(list.length).toBeGreaterThan(0)

    // 去重
    expect(new Set(list).size).toBe(list.length)

    // 排序
    const sorted = [...list].sort()
    expect(list).toEqual(sorted)

    // 覆盖 flywheel + kernel 两个来源
    expect(list).toContain('seo.publish_blog')
    expect(list).toContain('ads.pause_campaign')
    expect(list).toContain('geo.deploy_directive')
    for (const key of ACTION_KEYS) expect(list).toContain(key)
  })

  it('只读返回：调用方修改副本不影响内部状态', () => {
    const list1 = knownActionTypes()
    const originalLength = list1.length
    // 虽然返回类型是 readonly，运行时仍是普通数组。确认内部不被外部污染。
    ;(list1 as string[]).push('attack.vector')
    const list2 = knownActionTypes()
    expect(list2.length).toBe(originalLength)
    expect(list2).not.toContain('attack.vector')
  })
})
