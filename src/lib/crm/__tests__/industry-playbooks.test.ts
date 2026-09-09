import { describe, it, expect } from 'vitest'
import {
  LOGISTICS_PLAYBOOK,
  playbookForIndustryCategory,
} from '../industry-playbooks'
import { TOURISM_PLAYBOOK } from '../segments'
import { mapIndustryToCategory } from '@/lib/huatuo/industry-mapper'

describe('playbookForIndustryCategory', () => {
  it('gives tourism clients the tourism playbook', () => {
    expect(playbookForIndustryCategory('tourism_operator')).toBe(TOURISM_PLAYBOOK)
  })

  it('gives logistics clients the logistics playbook', () => {
    expect(playbookForIndustryCategory('logistics_3pl')).toBe(LOGISTICS_PLAYBOOK)
  })

  /**
   * 这是本文件最重要的一条断言。
   *
   * 回退到旅游剧本不会报错，只会让一个非旅游客户悄悄开始用「客人说了出行
   * 时间」判冷热 —— 判错且无声。空剧本才是诚实的表达：这个行业还没剧本。
   */
  it.each([
    ['building_supplies'],
    ['real_estate_agency'],
    ['ecommerce_d2c'],
  ])('does NOT fall back to tourism for %s', (category) => {
    const pb = playbookForIndustryCategory(category)
    expect(pb).not.toBe(TOURISM_PLAYBOOK)
    expect(pb.resolveWaitSignal).toBeUndefined()
  })

  it.each([[null], [undefined], ['']])(
    'returns an empty playbook for %j rather than guessing',
    (category) => {
      expect(playbookForIndustryCategory(category)).toEqual({})
    },
  )
})

describe('LOGISTICS_PLAYBOOK', () => {
  /**
   * 故意不实现 —— 见 industry-playbooks.ts 里的长注释。
   * 锁住它，是因为「补上一个物流版 wait signal」看起来永远像个待办，
   * 而补上的代价是把「客户答应明天给资料」这类最热的线索压进培育桶。
   */
  it('deliberately has no wait signal', () => {
    expect(LOGISTICS_PLAYBOOK.resolveWaitSignal).toBeUndefined()
  })

  it('does not override the click window (falls back to the generic default)', () => {
    // 14 天目前只有单客户单条对话作为依据，还没到能定成行业默认的程度——
    // 见 industry-playbooks.ts 里 LOGISTICS_PLAYBOOK 的长注释。
    expect(LOGISTICS_PLAYBOOK.clickWindowMs).toBeUndefined()
  })
})

/**
 * 端到端：张骞给出的行业自由文本 → 行业代码 → 剧本。
 *
 * 分开测两段会漏掉接缝：industry-mapper 改了分类、或剧本表漏登一个代码，
 * 两边各自的测试都还是绿的，但真实客户会静默拿到空剧本。
 */
describe('industry text → playbook (seam)', () => {
  it('routes a real 3PL description to the logistics playbook', () => {
    const category = mapIndustryToCategory(['货代', '物流', '仓储'])
    expect(category).toBe('logistics_3pl')
    expect(playbookForIndustryCategory(category)).toBe(LOGISTICS_PLAYBOOK)
  })

  it('routes an English freight-forwarding description too', () => {
    const category = mapIndustryToCategory(['freight forwarding', 'customs clearance'])
    expect(category).toBe('logistics_3pl')
    expect(playbookForIndustryCategory(category)).toBe(LOGISTICS_PLAYBOOK)
  })

  it('still routes a tour operator to tourism', () => {
    const category = mapIndustryToCategory(['旅游', '旅行社'])
    expect(category).toBe('tourism_operator')
    expect(playbookForIndustryCategory(category)).toBe(TOURISM_PLAYBOOK)
  })
})
