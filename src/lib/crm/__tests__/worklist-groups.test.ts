/**
 * 「今天该联系谁」的列必须盖住每一个该出现在名单上的段。
 *
 * 这份测试是一次真实事故的补救（2026-08-02）：`clicked_link`（「看了行程，
 * 还没人跟」）段位、文案、优先级都写好了，唯独漏了配一列。33 位自己点开过
 * 行程链接的客人 —— 名单上意向最明确的一批 —— 在整个页面上一个字都看不到，
 * 而且没有任何报错：他们是 warm，进不了页面下方「不在今天名单上的人」那栏
 * （只收 cold / off），看板又没有他们的列。人就这么凭空消失了。
 *
 * 所以这里钉的不是「现在有几列」，而是**不变量**：hot / warm 的段一个都不许
 * 漏。以后再加新段，忘了配列会当场红，而不是等客人静悄悄地漏掉。
 */

import { describe, expect, it } from 'vitest'
import {
  WORKLIST_GROUPS,
  WORKLIST_GROUP_META,
  groupDisplayMeta,
  worklistSegments,
} from '../worklist-groups'
import { SEGMENT_META, type Segment } from '../segments'

const covered = WORKLIST_GROUPS.flatMap((g) => g.members)

describe('看板的列必须盖住所有该联系的人', () => {
  it('每一个 hot / warm 段都有列可去 —— 少一个就有人从页面上消失', () => {
    const missing = worklistSegments().filter((s) => !covered.includes(s))
    expect(missing).toEqual([])
  })

  it('「看了行程，还没人跟」有自己的一列（33 人事故的那一段）', () => {
    expect(covered).toContain('clicked_link')
  })

  it('cold / off 不占列 —— 他们走页面下方那一栏', () => {
    const wrong = covered.filter((s) => {
      const t = SEGMENT_META[s].temperature
      return t !== 'hot' && t !== 'warm'
    })
    expect(wrong).toEqual([])
  })

  it('一个段只能落在一列里 —— 否则同一个人会在两列里各出现一次', () => {
    expect(new Set(covered).size).toBe(covered.length)
  })

  it('列的先后就是优先级的先后 —— 最该打的排最左', () => {
    const firstPriority = WORKLIST_GROUPS.map((g) =>
      Math.min(...g.members.map((m) => SEGMENT_META[m].priority)),
    )
    expect(firstPriority).toEqual([...firstPriority].sort((a, b) => a - b))
  })
})

describe('每一列都说得出「这是谁、该怎么办」', () => {
  it('列名和做法都不为空 —— 销售看不懂的列等于没有', () => {
    for (const g of WORKLIST_GROUPS) {
      const meta = groupDisplayMeta(g)
      expect(meta.label.trim().length, `${g.key} 缺列名`).toBeGreaterThan(0)
      expect(meta.howTo.trim().length, `${g.key} 缺做法说明`).toBeGreaterThan(0)
    }
  })

  it('合并列必须自己写标题 —— 否则会顶着其中一段的名字，另一段的人像是走错了地方', () => {
    for (const g of WORKLIST_GROUPS.filter((x) => x.members.length > 1)) {
      expect(WORKLIST_GROUP_META[g.key], `${g.key} 是合并列但没写标题`).toBeDefined()
    }
  })

  it('单段的列直接用那一段自己的文案，不重复维护一份', () => {
    const single = WORKLIST_GROUPS.find((g) => g.members.length === 1 && !WORKLIST_GROUP_META[g.key])
    expect(single).toBeDefined()
  })
})

describe('worklistSegments 只挑该进名单的段', () => {
  it('cold 的「以后才走」和 off 的「不用再联系」都不在里面', () => {
    const list = worklistSegments()
    expect(list).not.toContain('nurture_future' as Segment)
    expect(list).not.toContain('excluded' as Segment)
  })
})
