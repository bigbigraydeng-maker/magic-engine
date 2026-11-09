/**
 * 只读决策清单（CI-WP01 / Issue #1009）—— 钉住三条硬约束：
 *   · 今天已处理 / 别再联系的人绝不能出现在只读清单上
 *   · 每行必须同时有「为什么」和「建议下一步」
 *   · 空清单不是靠猜的，输入是空就输出空
 */
import { describe, expect, it } from 'vitest'
import {
  buildDecisionList,
  hasHandledToday,
  hasTruncatedBucket,
  type DecisionBucketSource,
  type DecisionSourceRow,
} from '../decision-list'

const person = (over: Partial<DecisionSourceRow> = {}): DecisionSourceRow => ({
  contactId: 'c1',
  name: 'Susan',
  phone: '021123456',
  email: 'susan@example.com',
  reason: '客户来消息了，已经等了 3 小时',
  suggestedChannel: 'phone',
  ...over,
})

const bucket = (people: DecisionSourceRow[], over: Partial<DecisionBucketSource> = {}): DecisionBucketSource => ({
  layer: 'waiting',
  label: '客人在等你',
  people,
  ...over,
})

describe('buildDecisionList', () => {
  it('把桶拍平成一条清单，带上身份 / 为什么 / 建议下一步', () => {
    const rows = buildDecisionList([bucket([person()])])
    expect(rows).toEqual([
      {
        contactId: 'c1',
        name: 'Susan',
        contact: '021123456',
        why: '客户来消息了，已经等了 3 小时',
        nextAction: '建议致电',
        layerLabel: '今天要联系',
        pinned: false,
      },
    ])
  })

  it('今天已经处理过的人不出现在清单上', () => {
    const rows = buildDecisionList([bucket([person({ doneToday: true })])])
    expect(rows).toHaveLength(0)
  })

  it('被标「别再联系」的人绝不出现，即使上游意外带了进来（防御性过滤）', () => {
    const rows = buildDecisionList([bucket([person({ doNotContact: true })])])
    expect(rows).toHaveLength(0)
  })

  it('空桶给空清单，不编造行', () => {
    expect(buildDecisionList([])).toEqual([])
    expect(buildDecisionList([bucket([])])).toEqual([])
  })

  it('号码打不通但有邮箱时，邮箱要露出来，不能让人看着「建议发邮件」却找不到邮箱', () => {
    const rows = buildDecisionList([bucket([person({ phoneUnusable: true })])])
    expect(rows[0].contact).toBe('021123456（打不通）· susan@example.com')
  })

  it('号码打不通且没有邮箱时，只标注号码打不通', () => {
    const rows = buildDecisionList([bucket([person({ phoneUnusable: true, email: null })])])
    expect(rows[0].contact).toBe('021123456（打不通）')
  })

  it('没电话时退回邮箱，两个都没有就说清楚', () => {
    const withEmail = buildDecisionList([bucket([person({ phone: null })])])
    expect(withEmail[0].contact).toBe('susan@example.com')

    const withNeither = buildDecisionList([bucket([person({ phone: null, email: null })])])
    expect(withNeither[0].contact).toBe('没留联系方式')
  })

  it('有系统建议改状态时，下一步里带上具体状态和原因', () => {
    const rows = buildDecisionList([
      bucket([
        person({
          suggestedStage: { toStage: 'closed', label: '停止营销', why: '客户明确说过不感兴趣', stillFollowed: false },
        }),
      ]),
    ])
    expect(rows[0].nextAction).toBe('建议致电 · 系统建议改状态为「停止营销」（客户明确说过不感兴趣）')
  })

  it('置顶客人保留 pinned 标记', () => {
    const rows = buildDecisionList([bucket([person({ pinned: true })])])
    expect(rows[0].pinned).toBe(true)
  })

  it('多个桶按原有顺序拍平，不重排', () => {
    const rows = buildDecisionList([
      bucket([person({ contactId: 'a' })], { label: '客人在等你' }),
      bucket([person({ contactId: 'b' })], { label: '还没搭上话', layer: 'acted' }),
    ])
    expect(rows.map((r) => r.contactId)).toEqual(['a', 'b'])
  })

  it('每个 suggestedChannel 值都有对应的中文建议，不漏一个', () => {
    const channels: DecisionSourceRow['suggestedChannel'][] = ['phone', 'sms', 'email', 'messenger', 'none']
    for (const suggestedChannel of channels) {
      const rows = buildDecisionList([bucket([person({ suggestedChannel })])])
      expect(rows[0].nextAction.length).toBeGreaterThan(0)
    }
  })

  it('layer: queued 的桶整个不进清单 —— 交给自动跟进的人不算今天需要人工关注', () => {
    const rows = buildDecisionList([
      bucket([person({ contactId: 'a' })], { layer: 'waiting' }),
      bucket([person({ contactId: 'b' })], { layer: 'queued', label: '先放着的人' }),
    ])
    expect(rows.map((r) => r.contactId)).toEqual(['a'])
  })

  it('同行默认不进清单，跟主看板默认视图（终端客户）保持一致', () => {
    const rows = buildDecisionList([bucket([person({ kind: 'trade' })])])
    expect(rows).toHaveLength(0)
  })

  it('没有 kind 字段的人当终端客户处理，照样出现在清单上', () => {
    const rows = buildDecisionList([bucket([person({ kind: undefined })])])
    expect(rows).toHaveLength(1)
  })
})

describe('hasHandledToday —— 区分「都处理完了」和「今天压根没有到期的跟进」', () => {
  it('桶里有人 doneToday=true：今天确实处理过', () => {
    expect(hasHandledToday([bucket([person({ doneToday: true })])])).toBe(true)
  })

  it('桶里的人只是被标「别再联系」，不算今天处理过', () => {
    expect(hasHandledToday([bucket([person({ doNotContact: true })])])).toBe(false)
  })

  it('空桶：没有处理过任何人', () => {
    expect(hasHandledToday([bucket([])])).toBe(false)
    expect(hasHandledToday([])).toBe(false)
  })

  it('queued 桶里的 doneToday 不算数 —— 那批人本来就不是今天的人工清单', () => {
    expect(hasHandledToday([bucket([person({ doneToday: true })], { layer: 'queued' })])).toBe(false)
  })

  it('桶里只有同行的 doneToday=true：终端客户没被判断过，不能算「都处理完了」', () => {
    expect(hasHandledToday([bucket([person({ kind: 'trade', doneToday: true })])])).toBe(false)
  })

  it('桶里既有同行已处理、也有终端客户已处理：终端客户那条才算数（结果仍是 true）', () => {
    expect(
      hasHandledToday([
        bucket([
          person({ contactId: 'trade-1', kind: 'trade', doneToday: true }),
          person({ contactId: 'retail-1', doneToday: true }),
        ]),
      ]),
    ).toBe(true)
  })
})

describe('hasTruncatedBucket —— 桶超过单桶显示上限时必须能被识别出来', () => {
  it('任一桶 truncated=true 就该提示', () => {
    expect(hasTruncatedBucket([bucket([person()], { truncated: true })])).toBe(true)
  })

  it('没有桶被截断就不提示', () => {
    expect(hasTruncatedBucket([bucket([person()], { truncated: false })])).toBe(false)
    expect(hasTruncatedBucket([bucket([person()])])).toBe(false)
  })

  it('queued 桶被截断不提示 —— 那个桶本来就不在这份清单上显示', () => {
    expect(hasTruncatedBucket([bucket([person()], { layer: 'queued', truncated: true })])).toBe(false)
  })
})
