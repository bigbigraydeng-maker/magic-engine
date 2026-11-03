import { describe, it, expect } from 'vitest'
import { toDrawerRow } from '../_components/list-helpers'
import type { ContactRow } from '../_components/contact-table-types'

/**
 * `toDrawerRow` 是**一个字段一个字段**映射的 —— 列表行加了新字段，不在这里补一行，抽屉就静悄悄收不到。
 *
 * 2026-10-27 的真实漏洞：给列表行加了 `returning`（回头客），列表上画出了「🔥 回头」，抽屉的
 * 顶部横幅却不立刻出现，因为这里没映射。当时的抽屉测试是直接把 `returning` 塞进抽屉行的，
 * 盖住了这个洞；是 tsc 报「DrawerRow 里没有 returning」才暴露的。这条测试从列表行出发，钉住整条路。
 */
const base = {
  contactId: 'c1', name: 'Test Person', firstSeenAt: null, lastTouchAt: null, phone: null, email: null,
  hasMessenger: false, stage: null, stageLabel: null, pinnedAt: null, important: { note: null, dueAt: null },
  segment: 'replied', segmentLabel: '客户回了', temperature: 'hot', intent: null, assignedTo: null, custom: {},
  nextAction: { list: 'hot', verb: 'call', verbLabel: '打给他', line: '打给他 —— x', reason: 'x', aiSuggestion: null, intentBoost: false },
} as unknown as ContactRow

describe('toDrawerRow 带上回头客', () => {
  const returning = {
    firstEnquiryAt: '2026-06-15T07:55:00.000Z',
    latestFormAt: '2026-10-26T23:47:00.000Z',
    ourLastContactAt: '2026-10-24T01:11:00.000Z',
    ourContacts: 3,
    earlierForms: 1,
  }

  it('🔴 列表行是回头客 → 抽屉行带着它，原样不改', () => {
    expect(toDrawerRow({ ...base, returning }).returning).toEqual(returning)
  })

  it('🔴 不是回头客 → 明确是 null（不是缺字段），抽屉据此决定不画横幅', () => {
    expect(toDrawerRow({ ...base, returning: null }).returning).toBeNull()
    expect(toDrawerRow(base).returning).toBeNull()
  })
})
