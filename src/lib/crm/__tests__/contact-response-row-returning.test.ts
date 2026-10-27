import { describe, it, expect } from 'vitest'
import { responseRowFor } from '../contact-response-row'

/**
 * 「回头客」要从分档结果一路带到列表行。列表（view=priority）和平铺列表**共用**
 * `responseRowFor`，所以这里钉住一处就是两处：漏了它，列表上的「🔥 回头」标签和抽屉横幅
 * 就会悄悄不出现，而排序还是对的 —— 看起来一切正常，只是没人知道他是回头客。
 */
const contact = {
  id: 'c1', display_name: 'Test Person', primary_phone: '+64210000000', primary_email: 'a@example.com',
  first_seen_at: '2026-06-15T07:55:00Z', stage: null, pinned_at: null, important_note: null,
  important_due_at: null, assigned_to: null,
} as never

const seg = (over: Record<string, unknown> = {}) => ({
  segment: 'replied', temperature: 'hot', priority: 0.5,
  reason: '回头了：6月15日就咨询过，我们联系过 3 次，今天又填了表，意向很强',
  suggestedChannel: 'phone', wantedChannel: 'phone', dueAt: null, lastTouchAt: null,
  ...over,
}) as never

const build = (s: never) =>
  responseRowFor(contact, [], new Map(), { doNotContact: false } as never, s).row

describe('responseRowFor 透传 returning', () => {
  const returning = {
    firstEnquiryAt: '2026-06-15T07:55:00.000Z',
    latestFormAt: '2026-10-26T23:47:00.000Z',
    ourLastContactAt: '2026-10-24T01:11:00.000Z',
    ourContacts: 3,
    earlierForms: 1,
  }

  it('🔴 回头客 → 行里带着 returning，原样不改', () => {
    expect(build(seg({ returning })).returning).toEqual(returning)
  })

  it('🔴 不是回头客 → 明确是 null，不是缺字段（前端靠它决定画不画标签）', () => {
    expect(build(seg()).returning).toBeNull()
  })

  it('理由原样带出去，「该做什么」那一行会自动用上新的理由', () => {
    const row = build(seg({ returning })) as { reason: string; nextAction: { line: string } }
    expect(row.reason).toContain('回头了')
    expect(row.nextAction.line).toContain('回头了')
    // 拼出来的那一句不能有两个破折号叠在一起（理由本身不含「——」）
    expect(row.nextAction.line.match(/——/g)?.length).toBe(1)
  })
})
